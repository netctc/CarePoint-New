import assert from 'node:assert/strict';
import { test } from 'node:test';
import { db, audit, journeys, requests, booking, fixture, patient, booked, change, financial, seedPartialPayment, state, failingJourneys, failingBooking, conflict, notFound, key } from './f2-f3-db-fixture.mjs';

const requestBooking = (f, entry, slot = f.early) => ({ slotId: slot.id, idempotencyKey: key(), availabilityRequestId: entry.id });

test('F2 PostgreSQL rescheduling preserves non-empty financial and visit snapshots exactly', async () => {
  const f = await fixture(), appointment = await booked(f);
  await seedPartialPayment(appointment.id);
  const before = await financial(appointment.id), command = change(appointment, f.early);
  const result = await journeys.reschedule(f.actor, appointment.id, command);
  assert.equal(result.appointmentId, appointment.id);
  assert.deepEqual(await financial(appointment.id), before);
  assert.equal(before.payments.length, 1); assert.equal(before.receipts.length, 1); assert.equal(before.ledger.length, 1);
  assert.equal((await db.availabilitySlot.findUniqueOrThrow({ where: { id: f.origin.id } })).bookedCount, 0);
  assert.equal((await db.availabilitySlot.findUniqueOrThrow({ where: { id: f.early.id } })).bookedCount, 1);
  const snapshot = await state(f);
  const replay = await journeys.reschedule(f.actor, appointment.id, command);
  assert.equal(replay.replayed, true); assert.deepEqual(await state(f), snapshot);
});
test('F2 PostgreSQL competing changes to one version commit one transfer only', async () => {
  const f = await fixture(), appointment = await booked(f);
  const result = await Promise.allSettled([journeys.reschedule(f.actor, appointment.id, change(appointment, f.early)), journeys.reschedule(f.actor, appointment.id, change(appointment, f.later))]);
  assert.equal(result.filter((r) => r.status === 'fulfilled').length, 1);
  for (const r of result) if (r.status === 'rejected') assert.ok(conflict(r.reason), String(r.reason));
  const snapshot = await state(f);
  assert.equal(snapshot.changes.length, 1); assert.equal(snapshot.slots.reduce((n, s) => n + s.bookedCount, 0), 1);
});
test('F2 PostgreSQL two patients cannot acquire the same last destination place', async () => {
  const f = await fixture(), second = await patient();
  const a = await booked(f), b = await booked(f, f.later, second.actor);
  const result = await Promise.allSettled([journeys.reschedule(f.actor, a.id, change(a, f.early)), journeys.reschedule(second.actor, b.id, change(b, f.early))]);
  assert.equal(result.filter((r) => r.status === 'fulfilled').length, 1);
  for (const r of result) if (r.status === 'rejected') assert.ok(conflict(r.reason), String(r.reason));
  const slots = await db.availabilitySlot.findMany({ where: { serviceId: f.service.id } });
  assert.equal(slots.reduce((n, s) => n + s.bookedCount, 0), 2);
  assert.equal(slots.find((s) => s.id === f.early.id).bookedCount, 1);
});
test('F2 PostgreSQL audit failure rolls back capacity, history, waiting state, signals and finance', async () => {
  const f = await fixture(), appointment = await booked(f);
  await seedPartialPayment(appointment.id);
  const entry = await journeys.joinWaitlist(f.actor, appointment.id, { from: f.input.from, to: new Date(appointment.startsAt).toISOString(), expectedUpdatedAt: new Date(appointment.updatedAt).toISOString() });
  const before = await state(f), money = await financial(appointment.id);
  await assert.rejects(failingJourneys().reschedule(f.actor, appointment.id, { ...change(appointment, f.early), waitlistEntryId: entry.id }), /SYNTHETIC_ROLLBACK_AFTER_AUDIT/);
  assert.deepEqual(await state(f), before); assert.deepEqual(await financial(appointment.id), money);
});
test('F2 PostgreSQL cancellation racing rescheduling does not release the wrong inventory', async () => {
  const f = await fixture(), appointment = await booked(f);
  const results = await Promise.allSettled([journeys.reschedule(f.actor, appointment.id, change(appointment, f.early)), journeys.cancel(f.actor, appointment.id, 'Synthetic acceptance')]);
  for (const r of results) if (r.status === 'rejected') assert.ok(conflict(r.reason), String(r.reason));
  const current = await db.appointment.findUniqueOrThrow({ where: { id: appointment.id } });
  const slots = await db.availabilitySlot.findMany({ where: { serviceId: f.service.id } });
  assert.ok(slots.every((s) => s.bookedCount >= 0 && s.bookedCount <= s.capacity));
  assert.equal(slots.reduce((n, s) => n + s.bookedCount, 0), current.status === 'CANCELLED' ? 0 : 1);
});
test('F2 PostgreSQL change history rejects update and deletion', async () => {
  const f = await fixture(), appointment = await booked(f);
  await journeys.reschedule(f.actor, appointment.id, change(appointment, f.early));
  const row = await db.patientAppointmentChange.findFirstOrThrow({ where: { appointmentId: appointment.id } });
  await assert.rejects(db.patientAppointmentChange.update({ where: { id: row.id }, data: { toSlotId: f.later.id } }));
  await assert.rejects(db.patientAppointmentChange.delete({ where: { id: row.id } }));
  assert.equal((await db.patientAppointmentChange.findUniqueOrThrow({ where: { id: row.id } })).toSlotId, f.early.id);
});
test('F2 PostgreSQL waiting request is invalidated by a different appointment writer', async () => {
  const f = await fixture(), appointment = await booked(f);
  const entry = await journeys.joinWaitlist(f.actor, appointment.id, { from: f.input.from, to: new Date(appointment.startsAt).toISOString(), expectedUpdatedAt: new Date(appointment.updatedAt).toISOString() });
  await db.$transaction(async (tx) => {
    await tx.availabilitySlot.update({ where: { id: f.later.id }, data: { bookedCount: { increment: 1 } } });
    await tx.appointment.update({ where: { id: appointment.id }, data: { slotId: f.later.id, startsAt: f.later.startsAt, endsAt: f.later.endsAt } });
    await tx.availabilitySlot.update({ where: { id: f.origin.id }, data: { bookedCount: { decrement: 1 } } });
  });
  const closed = await db.patientWaitlistEntry.findUniqueOrThrow({ where: { id: entry.id } });
  assert.notEqual(closed.status, 'WAITING'); assert.equal(closed.activeKey, null);
});

