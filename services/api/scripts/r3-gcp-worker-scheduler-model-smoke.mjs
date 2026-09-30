import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const contractUrl = new URL("../../../ops/release-1/gcp-worker-scheduler-deployment-contract.json", import.meta.url);
const modelUrl = new URL("../../../ops/release-1/gcp-worker-scheduler-deployment-model.md", import.meta.url);
const packageUrl = new URL("../package.json", import.meta.url);

const contract = JSON.parse(await readFile(contractUrl, "utf8"));
const model = await readFile(modelUrl, "utf8");
const packageJson = JSON.parse(await readFile(packageUrl, "utf8"));

assert.equal(contract.schemaVersion, 1);
assert.equal(contract.productionAcceptance, false, "repository contract must never self-approve production");
assert.equal(contract.provider, "gcp");
assert.equal(contract.jurisdiction, "SA");
assert.equal(contract.region, "me-central2");
assert.equal(contract.releaseProfile, "release-1-gcp-readiness");

assert.deepEqual(contract.artifactPolicy, {
  immutableDigestRequired: true,
  sameReleaseCandidateAsApi: true,
  mutableTagsAcceptedAsEvidence: false,
});

assert.equal(contract.backgroundWorkers.mode, "api-colocated");
assert.equal(contract.backgroundWorkers.runtime, "cloud-run-service");
assert.equal(contract.backgroundWorkers.scaleToZeroAllowed, false);
assert.equal(contract.backgroundWorkers.minimumWarmInstancesRequired, true);
assert.equal(contract.backgroundWorkers.backgroundCpuRequired, true);
assert.equal(contract.backgroundWorkers.leaseOrIdempotencyRequired, true);
assert.equal(contract.backgroundWorkers.publicUnauthenticatedIngressAllowed, false);

assert.equal(contract.scheduledWork.runtime, "cloud-run-job");
assert.equal(contract.scheduledWork.scheduler, "cloud-scheduler");
assert.equal(contract.scheduledWork.schedulerRegion, "me-central2");
assert.equal(contract.scheduledWork.invocationAuth, "oidc-service-account");
assert.equal(contract.scheduledWork.publicUnauthenticatedInvocationAllowed, false);
assert.equal(contract.scheduledWork.manualCabExecutionSupported, true);

assert.equal(contract.queueing.currentDurablePattern, "database-outbox");
assert.equal(contract.queueing.cloudTasksAllowedForFutureDiscreteWork, true);
assert.equal(contract.queueing.cloudTasksRegion, "me-central2");

assert.equal(contract.identity.runtimeIdentity, "attached-service-account");
assert.equal(contract.identity.staticServiceAccountKeysAllowed, false);
assert.equal(contract.identity.staticAccessTokensAllowed, false);

assert.equal(contract.dataPlane.privateDatabaseConnectivityRequired, true);
assert.equal(contract.dataPlane.privateRedisConnectivityRequired, true);
assert.equal(contract.dataPlane.regionalSecretManagerRequired, true);
assert.equal(contract.dataPlane.approvedDataRegion, "me-central2");

assert.equal(contract.operations.structuredLoggingRequired, true);
assert.equal(contract.operations.otlpRequired, true);
assert.equal(contract.operations.siemRequired, true);
assert.equal(contract.operations.boundedRetriesRequired, true);
assert.equal(contract.operations.failedWorkMustRemainRecoverable, true);

assert.equal(contract.acceptance.liveDeploymentEvidenceRequired, true);
assert.equal(contract.acceptance.schedulerInvocationEvidenceRequired, true);
assert.equal(contract.acceptance.workerLeaseIdempotencyEvidenceRequired, true);
assert.equal(contract.acceptance.failureRecoveryEvidenceRequired, true);
assert.equal(contract.acceptance.geographicDrProven, false);
assert.equal(contract.acceptance.rpoRtoProven, false);

for (const requiredText of [
  "engineering readiness contract / not production acceptance",
  "API-colocated",
  "scale-to-zero is forbidden",
  "Cloud Run Jobs",
  "Cloud Scheduler",
  "me-central2",
  "authenticated OIDC/service-account invocation",
  "database-backed outbox",
  "Multi-zone execution inside Dammam is availability engineering",
  "Live evidence required before R3-GCP acceptance",
  "productionAcceptance",
  "no second approved Google Cloud KSA region",
]) {
  assert.ok(model.includes(requiredText), `worker/scheduler deployment model must include: ${requiredText}`);
}

assert.equal(
  packageJson.scripts["r3:gcp-worker-scheduler-model"],
  "node scripts/r3-gcp-worker-scheduler-model-smoke.mjs",
);
assert.ok(
  packageJson.scripts.test.includes("npm run r3:gcp-worker-scheduler-model"),
  "API test chain must execute the GCP worker/scheduler deployment-model smoke",
);

console.log("R3 GCP worker/scheduler deployment model acceptance passed");
