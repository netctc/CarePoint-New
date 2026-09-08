import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { assertProductionSiemReady } = require("../dist/infrastructure/siem/production-siem-preflight.js");
const { SiemEventPresenterService } = require("../dist/infrastructure/siem/siem-event-presenter.service.js");
const { SiemGatewayService } = require("../dist/infrastructure/siem/siem-gateway.service.js");
const { SiemOutboxWorkerService } = require("../dist/infrastructure/siem/siem-outbox-worker.service.js");

const productionEnv = (overrides = {}) => ({
  NODE_ENV: "production",
  SIEM_EXPORT_ENABLED: "true",
  SIEM_EXPORT_URL: "https://siem.example.internal/v1/events",
  SIEM_EXPORT_API_KEY: "0123456789abcdef0123456789abcdef",
  SIEM_EXPORT_TIMEOUT_MS: "10000",
  SIEM_WORKER_ENABLED: "true",
  SIEM_WORKER_POLL_MS: "1000",
  SIEM_WORKER_LEASE_SECONDS: "60",
  SIEM_WORKER_BATCH_SIZE: "50",
  SIEM_MAX_ATTEMPTS: "10",
  SIEM_RETRY_BASE_SECONDS: "5",
  ...overrides,
});

assert.doesNotThrow(() => assertProductionSiemReady(productionEnv()));
assert.doesNotThrow(() => assertProductionSiemReady({ NODE_ENV: "test" }));
assert.throws(() => assertProductionSiemReady(productionEnv({ SIEM_EXPORT_ENABLED: "false" })), /SIEM_EXPORT_ENABLED=true is required/);
assert.throws(() => assertProductionSiemReady(productionEnv({ SIEM_EXPORT_URL: "" })), /SIEM_EXPORT_URL is required/);
assert.throws(() => assertProductionSiemReady(productionEnv({ SIEM_EXPORT_URL: "http:\/\/siem.example.internal/events" })), /must use HTTPS in production/);
assert.throws(() => assertProductionSiemReady(productionEnv({ SIEM_EXPORT_URL: "https:\/\/user:pass@siem.example.internal/events" })), /must not contain embedded credentials/);
assert.throws(() => assertProductionSiemReady(productionEnv({ SIEM_EXPORT_URL: "https:\/\/127.0.0.1/events" })), /must not target loopback in production/);
assert.throws(() => assertProductionSiemReady(productionEnv({ SIEM_EXPORT_API_KEY: "short" })), /between 16 and 4096 characters/);
assert.throws(() => assertProductionSiemReady(productionEnv({ SIEM_EXPORT_TIMEOUT_MS: "999" })), /between 1000 and 30000/);
assert.throws(() => assertProductionSiemReady(productionEnv({ SIEM_WORKER_ENABLED: "false" })), /forbidden in production/);
assert.throws(() => assertProductionSiemReady(productionEnv({ SIEM_WORKER_LEASE_SECONDS: "59" })), /between 60 and 1800/);

const presenter = new SiemEventPresenterService();
const rawActorId = "actor-raw-123456";
const rawObjectId = "account-raw-987654";
const phiMarker = "patient-name-must-never-leave";
const payload = presenter.present({
  id: "audit-event-0001",
  actorId: rawActorId,
  actorRole: "ADMIN",
  action: "LOGIN_FAILED",
  objectType: "ACCOUNT",
  objectId: rawObjectId,
  purpose: "SYSTEM_ACCESS",
  result: "DENIED",
  metadata: {
    lockoutApplied: true,
    concurrentReplay: false,
    mfa: true,
    role: "ADMIN",
    method: "POST",
    rawIp: "203.0.113.55",
    clinicalNote: phiMarker,
    requiredPermissions: ["IAM_READ_AUDIT"],
  },
  occurredAt: new Date("2026-09-09T00:00:00.000Z"),
});
const serializedPayload = JSON.stringify(payload);
assert.equal(payload.schemaVersion, 1);
assert.equal(payload.source, "carepoint-api");
assert.match(payload.eventRef, /^EVT-[A-F0-9]{12}$/);
assert.match(payload.actorRef ?? "", /^ADMIN-[A-F0-9]{12}$/);
assert.match(payload.targetRef ?? "", /^ADMIN-[A-F0-9]{12}$/);
assert.equal(payload.severity, "HIGH");
assert.deepEqual(payload.indicators, { lockoutApplied: true, concurrentReplay: false, mfa: true, role: "ADMIN", method: "POST" });
for (const forbidden of [rawActorId, rawObjectId, phiMarker, "203.0.113.55", "IAM_READ_AUDIT", "clinicalNote", "rawIp"]) {
  assert.equal(serializedPayload.includes(forbidden), false, `SIEM payload leaked forbidden value: ${forbidden}`);
}