test('F3 PostgreSQL request needs no existing appointment and reserves or charges nothing', async () => {
  const f = await fixture(), before = await state(f);
  const entry = await requests.join(f.actor, f.input);
  const observed = await requests.refresh(f.actor, entry.id);
  assert.equal(entry.status, 'WAITING'); assert.equal(observed.notice.active, true);
  const after = await state(f);
  assert.deepEqual(after.slots, before.slots); assert.deepEqual(after.appointments, before.appointments); assert.deepEqual(after.invoices, before.invoices);
  assert.ok(after.deliveries.length > 0);
});
test('F3 PostgreSQL concurrent joins produce one active request and one audit', async () => {
  const f = await fixture();
  const rows = await Promise.all([requests.join(f.actor, f.input), requests.join(f.actor, f.input)]);
  assert.equal(rows[0].id, rows[1].id);
  const result = await state(f); assert.equal(result.requests.length, 1); assert.equal(result.audits.length, 1);
});
test('F3 PostgreSQL a different window cannot silently replace an active request', async () => {
  const f = await fixture(); await requests.join(f.actor, f.input);
  const before = await state(f);
  await assert.rejects(requests.join(f.actor, { ...f.input, to: f.later.startsAt.toISOString() }), conflict);
  assert.deepEqual(await state(f), before);
});
test('F3 PostgreSQL explicit notice consent and non-authoritative fields are enforced', async () => {
  const f = await fixture();
  for (const body of [{ ...f.input, inAppNotices: false }, { ...f.input, patientId: f.patientId }, { ...f.input, modality: ['CLINIC'] }, { ...f.input, from: '2026-02-30T10:00:00Z' }]) {
    await assert.rejects(requests.join(f.actor, body), (e) => e.getStatus() === 400);
  }
  assert.equal(await db.patientAvailabilityRequest.count({ where: { patientId: f.patientId } }), 0);
});
test('F3 PostgreSQL all request reads and mutations enforce patient ownership', async () => {
  const f = await fixture(), other = await patient(), entry = await requests.join(f.actor, f.input);
  await requests.refresh(f.actor, entry.id);
  for (const action of [() => requests.matches(other.actor, entry.id), () => requests.refresh(other.actor, entry.id), () => requests.withdraw(other.actor, entry.id), () => requests.read(other.actor, entry.id, 1)]) await assert.rejects(action(), notFound);
  assert.equal((await requests.list(other.actor)).items.length, 0);
  for (const role of ['ADMIN', 'SUPPORT', 'DOCTOR', 'OTHER_PROVIDER']) await assert.rejects(requests.join({ ...f.actor, role }, f.input), (e) => e.getStatus() === 403);
});
test('F3 PostgreSQL unchanged observations keep notice identity, version and read state', async () => {
  const f = await fixture(), entry = await requests.join(f.actor, f.input);
  const first = await requests.refresh(f.actor, entry.id);
  const read = await requests.read(f.actor, entry.id, first.notice.version);
  const second = await requests.refresh(f.actor, entry.id);
  assert.equal(second.notice.id, first.notice.id); assert.equal(second.notice.version, first.notice.version); assert.deepEqual(second.notice.readAt, read.notice.readAt);
  assert.equal(await db.patientAvailabilityNotice.count({ where: { requestId: entry.id } }), 1);
  await f.slot(3);
  const changed = await requests.refresh(f.actor, entry.id);
  assert.equal(changed.notice.version, first.notice.version + 1); assert.equal(changed.notice.readAt, null);
  await assert.rejects(requests.read(f.actor, entry.id, first.notice.version), conflict);
});
test('F3 PostgreSQL full, blocked, exception-covered and overlapping slots are omitted', async () => {
  const f = await fixture();
  await db.availabilitySlot.update({ where: { id: f.origin.id }, data: { status: 'BLOCKED' } });
  await db.availabilitySlot.update({ where: { id: f.later.id }, data: { bookedCount: 1 } });
  const exception = await db.availabilityException.create({ data: { providerId: f.provider.id, startsAt: f.early.startsAt, endsAt: f.early.endsAt, kind: 'VACATION' } });
  const entry = await requests.join(f.actor, f.input);
  assert.equal((await requests.matches(f.actor, entry.id)).items.length, 0);
  await db.availabilityException.update({ where: { id: exception.id }, data: { active: false } });
  assert.deepEqual((await requests.matches(f.actor, entry.id)).items.map((s) => s.id), [f.early.id]);
});
test('F3 PostgreSQL withdrawal closes notice, is idempotent and rejects a stale booking', async () => {
  const f = await fixture(), entry = await requests.join(f.actor, f.input);
  await requests.refresh(f.actor, entry.id);
  await requests.withdraw(f.actor, entry.id);
  const before = await state(f);
  await requests.withdraw(f.actor, entry.id); assert.deepEqual(await state(f), before);
  assert.equal(before.notices[0].active, false);
  await assert.rejects(booking.book(f.actor, requestBooking(f, entry)), conflict);
  assert.deepEqual(await state(f), before);
  assert.equal((await requests.list(f.actor, '1', 'notices')).items.length, 0);
});
test('F3 PostgreSQL confirmed booking fulfils request and closes notice atomically', async () => {
  const f = await fixture(), entry = await requests.join(f.actor, f.input);
  await requests.refresh(f.actor, entry.id);
  const command = requestBooking(f, entry), appointment = await booking.book(f.actor, command);
  const snapshot = await state(f);
  assert.equal(snapshot.requests[0].status, 'FULFILLED'); assert.equal(snapshot.requests[0].bookedAppointmentId, appointment.id); assert.equal(snapshot.notices[0].active, false);
  assert.equal((await booking.book(f.actor, command)).id, appointment.id); assert.deepEqual(await state(f), snapshot);
  await assert.rejects(booking.book(f.actor, { ...command, slotId: f.later.id }), conflict);
  assert.deepEqual(await state(f), snapshot);
});
test('F3 PostgreSQL booking audit failure rolls back request, notice, inventory and new finance', async () => {
  const f = await fixture(), entry = await requests.join(f.actor, f.input);
  await requests.refresh(f.actor, entry.id); const before = await state(f);
  await assert.rejects(failingBooking().book(f.actor, requestBooking(f, entry)), /SYNTHETIC_ROLLBACK_AFTER_AUDIT/);
  assert.deepEqual(await state(f), before);
});
test('F3 PostgreSQL two unbooked patients racing the last place leave the losing request active', async () => {
  const f = await fixture(), other = await patient();
  const a = await requests.join(f.actor, f.input), b = await requests.join(other.actor, f.input);
  const results = await Promise.allSettled([booking.book(f.actor, requestBooking(f, a)), booking.book(other.actor, requestBooking(f, b))]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  for (const r of results) if (r.status === 'rejected') assert.ok(conflict(r.reason), String(r.reason));
  const entries = await db.patientAvailabilityRequest.findMany({ where: { id: { in: [a.id, b.id] } } });
  assert.equal(entries.filter((e) => e.status === 'FULFILLED').length, 1);
  const loser = entries.find((e) => e.status === 'WAITING'); assert.ok(loser.activeKey); assert.equal(loser.acceptedRequestHash, null);
  assert.equal((await db.availabilitySlot.findUniqueOrThrow({ where: { id: f.early.id } })).bookedCount, 1);
});
test('F3 PostgreSQL ordinary booking also fulfils matching requests without reopening on cancellation', async () => {
  const f = await fixture(), entry = await requests.join(f.actor, f.input);
  const appointment = await booked(f, f.early);
  await journeys.cancel(f.actor, appointment.id);
  assert.equal((await db.patientAvailabilityRequest.findUniqueOrThrow({ where: { id: entry.id } })).status, 'FULFILLED');
});
test('F3 PostgreSQL expired requests are displayed expired and cannot produce matches', async () => {
  const f = await fixture();
  const entry = await db.patientAvailabilityRequest.create({ data: { patientId: f.patientId, providerId: f.provider.id, serviceId: f.service.id, modality: 'CLINIC', fromAt: new Date(Date.now() - 7200000), toAt: new Date(Date.now() - 3600000), activeKey: key(), noticeConsentVersion: 'IN_APP_AVAILABILITY_V1' } });
  assert.equal((await requests.list(f.actor)).items[0].status, 'EXPIRED');
  await assert.rejects(requests.matches(f.actor, entry.id), conflict);
  await assert.rejects(booking.book(f.actor, requestBooking(f, entry)), conflict);
});
test('F3 PostgreSQL request scope and terminal state cannot be rewritten', async () => {
  const f = await fixture(), entry = await requests.join(f.actor, f.input);
  await assert.rejects(db.patientAvailabilityRequest.update({ where: { id: entry.id }, data: { fromAt: f.early.startsAt } }));
  await requests.withdraw(f.actor, entry.id);
  await assert.rejects(db.patientAvailabilityRequest.update({ where: { id: entry.id }, data: { status: 'WAITING', activeKey: key(), closedAt: null } }));
});
test('F3 PostgreSQL deactivated service invalidates observed availability at refresh and booking', async () => {
  const f = await fixture(), entry = await requests.join(f.actor, f.input); await requests.refresh(f.actor, entry.id);
  await db.service.update({ where: { id: f.service.id }, data: { active: false } });
  assert.equal((await requests.refresh(f.actor, entry.id)).notice.active, false);
  await assert.rejects(booking.book(f.actor, requestBooking(f, entry)), conflict);
});
test('F3 PostgreSQL personal projections omit internal patient keys and booking fingerprints', async () => {
  const f = await fixture(), entry = await requests.join(f.actor, f.input); await requests.refresh(f.actor, entry.id);
  const result = await requests.list(f.actor);
  const text = JSON.stringify(result);
  for (const field of ['patientId', 'activeKey', 'matchHash', 'acceptedKeyHash', 'acceptedRequestHash', 'passwordHash', 'contactPhone']) assert.equal(text.includes(`"${field}"`), false);
  for (const page of ['0', '-1', '1.2', '1001', '']) await assert.rejects(requests.list(f.actor, page), (e) => e.getStatus() === 400);
});
