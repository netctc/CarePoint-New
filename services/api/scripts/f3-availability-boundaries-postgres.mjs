import assert from 'node:assert/strict';
import { test } from 'node:test';
import { db, requests, booking, fixture, patient, booked, state, conflict, notFound, key } from './f2-f3-db-fixture.mjs';

const command = (entry, slot) => ({ availabilityRequestId: entry.id, slotId: slot.id, idempotencyKey: key() });
test('F3 PostgreSQL overlapping patient appointments for a different service are not openings', async () => {
  const f = await fixture(), other = await fixture();
  const sameTime = await db.availabilitySlot.update({ where: { id: other.early.id }, data: { startsAt: f.early.startsAt, endsAt: f.early.endsAt } });
  await booked(other, sameTime, f.actor);
  const entry = await requests.join(f.actor, f.input);
  assert.equal((await requests.matches(f.actor, entry.id)).items.some((s) => s.id === f.early.id), false);
  const before = await state(f);
  await assert.rejects(booking.book(f.actor, command(entry, f.early)), conflict);
  assert.deepEqual(await state(f), before);
});
test('F3 PostgreSQL another patient cannot book against an owned request', async () => {
  const f = await fixture(), other = await patient(), entry = await requests.join(f.actor, f.input);
  const before = await state(f);
  await assert.rejects(booking.book(other.actor, command(entry, f.early)), notFound);
  assert.deepEqual(await state(f), before);
});
test('F3 PostgreSQL same-patient bookings into two slots of one request commit once', async () => {
  const f = await fixture(), entry = await requests.join(f.actor, f.input);
  const results = await Promise.allSettled([booking.book(f.actor, command(entry, f.early)), booking.book(f.actor, command(entry, f.later))]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  for (const r of results) if (r.status === 'rejected') assert.ok(conflict(r.reason), String(r.reason));
  const snapshot = await state(f);
  assert.equal(snapshot.appointments.length, 1); assert.equal(snapshot.invoices.length, 1);
  assert.equal(snapshot.requests[0].status, 'FULFILLED'); assert.equal(snapshot.slots.reduce((n, s) => n + s.bookedCount, 0), 1);
});
test('F3 PostgreSQL withdrawal racing explicit booking has a consistent terminal result', async () => {
  const f = await fixture(), entry = await requests.join(f.actor, f.input); await requests.refresh(f.actor, entry.id);
  const results = await Promise.allSettled([booking.book(f.actor, command(entry, f.early)), requests.withdraw(f.actor, entry.id)]);
  for (const r of results) if (r.status === 'rejected') assert.ok(conflict(r.reason), String(r.reason));
  const snapshot = await state(f), booked = snapshot.requests[0].status === 'FULFILLED';
  assert.ok(['FULFILLED', 'WITHDRAWN'].includes(snapshot.requests[0].status));
  assert.equal(snapshot.appointments.length, booked ? 1 : 0);
  assert.equal(snapshot.slots.reduce((n, s) => n + s.bookedCount, 0), booked ? 1 : 0); assert.equal(snapshot.notices[0].active, false);
});
test('F3 PostgreSQL a matching existing booking routes the patient back to visit management', async () => {
  const f = await fixture(); await booked(f); const before = await state(f);
  await assert.rejects(requests.join(f.actor, f.input), conflict); assert.deepEqual(await state(f), before);
});
test('F3 PostgreSQL slots outside the requested interval cannot be booked through the request', async () => {
  const f = await fixture(), entry = await requests.join(f.actor, { ...f.input, to: f.origin.startsAt.toISOString() });
  const before = await state(f);
  await assert.rejects(booking.book(f.actor, command(entry, f.later)), conflict); assert.deepEqual(await state(f), before);
});
test('F3 PostgreSQL observed matching is deterministic and explicitly truncated at 100', async () => {
  const f = await fixture(), entry = await requests.join(f.actor, f.input);
  await db.availabilitySlot.createMany({ data: Array.from({ length: 110 }, (_, i) => ({ providerId: f.provider.id, serviceId: f.service.id, modality: 'CLINIC', startsAt: new Date(f.early.startsAt.getTime() + (i + 1) * 3600000), endsAt: new Date(f.early.startsAt.getTime() + (i + 1) * 3600000 + 1800000) })) });
  const first = await requests.matches(f.actor, entry.id), second = await requests.matches(f.actor, entry.id);
  assert.equal(first.items.length, 100); assert.equal(first.truncated, true); assert.deepEqual(first.items, second.items);
  const observed = await requests.refresh(f.actor, entry.id); assert.equal(observed.notice.matchCount, 100); assert.equal(observed.notice.truncated, true);
});
test('F3 PostgreSQL request pagination does not duplicate boundary rows', async () => {
  const f = await fixture();
  for (let i = 0; i < 51; i++) await db.patientAvailabilityRequest.create({ data: { patientId: f.patientId, providerId: f.provider.id, serviceId: f.service.id, modality: 'CLINIC', fromAt: new Date(f.input.from), toAt: new Date(f.input.to), status: 'WITHDRAWN', closedAt: new Date(), noticeConsentVersion: 'IN_APP_AVAILABILITY_V1' } });
  const a = await requests.list(f.actor, '1'), b = await requests.list(f.actor, '2');
  assert.equal(a.items.length, 50); assert.equal(a.nextPage, 2); assert.equal(b.items.length, 1); assert.equal(b.nextPage, null);
  assert.equal(new Set([...a.items, ...b.items].map((e) => e.id)).size, 51);
});
test('F3 PostgreSQL 20 active requests is a real persisted limit', async () => {
  const f = await fixture();
  for (let i = 0; i < 20; i++) {
    const service = await db.service.create({ data: { providerId: f.provider.id, name: 'Synthetic capacity fixture', currency: 'SAR', modalities: { create: { modality: 'CLINIC', durationMinutes: 30, priceMinor: 5000 } } } });
    await db.patientAvailabilityRequest.create({ data: { patientId: f.patientId, providerId: f.provider.id, serviceId: service.id, modality: 'CLINIC', fromAt: new Date(f.input.from), toAt: new Date(f.input.to), activeKey: key(), noticeConsentVersion: 'IN_APP_AVAILABILITY_V1' } });
  }
  await assert.rejects(requests.join(f.actor, f.input), conflict);
  assert.equal(await db.patientAvailabilityRequest.count({ where: { patientId: f.patientId, status: 'WAITING' } }), 20);
});
test('F3 PostgreSQL home booking validates address/coverage and binds its exact retry payload', async () => {
  const f = await fixture(), slot = await f.slot(4, { modality: 'HOME_VISIT' });
  await db.serviceDeliveryContext.create({ data: { serviceId: f.service.id, modality: 'HOME_VISIT', homeCoverageCenterLatitude: 24.7, homeCoverageCenterLongitude: 46.7, homeCoverageRadiusKm: 10 } });
  const entry = await requests.join(f.actor, { ...f.input, modality: 'HOME_VISIT' });
  const base = command(entry, slot), before = await state(f);
  await assert.rejects(booking.book(f.actor, base), (e) => e.getStatus() === 400); assert.deepEqual(await state(f), before);
  const homeVisit = { addressLine1: 'Synthetic address', city: 'Test City', countryCode: 'SA', latitude: 24.7, longitude: 46.7, contactPhone: '000000000', addressValidated: true, contactConfirmed: true };
  await assert.rejects(booking.book(f.actor, { ...base, homeVisit: { ...homeVisit, latitude: 30 } }), conflict); assert.deepEqual(await state(f), before);
  const accepted = await booking.book(f.actor, { ...base, homeVisit });
  assert.equal((await booking.book(f.actor, { ...base, homeVisit: { ...homeVisit } })).id, accepted.id);
  await assert.rejects(booking.book(f.actor, { ...base, homeVisit: { ...homeVisit, contactPhone: '111111111' } }), conflict);
  assert.equal((await db.appointmentVisitContext.findUniqueOrThrow({ where: { appointmentId: accepted.id } })).contactPhone, '000000000');
});
test('F3 PostgreSQL provider commitments in other services are excluded without revealing patients', async () => {
  const f = await fixture(), other = await patient();
  const service = await db.service.create({ data: { providerId: f.provider.id, name: 'Synthetic second service', currency: 'SAR', modalities: { create: { modality: 'TELEMEDICINE', durationMinutes: 30, priceMinor: 5000 } } } });
  const slot = await db.availabilitySlot.create({ data: { providerId: f.provider.id, serviceId: service.id, modality: 'TELEMEDICINE', startsAt: f.early.startsAt, endsAt: f.early.endsAt } });
  await booking.book(other.actor, { slotId: slot.id, idempotencyKey: key() });
  const entry = await requests.join(f.actor, f.input), result = await requests.matches(f.actor, entry.id);
  assert.equal(result.items.some((s) => s.id === f.early.id), false);
  assert.equal(JSON.stringify(result).includes(other.patientId), false);
});
test('F3 PostgreSQL clinic observations require the same arrival instructions as booking', async () => {
  const f = await fixture(), entry = await requests.join(f.actor, f.input);
  await db.providerLocation.update({ where: { id: f.location.id }, data: { arrivalInstructions: null } });
  await db.serviceDeliveryContext.update({ where: { serviceId_modality: { serviceId: f.service.id, modality: 'CLINIC' } }, data: { clinicArrivalInstructions: null } });
  assert.equal((await requests.matches(f.actor, entry.id)).items.length, 0);
  await assert.rejects(booking.book(f.actor, command(entry, f.early)), conflict);
});