let receivedBody = "";
let receivedHeaders = {};
const server = createServer((request, response) => {
  request.setEncoding("utf8");
  request.on("data", (chunk) => { receivedBody += chunk; });
  request.on("end", () => {
    receivedHeaders = request.headers;
    response.statusCode = 202;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ providerSecret: "response-body-must-not-be-persisted" }));
  });
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
try {
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("C9 local gateway fixture did not expose a port.");
  process.env.NODE_ENV = "test";
  process.env.SIEM_EXPORT_ENABLED = "true";
  process.env.SIEM_EXPORT_URL = `http://127.0.0.1:${address.port}/events`;
  process.env.SIEM_EXPORT_API_KEY = "c9-test-api-key-0123456789";
  process.env.SIEM_EXPORT_TIMEOUT_MS = "5000";
  const gateway = new SiemGatewayService();
  await gateway.send(payload);
  assert.equal(receivedBody, JSON.stringify(payload));
  assert.equal(receivedHeaders["content-type"], "application/json");
  assert.equal(receivedHeaders["idempotency-key"], payload.eventRef);
  assert.equal(receivedHeaders["x-carepoint-event-ref"], payload.eventRef);
  assert.equal(receivedHeaders.authorization, "Bearer c9-test-api-key-0123456789");
  assert.equal(receivedBody.includes(process.env.SIEM_EXPORT_API_KEY), false, "SIEM API key leaked into event body");
} finally {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

process.env.NODE_ENV = "test";
process.env.SIEM_WORKER_ENABLED = "true";
process.env.SIEM_WORKER_POLL_MS = "1000";
process.env.SIEM_WORKER_LEASE_SECONDS = "60";
process.env.SIEM_WORKER_BATCH_SIZE = "10";
process.env.SIEM_MAX_ATTEMPTS = "3";
process.env.SIEM_RETRY_BASE_SECONDS = "1";

const baseItem = (attemptCount = 1) => ({
  id: "delivery-1",
  auditEventId: "audit-event-0001",
  status: "PENDING",
  attemptCount,
  availableAt: new Date(),
  leaseOwner: "worker",
  leaseUntil: new Date(Date.now() + 60_000),
  exportedAt: null,
  errorCode: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  auditEvent: {
    id: "audit-event-0001",
    actorId: rawActorId,
    action: "AUTHORIZATION_DENIED",
    objectType: "API_ROUTE",
    objectId: "/api/v1/clinical-records/opaque-id",
    purpose: "SYSTEM_ACCESS",
    result: "DENIED",
    metadata: { method: "GET", role: "ADMIN", hidden: phiMarker },
    occurredAt: new Date("2026-09-09T00:00:00.000Z"),
  },
});

function fakeStore(item, state) {
  return {
    recoverable: async () => [{ id: item.id }],
    claim: async () => item,
    actorRole: async () => "ADMIN",
    markExported: async () => { state.exported += 1; return true; },
    requeue: async (_id, _worker, availableAt, errorCode) => { state.requeued += 1; state.availableAt = availableAt; state.errorCode = errorCode; return true; },
    markFailed: async (_id, _worker, errorCode) => { state.failed += 1; state.errorCode = errorCode; return true; },
  };
}

const successState = { exported: 0, requeued: 0, failed: 0 };
const successWorker = new SiemOutboxWorkerService(
  fakeStore(baseItem(1), successState),
  presenter,
  { send: async () => undefined, assertProductionReady: () => undefined },
);
const successResult = await successWorker.runOnce();
assert.deepEqual(successResult, { claimed: 1, exported: 1, requeued: 0, failed: 0 });
assert.deepEqual(successState, { exported: 1, requeued: 0, failed: 0 });

const retryState = { exported: 0, requeued: 0, failed: 0, availableAt: null, errorCode: null };
const retryWorker = new SiemOutboxWorkerService(
  fakeStore(baseItem(1), retryState),
  presenter,
  { send: async () => { throw new Error(`network failure ${phiMarker}`); }, assertProductionReady: () => undefined },
);
const retryStarted = Date.now();
const retryResult = await retryWorker.runOnce();
assert.deepEqual(retryResult, { claimed: 1, exported: 0, requeued: 1, failed: 0 });
assert.equal(retryState.errorCode, "Error");
assert.ok(retryState.availableAt instanceof Date && retryState.availableAt.getTime() >= retryStarted + 900, "SIEM retry backoff was not applied");
assert.equal(String(retryState.errorCode).includes(phiMarker), false, "SIEM retry error code leaked provider error text");

const failedState = { exported: 0, requeued: 0, failed: 0, errorCode: null };
const failedWorker = new SiemOutboxWorkerService(
  fakeStore(baseItem(3), failedState),
  presenter,
  { send: async () => { throw new Error(phiMarker); }, assertProductionReady: () => undefined },
);
const failedResult = await failedWorker.runOnce();
assert.deepEqual(failedResult, { claimed: 1, exported: 0, requeued: 0, failed: 1 });
assert.equal(failedState.errorCode, "Error");

const auditSource = await readFile(new URL("../src/infrastructure/audit/audit.service.ts", import.meta.url), "utf8");
assert.match(auditSource, /this\.prisma\.\$transaction\(async \(tx\) =>/);
assert.match(auditSource, /this\.siemOutbox\.enqueueInTransaction\(tx, event\.id\)/);
assert.match(auditSource, /this\.siemWorker\.wake\(\)/);
const schemaSource = await readFile(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
assert.match(schemaSource, /model SiemAuditDelivery \{/);
assert.match(schemaSource, /auditEventId String\s+@unique/);
assert.match(schemaSource, /@@index\(\[status, availableAt\]\)/);
const mainSource = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
assert.ok(mainSource.indexOf("assertProductionSiemReady();") < mainSource.indexOf("NestFactory.create"), "C9 preflight must run before Nest application creation");

console.log("Phase C9 durable SIEM audit export acceptance passed");
