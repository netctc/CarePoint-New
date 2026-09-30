import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

const [moduleText, worker, packageText, contractText, docs] = await Promise.all([
  read("src/modules/transport/transport-report-execution.module.ts"),
  read("src/scripts/run-transport-report-scheduler.ts"),
  read("package.json"),
  read("../../../ops/release-1/gcp-transport-report-worker-contract.json"),
  read("../../../docs/transport-report-worker-phase15.md"),
]);

const pkg = JSON.parse(packageText);
const contract = JSON.parse(contractText);

for (const text of [
  "async workerCycle(",
  "take: boundedLimit",
  "scheduledFor: \"asc\"",
  "SYSTEM_TRANSPORT_REPORT_WORKER_CYCLE",
  "CLOUD_RUN_JOB_APPLICATION_CONTEXT",
  "exports: [TransportReportExecutionService]",
]) {
  assert.ok(moduleText.includes(text), `Phase 15 service must include: ${text}`);
}

for (const text of [
  "NestFactory.createApplicationContext(AppModule",
  "system:transport-report-scheduler",
  "cloud-run-job:transport-report-worker",
  "worker.workerCycle(principal, 25)",
  "process.exitCode = 1",
]) {
  assert.ok(worker.includes(text), `worker entrypoint must include: ${text}`);
}
assert.ok(!worker.includes(".listen("), "worker must not start an HTTP listener");

assert.equal(contract.productionAcceptance, false);
assert.equal(contract.provider, "gcp");
assert.equal(contract.region, "me-central2");
assert.equal(contract.runtime.type, "cloud-run-job");
assert.equal(contract.runtime.maxParallelExecutions, 1);
assert.equal(contract.runtime.batchLimit, 25);
assert.deepEqual(contract.runtime.command, [
  "node",
  "dist/scripts/run-transport-report-scheduler.js",
]);
assert.equal(contract.scheduler.type, "cloud-scheduler");
assert.equal(contract.scheduler.invocationAuth, "oidc-service-account");
assert.equal(contract.scheduler.publicUnauthenticatedInvocationAllowed, false);
assert.equal(contract.scheduler.staticServiceAccountKeysAllowed, false);
assert.equal(contract.scheduler.staticAccessTokensAllowed, false);
assert.equal(contract.durability.executionLeaseMinutes, 5);
assert.equal(contract.durability.maxAttempts, 5);
assert.equal(contract.data.patientIdentityPersisted, false);
assert.equal(contract.data.patientLocationPersisted, false);
assert.equal(contract.data.fullReportRowsPersisted, false);
assert.equal(contract.delivery.automaticDeliveryAvailable, false);
assert.equal(contract.delivery.reportDeliveryPerformed, false);

assert.equal(
  pkg.scripts["transport:report-worker"],
  "node dist/scripts/run-transport-report-scheduler.js",
);
assert.equal(
  pkg.scripts["v2:transport-phase15"],
  "node scripts/v2-transport-phase15-smoke.mjs",
);
assert.ok(
  pkg.scripts.test.includes("npm run v2:transport-phase15"),
  "full API test chain must include Phase 15",
);

for (const text of [
  "Cloud Run Job",
  "Cloud Scheduler",
  "OIDC service-account invocation",
  "No new environment variables",
  "automaticDeliveryAvailable: false",
  "reportDeliveryPerformed: false",
]) {
  assert.ok(docs.includes(text), `Phase 15 docs must include: ${text}`);
}

console.log("Transport Phase 15 Cloud Run Job worker acceptance passed");
