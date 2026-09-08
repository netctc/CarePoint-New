import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  NotificationOutboxWorkerService,
  notificationWorkerConfiguration,
} = require("../dist/modules/communications/notification-outbox-worker.service.js");
const { NotificationGatewayService } = require("../dist/modules/communications/notification-gateway.service.js");

const ORIGINAL_ENV = { ...process.env };

function workerEnv(overrides = {}) {
  Object.assign(process.env, {
    NODE_ENV: "test",
    NOTIFICATION_WORKER_ENABLED: "true",
    NOTIFICATION_WORKER_POLL_MS: "1000",
    NOTIFICATION_WORKER_LEASE_SECONDS: "60",
    NOTIFICATION_WORKER_BATCH_SIZE: "25",
    NOTIFICATION_MAX_ATTEMPTS: "3",
    NOTIFICATION_RETRY_BASE_SECONDS: "1",
    ...overrides,
  });
}

function workItem(id, channel, attemptCount = 1) {
  return {
    id,
    notificationId: `notification-${id}`,
    channel,
    attemptCount,
    notification: {
      id: `notification-${id}`,
      accountId: "account-c7",
      safeTitleKey: "notification.message.title",
      safeBodyKey: "notification.message.body",
      entityType: "CARE_CONVERSATION",
      entityId: "conversation-c7",
    },
  };
}

class FakeStore {
  constructor(items, routing = {}) {
    this.items = new Map(items.map((item) => [item.id, item]));
    this.routing = routing;
    this.sent = [];
    this.skipped = [];
    this.requeued = [];
    this.failed = [];
    this.claimed = [];
  }
  async recoverable(limit) {
    return [...this.items.keys()].slice(0, limit).map((id) => ({ id }));
  }
  async claim(id, owner, leaseSeconds) {
    const item = this.items.get(id) ?? null;
    if (item) this.claimed.push({ id, owner, leaseSeconds });
    return item;
  }
  async routingContext(item) {
    return this.routing[item.id] ?? { enabled: true, locale: "en", destinationRef: `destination-${item.id}` };
  }
  async markSent(id, owner, providerRef) {
    this.sent.push({ id, owner, providerRef });
    return true;
  }
  async markSkipped(id, owner) {
    this.skipped.push({ id, owner });
    return true;
  }
  async requeue(id, owner, availableAt, errorCode) {
    this.requeued.push({ id, owner, availableAt, errorCode });
    return true;
  }
  async markFailed(id, owner, errorCode) {
    this.failed.push({ id, owner, errorCode });
    return true;
  }
}

class FakeGateway {
  constructor(failIds = new Set()) {
    this.failIds = failIds;
    this.sent = [];
  }
  assertProductionReady() {}
  async send(input) {
    this.sent.push(input);
    if (this.failIds.has(input.notificationId)) {
      throw new Error("SECRET_PROVIDER_MESSAGE_MUST_NOT_BE_PERSISTED");
    }
    return { provider: "TEST", reference: `provider-${input.notificationId}-${input.channel}` };
  }
}

class FakeAudit {
  constructor() { this.rows = []; }
  async write(input) { this.rows.push(input); }
}

