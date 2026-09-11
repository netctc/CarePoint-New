import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { db, audit, fixture, booked, key } from './f2-f3-db-fixture.mjs';
const require = createRequire(import.meta.url);
const { NotificationsService } = require('../dist/modules/communications/notifications.service.js');
const { AvailabilityRequestsService } = require('../dist/modules/scheduling/availability-requests.service.js');
const { AvailabilityNotificationWorkerService, availabilityNotificationConfiguration } = require('../dist/modules/scheduling/availability-notification-worker.service.js');

const outboxWake = { wake() {} };
const notifications = new NotificationsService(db, audit, outboxWake);
const requests = new AvailabilityRequestsService(db, audit);
const worker = () => new AvailabilityNotificationWorkerService(db, requests, notifications);
const events = (actor, requestId) => db.notificationEvent.findMany({ where: { accountId: actor.accountId, entityType: 'AVAILABILITY_REQUEST', entityId: requestId }, include: { deliveries: true }, orderBy: { createdAt: 'asc' } });
const notice = (requestId) => db.patientAvailabilityNotice.findUnique({ where: { requestId } });

async function blockService(f) { await db.availabilitySlot.updateMany({ where: { serviceId: f.service.id }, data: { status: 'BLOCKED' } }); }
async function open(id) { await db.availabilitySlot.update({ where: { id }, data: { status: 'OPEN' } }); }

// Counts here are durable events, not claims that a slot is reserved or still available.
test('F4 PostgreSQL emits one IN_APP event per materially available observation version', async () => {
  const f = await fixture(); await blockService(f);
  await db.notificationPreference.upsert({ where: { accountId: f.actor.accountId }, create: { accountId: f.actor.accountId, inAppEnabled: true, pushEnabled: true, emailEnabled: true, smsEnabled: true }, update: { pushEnabled: true, emailEnabled: true, smsEnabled: true } });
  const entry = await requests.join(f.actor, f.input);
  let result = await worker().processRequest(entry.id);
  assert.deepEqual(result, { processed: true, alerted: false });
  assert.equal((await notice(entry.id)).active, false); assert.equal((await events(f.actor, entry.id)).length, 0);

  await open(f.early.id); result = await worker().processRequest(entry.id);
  assert.equal(result.alerted, true);
  let n = await notice(entry.id), sent = await events(f.actor, entry.id);
  assert.equal(n.active, true); assert.equal(n.lastNotifiedVersion, n.version); assert.equal(sent.length, 1);
  assert.equal(sent[0].type, 'CARE_COORDINATION'); assert.equal(sent[0].safeTitleKey, 'notification.availability.available.title');
  assert.deepEqual(sent[0].deliveries.map((d) => d.channel), ['IN_APP']);

  const version = n.version; const read = await requests.read(f.actor, entry.id, version); assert.ok(read.notice.readAt);
  result = await worker().processRequest(entry.id); assert.equal(result.alerted, false);
  n = await notice(entry.id); assert.equal(n.version, version); assert.ok(n.readAt); assert.equal((await events(f.actor, entry.id)).length, 1);

  await open(f.later.id); result = await worker().processRequest(entry.id); assert.equal(result.alerted, true);
  n = await notice(entry.id); sent = await events(f.actor, entry.id);
  assert.equal(n.version, version + 1); assert.equal(n.readAt, null); assert.equal(sent.length, 2);
  assert.ok(sent.every((event) => event.deliveries.length === 1 && event.deliveries[0].channel === 'IN_APP'));

  await blockService(f); result = await worker().processRequest(entry.id); assert.equal(result.alerted, false);
  const none = await notice(entry.id); assert.equal(none.active, false); assert.equal((await events(f.actor, entry.id)).length, 2);
  await open(f.origin.id); result = await worker().processRequest(entry.id); assert.equal(result.alerted, true);
  assert.equal((await events(f.actor, entry.id)).length, 3);
});

test('F4 manual refresh can be picked up once without generating a duplicate version', async () => {
  const f = await fixture(), entry = await requests.join(f.actor, f.input);
  const manual = await requests.refresh(f.actor, entry.id);
  assert.equal(manual.notice.active, true); assert.equal((await notice(entry.id)).lastNotifiedVersion, 0);
  assert.equal((await worker().processRequest(entry.id)).alerted, true);
  assert.equal((await worker().processRequest(entry.id)).alerted, false);
  const sent = await events(f.actor, entry.id);
  assert.equal(sent.length, 1); assert.ok(sent[0].dedupeKey.endsWith(`availability-request:${entry.id}:v${manual.notice.version}`));
});

test('F4 two worker instances racing one request persist a single event and marker', async () => {
  const f = await fixture(), entry = await requests.join(f.actor, f.input);
  const results = await Promise.allSettled([worker().processRequest(entry.id), worker().processRequest(entry.id)]);
  const fulfilled = results.filter((r) => r.status === 'fulfilled');
  assert.ok(fulfilled.length >= 1);
  // A serialization loser may be retried on the next scan; the durable result must already be singular.
  const sent = await events(f.actor, entry.id); assert.equal(sent.length, 1);
  const n = await notice(entry.id); assert.equal(n.lastNotifiedVersion, n.version);
  assert.equal((await worker().processRequest(entry.id)).alerted, false);
  assert.equal((await events(f.actor, entry.id)).length, 1);
});

