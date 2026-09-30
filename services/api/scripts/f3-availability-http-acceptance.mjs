import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { db, id, day, future, raw, ok, post, account, provider, service, demand, safeAggregate } from './f3-http-fixture.mjs';
after(async () => { await db.$disconnect(); });

// Real HTTP, real login/session validation, real global guards and PostgreSQL.
// Fixture setup is synthetic database provisioning, not provider onboarding UAT.
test('F3.1 HTTP availability lifecycle and provider demand', async (t) => {
  const owner = await provider(), outsider = await provider(), otherProvider = await provider('OTHER_PROVIDER');
  const patient = await account(), second = await account(), admin = await account('ADMIN'), support = await account('SUPPORT');
  const care = await service(owner);
  let entry, secondEntry, remoteEntry, observed, appointment;

  await t.test('all seven routes require a bearer session before reading or writing data', async () => {
    const routes = [['/availability-requests', 'GET'], ['/availability-requests', 'POST'], ['/availability-requests/missing/refresh', 'POST'], ['/availability-requests/missing/read', 'POST'], ['/availability-requests/missing/withdraw', 'POST'], ['/availability-requests/missing/matches', 'GET'], ['/provider/availability-demand', 'GET']];
    for (const [path, method] of routes) assert.equal((await raw(path, { method, ...(method === 'POST' ? { body: {} } : {}) })).status, 401);
    assert.equal((await raw('/provider/availability-demand', { token: 'synthetic-invalid-token' })).status, 401);
  });
  await t.test('role boundaries reject patients, administrators and support from provider demand', async () => {
    for (const actor of [patient, admin, support]) assert.equal((await raw('/provider/availability-demand', { token: actor.token })).status, 403);
    for (const actor of [owner, otherProvider, admin, support]) assert.equal((await raw('/availability-requests', { token: actor.token })).status, 403);
  });
  await t.test('request creation requires explicit consent and rejects authority injection', async () => {
    for (const body of [{ ...care.input, inAppNotices: false }, { ...care.input, patientId: second.patientId }, { ...care.input, providerId: outsider.providerId }]) {
      assert.equal((await raw('/availability-requests', post(patient.token, body))).status, 400);
    }
  });
  await t.test('creating a request makes neither an appointment nor an invoice and returns no-store', async () => {
    const before = await db.availabilitySlot.findUniqueOrThrow({ where: { id: care.slot.id } });
    const result = await raw('/availability-requests', post(patient.token, care.input));
    assert.equal(result.status, 201); assert.equal(result.headers.get('cache-control'), 'no-store'); entry = result.body;
    assert.equal(entry.status, 'WAITING'); assert.equal(entry.reservesSlot, false);
    assert.equal(await db.appointment.count({ where: { patientId: patient.patientId } }), 0);
    assert.equal(await db.invoice.count({ where: { patientId: patient.patientId } }), 0);
    assert.deepEqual(await db.availabilitySlot.findUniqueOrThrow({ where: { id: care.slot.id } }), before);
  });
  await t.test('an identical creation retry returns the same request without duplication', async () => {
    assert.equal((await ok('/availability-requests', post(patient.token, care.input))).id, entry.id);
    assert.equal(await db.patientAvailabilityRequest.count({ where: { patientId: patient.patientId } }), 1);
  });
  await t.test('cross-patient identifiers cannot read, mutate or book an owned request', async () => {
    for (const [suffix, method, body] of [['matches', 'GET'], ['refresh', 'POST', {}], ['read', 'POST', { version: 1 }], ['withdraw', 'POST', {}]]) {
      assert.equal((await raw(`/availability-requests/${entry.id}/${suffix}`, { token: second.token, method, ...(body ? { body } : {}) })).status, 404);
    }
    assert.equal((await raw('/bookings', post(second.token, { slotId: care.slot.id, idempotencyKey: id(), availabilityRequestId: entry.id }))).status, 404);
    assert.deepEqual((await ok('/availability-requests', { token: second.token })).items, []);
  });
  await t.test('provider sees only owned aggregates without patient identifiers or mutation', async () => {
    const before = await db.patientAvailabilityRequest.findUniqueOrThrow({ where: { id: entry.id } });
    const result = await raw('/provider/availability-demand', { token: owner.token });
    assert.equal(result.status, 200); assert.equal(result.headers.get('cache-control'), 'no-store'); safeAggregate(result.body);
    assert.equal(result.body.items.length, 1); assert.equal(result.body.items[0].requestCount, 1);
    assert.equal(result.body.items[0].serviceId, care.serviceId);
    for (const privateValue of [patient.patientId, patient.userId, patient.email, entry.id]) assert.equal(JSON.stringify(result.body).includes(privateValue), false);
    assert.deepEqual((await demand(outsider)).items, []);
    assert.deepEqual(await db.patientAvailabilityRequest.findUniqueOrThrow({ where: { id: entry.id } }), before);
    assert.equal(await db.patientAvailabilityNotice.count({ where: { requestId: entry.id } }), 0);
  });
  await t.test('demand separates service modalities and counts requests rather than people', async () => {
    secondEntry = await ok('/availability-requests', post(second.token, care.input));
    remoteEntry = await ok('/availability-requests', post(patient.token, { ...care.input, modality: 'TELEMEDICINE' }));
    const rows = (await demand(owner)).items;
    assert.equal(rows.find((row) => row.modality === 'CLINIC').requestCount, 2);
    assert.equal(rows.find((row) => row.modality === 'TELEMEDICINE').requestCount, 1);
    assert.equal(rows.length, 2);
  });
  await t.test('withdrawal removes demand without cancelling any appointment', async () => {
    assert.equal((await ok(`/availability-requests/${secondEntry.id}/withdraw`, post(second.token))).status, 'WITHDRAWN');
    assert.equal((await ok(`/availability-requests/${remoteEntry.id}/withdraw`, post(patient.token))).status, 'WITHDRAWN');
    const result = await demand(owner);
    assert.equal(result.items.length, 1); assert.equal(result.items[0].requestCount, 1);
    assert.equal((await raw(`/availability-requests/${secondEntry.id}/matches`, { token: second.token })).status, 409);
    assert.equal(await db.appointment.count({ where: { serviceId: care.serviceId } }), 0);
  });
  await t.test('notice refresh, read and unchanged refresh persist the same read version', async () => {
    observed = await ok(`/availability-requests/${entry.id}/refresh`, post(patient.token));
    assert.equal(observed.notice.active, true);
    const read = await ok(`/availability-requests/${entry.id}/read`, post(patient.token, { version: observed.notice.version }));
    assert.ok(read.notice.readAt);
    const unchanged = await ok(`/availability-requests/${entry.id}/refresh`, post(patient.token));
    assert.equal(unchanged.notice.version, observed.notice.version); assert.equal(unchanged.notice.readAt, read.notice.readAt);
    const notices = await raw('/availability-requests?view=notices', { token: patient.token });
    assert.equal(notices.headers.get('cache-control'), 'no-store'); assert.equal(notices.body.items.length, 1);
  });
  await t.test('a stale read marker cannot acknowledge a newly observed version', async () => {
    await db.availabilitySlot.create({ data: { providerId: owner.providerId, serviceId: care.serviceId, modality: 'CLINIC', startsAt: future(6), endsAt: new Date(future(6).getTime() + 1800000) } });
    const changed = await ok(`/availability-requests/${entry.id}/refresh`, post(patient.token));
    assert.equal(changed.notice.version, observed.notice.version + 1); assert.equal(changed.notice.readAt, null);
    assert.equal((await raw(`/availability-requests/${entry.id}/read`, post(patient.token, { version: observed.notice.version }))).status, 409);
  });
  await t.test('booking via HTTP fulfils the request once, closes its notice and removes demand', async () => {
    const command = { slotId: care.slot.id, idempotencyKey: id(), availabilityRequestId: entry.id };
    appointment = await ok('/bookings', post(patient.token, command));
    assert.equal((await ok('/bookings', post(patient.token, command))).id, appointment.id);
    assert.equal((await raw('/bookings', post(patient.token, { ...command, slotId: 'changed-slot' }))).status, 409);
    const closed = await db.patientAvailabilityRequest.findUniqueOrThrow({ where: { id: entry.id } });
    assert.equal(closed.status, 'FULFILLED'); assert.equal(closed.bookedAppointmentId, appointment.id);
    assert.equal((await db.patientAvailabilityNotice.findUniqueOrThrow({ where: { requestId: entry.id } })).active, false);
    assert.deepEqual((await demand(owner)).items, []);
    assert.equal(await db.appointment.count({ where: { patientId: patient.patientId } }), 1);
    assert.equal(await db.invoice.count({ where: { patientId: patient.patientId } }), 1);
  });
  await t.test('overlap errors are controlled HTTP 409 responses without database details', async () => {
    const another = await service(outsider);
    await db.availabilitySlot.update({ where: { id: another.slot.id }, data: { startsAt: care.slot.startsAt, endsAt: care.slot.endsAt } });
    const request = await ok('/availability-requests', post(patient.token, another.input));
    const result = await raw('/bookings', post(patient.token, { slotId: another.slot.id, availabilityRequestId: request.id, idempotencyKey: id() }));
    assert.equal(result.status, 409);
    for (const secret of [patient.patientId, 'Prisma', '23P01', 'constraint', 'SELECT', 'INSERT']) assert.equal(JSON.stringify(result.body).includes(secret), false);
    assert.equal((await db.patientAvailabilityRequest.findUniqueOrThrow({ where: { id: request.id } })).status, 'WAITING');
    assert.equal((await db.availabilitySlot.findUniqueOrThrow({ where: { id: another.slot.id } })).bookedCount, 0);
  });
  await t.test('expired WAITING rows are excluded even before a cleanup operation', async () => {
    await db.patientAvailabilityRequest.create({ data: { patientId: second.patientId, providerId: owner.providerId, serviceId: care.serviceId, modality: 'CLINIC', fromAt: future(-2), toAt: future(-1), activeKey: id(), noticeConsentVersion: 'IN_APP_AVAILABILITY_V1' } });
    assert.deepEqual((await demand(owner)).items, []);
  });
  await t.test('demand keeps inactive service requests visible and labels them inactive', async () => {
    const request = await ok('/availability-requests', post(second.token, care.input));
    await db.service.update({ where: { id: care.serviceId }, data: { active: false } });
    let rows = (await demand(owner)).items; assert.equal(rows[0].serviceActive, false);
    await db.service.update({ where: { id: care.serviceId }, data: { active: true } });
    await db.serviceModality.update({ where: { serviceId_modality: { serviceId: care.serviceId, modality: 'CLINIC' } }, data: { active: false } });
    rows = (await demand(owner)).items; assert.equal(rows[0].modalityActive, false);
    await db.serviceModality.update({ where: { serviceId_modality: { serviceId: care.serviceId, modality: 'CLINIC' } }, data: { active: true } });
    await ok(`/availability-requests/${request.id}/withdraw`, post(second.token));
  });
  await t.test('suspended providers and expired verified credentials fail the live global guard', async () => {
    await db.provider.update({ where: { id: owner.providerId }, data: { status: 'SUSPENDED' } });
    assert.equal((await raw('/provider/availability-demand', { token: owner.token })).status, 403);
    await db.provider.update({ where: { id: owner.providerId }, data: { status: 'ACTIVE' } });
    await db.providerCredential.update({ where: { id: owner.credentialId }, data: { validUntil: future(-1) } });
    assert.equal((await raw('/provider/availability-demand', { token: owner.token })).status, 403);
    await db.providerCredential.update({ where: { id: owner.credentialId }, data: { validUntil: future(60) } });
    assert.equal((await raw('/provider/availability-demand', { token: owner.token })).status, 200);
  });
  await t.test('Other Provider demand respects category activation and current credentials', async () => {
    const offered = await service(otherProvider);
    await ok('/availability-requests', post(second.token, offered.input));
    const result = await demand(otherProvider); safeAggregate(result); assert.equal(result.items.length, 1);
    assert.equal(result.items[0].serviceId, offered.serviceId);
    await db.providerCategory.update({ where: { id: otherProvider.categoryId }, data: { active: false } });
    assert.equal((await raw('/provider/availability-demand', { token: otherProvider.token })).status, 403);
    await db.providerCategory.update({ where: { id: otherProvider.categoryId }, data: { active: true } });
    await db.providerCredential.update({ where: { id: otherProvider.credentialId }, data: { validUntil: future(-1) } });
    assert.equal((await raw('/provider/availability-demand', { token: otherProvider.token })).status, 403);
    await db.providerCredential.update({ where: { id: otherProvider.credentialId }, data: { validUntil: future(60) } });
  });
  await t.test('query validation rejects owner substitution, arrays and invalid pagination', async () => {
    for (const query of ['?providerId=other', '?patientId=other', '?page=0', '?page=1001', '?page=1.5', '?page=1&page=2']) {
      assert.equal((await raw(`/provider/availability-demand${query}`, { token: owner.token })).status, 400);
    }
  });
  await t.test('provider pagination covers 51 service groups without duplicate rows', async () => {
    const bulk = await provider();
    // Bulk synthetic records provision the aggregate boundary without 51 logins.
    for (let i = 0; i < 51; i++) {
      const offered = await db.service.create({ data: { providerId: bulk.providerId, name: `Synthetic bulk ${i}`, currency: 'SAR', modalities: { create: { modality: 'CLINIC', durationMinutes: 30, priceMinor: 5000 } } } });
      await db.patientAvailabilityRequest.create({ data: { patientId: second.patientId, providerId: bulk.providerId, serviceId: offered.id, modality: 'CLINIC', fromAt: future(1), toAt: future(10), activeKey: id(), noticeConsentVersion: 'IN_APP_AVAILABILITY_V1' } });
    }
    const first = await demand(bulk), secondPage = await demand(bulk, '?page=2');
    assert.equal(first.items.length, 50); assert.equal(first.nextPage, 2);
    assert.equal(secondPage.items.length, 1); assert.equal(secondPage.nextPage, null);
    assert.equal(new Set([...first.items, ...secondPage.items].map((row) => row.serviceId)).size, 51);
    safeAggregate(first); safeAggregate(secondPage);
  });
});