try {
  workerEnv();
  const config = notificationWorkerConfiguration(process.env);
  assert.equal(config.enabled, true);
  assert.equal(config.leaseSeconds, 60);
  assert.equal(config.maxAttempts, 3);

  assert.throws(
    () => notificationWorkerConfiguration({ ...process.env, NODE_ENV: "production", NOTIFICATION_WORKER_ENABLED: "false" }),
    /forbidden in production/,
  );
  assert.throws(
    () => notificationWorkerConfiguration({ ...process.env, NOTIFICATION_WORKER_LEASE_SECONDS: "30" }),
    /between 60 and 1800/,
  );
  assert.throws(
    () => notificationWorkerConfiguration({ ...process.env, NOTIFICATION_MAX_ATTEMPTS: "0" }),
    /between 1 and 20/,
  );

  workerEnv();
  const normalStore = new FakeStore(
    [
      workItem("in-app", "IN_APP"),
      workItem("push-disabled", "PUSH"),
      workItem("sms-missing", "SMS"),
      workItem("email", "EMAIL"),
    ],
    {
      "in-app": { enabled: true, locale: "en" },
      "push-disabled": { enabled: false, locale: "en", destinationRef: "opaque-push" },
      "sms-missing": { enabled: true, locale: "ar" },
      email: { enabled: true, locale: "fr", destinationRef: "account@example.test" },
    },
  );
  const normalGateway = new FakeGateway();
  const normalAudit = new FakeAudit();
  const normalWorker = new NotificationOutboxWorkerService(normalStore, normalGateway, normalAudit);
  const normalResult = await normalWorker.runOnce();
  assert.deepEqual(normalResult, { claimed: 4, sent: 2, skipped: 2, requeued: 0, failed: 0 });
  assert.equal(normalStore.claimed.every((row) => row.leaseSeconds === 60), true);
  assert.equal(normalGateway.sent.length, 1, "IN_APP must not call the external gateway");
  assert.equal(normalGateway.sent[0].channel, "EMAIL");
  assert.equal(normalGateway.sent[0].destinationRef, "account@example.test");
  assert.equal(normalStore.sent.some((row) => row.id === "in-app" && row.providerRef === undefined), true);
  assert.equal(normalStore.sent.some((row) => row.id === "email" && row.providerRef?.startsWith("provider-")), true);
  assert.deepEqual(normalStore.skipped.map((row) => row.id).sort(), ["push-disabled", "sms-missing"]);

  workerEnv();
  const retryItem = workItem("retry", "PUSH", 1);
  const retryStore = new FakeStore([retryItem]);
  const retryGateway = new FakeGateway(new Set([retryItem.notificationId]));
  const retryAudit = new FakeAudit();
  const retryWorker = new NotificationOutboxWorkerService(retryStore, retryGateway, retryAudit);
  const retryStarted = Date.now();
  const retryResult = await retryWorker.runOnce();
  assert.deepEqual(retryResult, { claimed: 1, sent: 0, skipped: 0, requeued: 1, failed: 0 });
  assert.equal(retryStore.requeued.length, 1);
  assert.equal(retryStore.requeued[0].errorCode, "Error");
  assert.doesNotMatch(JSON.stringify(retryStore.requeued[0]), /SECRET_PROVIDER_MESSAGE/);
  assert.ok(retryStore.requeued[0].availableAt.getTime() >= retryStarted + 900);
  assert.equal(retryAudit.rows.length, 0, "transient failures must not create terminal failure audits");

  workerEnv();
  const exhaustedItem = workItem("exhausted", "SMS", 3);
  const exhaustedStore = new FakeStore([exhaustedItem]);
  const exhaustedGateway = new FakeGateway(new Set([exhaustedItem.notificationId]));
  const exhaustedAudit = new FakeAudit();
  const exhaustedWorker = new NotificationOutboxWorkerService(exhaustedStore, exhaustedGateway, exhaustedAudit);
  const exhaustedResult = await exhaustedWorker.runOnce();
  assert.deepEqual(exhaustedResult, { claimed: 1, sent: 0, skipped: 0, requeued: 0, failed: 1 });
  assert.deepEqual(exhaustedStore.failed.map(({ id, errorCode }) => ({ id, errorCode })), [{ id: "exhausted", errorCode: "Error" }]);
  assert.equal(exhaustedAudit.rows.length, 1);
  assert.equal(exhaustedAudit.rows[0].action, "NOTIFICATION_DELIVERY_EXHAUSTED");
  assert.equal(exhaustedAudit.rows[0].metadata.errorCode, "Error");
  assert.doesNotMatch(JSON.stringify(exhaustedAudit.rows), /SECRET_PROVIDER_MESSAGE/);

  const gateway = new NotificationGatewayService();
  process.env.NODE_ENV = "production";
  process.env.NOTIFICATION_GATEWAY_PROVIDER = "mock";
  assert.throws(() => gateway.assertProductionReady(), /Mock notifications are forbidden/);

  process.env.NOTIFICATION_GATEWAY_PROVIDER = "external";
  delete process.env.NOTIFICATION_GATEWAY_BASE_URL;
  delete process.env.NOTIFICATION_GATEWAY_API_KEY;
  delete process.env.NOTIFICATION_GATEWAY_API_KEY_KMS_FILE;
  assert.throws(() => gateway.assertProductionReady(), /BASE_URL is required/);

  process.env.NOTIFICATION_GATEWAY_BASE_URL = "http://notification.example.test";
  assert.throws(() => gateway.assertProductionReady(), /require HTTPS/);

  process.env.NOTIFICATION_GATEWAY_BASE_URL = "https://127.0.0.1:8443";
  assert.throws(() => gateway.assertProductionReady(), /must not target loopback/);

  process.env.NOTIFICATION_GATEWAY_BASE_URL = "https://user:password@notification.example.test";
  assert.throws(() => gateway.assertProductionReady(), /must not embed credentials/);

  process.env.NOTIFICATION_GATEWAY_BASE_URL = "https://notification.example.test";
  process.env.NOTIFICATION_GATEWAY_TIMEOUT_MS = "30001";
  assert.throws(() => gateway.assertProductionReady(), /between 100 and 30000/);

  process.env.NOTIFICATION_GATEWAY_TIMEOUT_MS = "10000";
  assert.doesNotThrow(() => gateway.assertProductionReady());

  console.log("Phase C7 durable notification outbox acceptance passed");
} finally {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) delete process.env[key];
  }
  Object.assign(process.env, ORIGINAL_ENV);
}