test('F4 notification transaction failure leaves an observable version pending for safe retry', async () => {
  const f = await fixture(), entry = await requests.join(f.actor, f.input);
  const failing = {
    async enqueueAccountInTransaction(tx, input) { await notifications.enqueueAccountInTransaction(tx, input); throw new Error('SYNTHETIC_F4_AFTER_ENQUEUE'); },
    wakeOutbox() {},
  };
  const broken = new AvailabilityNotificationWorkerService(db, requests, failing);
  await assert.rejects(broken.processRequest(entry.id), /SYNTHETIC_F4_AFTER_ENQUEUE/);
  const pending = await notice(entry.id); assert.equal(pending.active, true); assert.equal(pending.lastNotifiedVersion, 0);
  assert.equal((await events(f.actor, entry.id)).length, 0);
  assert.equal((await worker().processRequest(entry.id)).alerted, true);
  assert.equal((await events(f.actor, entry.id)).length, 1);
});

test('F4 closed, fulfilled and expired requests cannot emit later availability alerts', async () => {
  const withdrawnFixture = await fixture(); const withdrawn = await requests.join(withdrawnFixture.actor, withdrawnFixture.input);
  await requests.withdraw(withdrawnFixture.actor, withdrawn.id);
  assert.deepEqual(await worker().processRequest(withdrawn.id), { processed: false, alerted: false });
  assert.equal((await events(withdrawnFixture.actor, withdrawn.id)).length, 0);

  const fulfilledFixture = await fixture(); const fulfilled = await requests.join(fulfilledFixture.actor, fulfilledFixture.input);
  await booked(fulfilledFixture, fulfilledFixture.origin, fulfilledFixture.actor);
  assert.equal((await db.patientAvailabilityRequest.findUniqueOrThrow({ where: { id: fulfilled.id } })).status, 'FULFILLED');
  assert.deepEqual(await worker().processRequest(fulfilled.id), { processed: false, alerted: false });
  assert.equal((await events(fulfilledFixture.actor, fulfilled.id)).length, 0);

  const expiredFixture = await fixture();
  const expired = await db.patientAvailabilityRequest.create({ data: { patientId: expiredFixture.patientId, providerId: expiredFixture.provider.id, serviceId: expiredFixture.service.id, modality: 'CLINIC', fromAt: new Date(Date.now() - 2 * 86400000), toAt: new Date(Date.now() - 86400000), activeKey: key(), noticeConsentVersion: 'IN_APP_AVAILABILITY_V1' } });
  assert.deepEqual(await worker().processRequest(expired.id), { processed: false, alerted: false });
  assert.equal((await events(expiredFixture.actor, expired.id)).length, 0);
});

test('F4 worker scan is bounded and disabled unless explicitly configured', async () => {
  assert.equal(availabilityNotificationConfiguration({ NODE_ENV: 'test' }).enabled, false);
  assert.throws(() => availabilityNotificationConfiguration({ NODE_ENV: 'production', AVAILABILITY_NOTIFICATION_WORKER_ENABLED: 'true' }), /SCAN_INTERVAL/);
  assert.throws(() => availabilityNotificationConfiguration({ NODE_ENV: 'production', AVAILABILITY_NOTIFICATION_WORKER_ENABLED: 'true', AVAILABILITY_NOTIFICATION_SCAN_INTERVAL_MS: '60000' }), /BATCH_SIZE/);
  const config = availabilityNotificationConfiguration({ NODE_ENV: 'production', AVAILABILITY_NOTIFICATION_WORKER_ENABLED: 'true', AVAILABILITY_NOTIFICATION_SCAN_INTERVAL_MS: '60000', AVAILABILITY_NOTIFICATION_BATCH_SIZE: '50' });
  assert.deepEqual(config, { enabled: true, scanIntervalMs: 60000, batchSize: 50 });

  const f = await fixture(), entry = await requests.join(f.actor, f.input);
  const run = await worker().runOnce();
  assert.ok(run.scanned >= 1 && run.scanned <= 200); assert.ok(run.alerted >= 1); assert.equal(run.failed, 0);
  assert.equal((await events(f.actor, entry.id)).length, 1);
});

test('F4 database constraint rejects impossible notified-version state', async () => {
  const f = await fixture(), entry = await requests.join(f.actor, f.input); await requests.refresh(f.actor, entry.id);
  const n = await notice(entry.id);
  await assert.rejects(db.patientAvailabilityNotice.update({ where: { id: n.id }, data: { lastNotifiedVersion: n.version + 1 } }));
  assert.equal((await notice(entry.id)).lastNotifiedVersion, 0);
});
