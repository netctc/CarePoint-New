import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

const apiRoot = new URL("../", import.meta.url);
const repoRoot = new URL("../../../", import.meta.url);
const readApi = (path) => readFile(new URL(path, apiRoot), "utf8");
const readRepo = (path) => readFile(new URL(path, repoRoot), "utf8");
const exists = async (path) => {
  try {
    await access(new URL(path, repoRoot));
    return true;
  } catch {
    return false;
  }
};

const [
  manifestText,
  packageText,
  phase28Text,
  workerText,
  schedulerText,
  ciText,
  slice8Text,
  rcEvidence,
  uatWorkflow,
  promotionWorkflow,
  productionWorkflow,
  docs,
] = await Promise.all([
  readRepo("ops/transport/transport-release-readiness-phase31.json"),
  readApi("package.json"),
  readRepo("ops/transport/transport-e2e-acceptance-phase28.json"),
  readRepo("ops/release-1/gcp-transport-report-worker-contract.json"),
  readRepo("ops/release-1/gcp-worker-scheduler-deployment-contract.json"),
  readRepo(".github/workflows/ci.yml"),
  readApi("scripts/slice8-smoke.mjs"),
  readRepo(".github/workflows/release-candidate-evidence.yml"),
  readRepo(".github/workflows/uat-evidence-contract.yml"),
  readRepo(".github/workflows/promotion-policy-evidence-contract.yml"),
  readRepo(".github/workflows/production-infrastructure-contract.yml"),
  readRepo("docs/transport-release-readiness-phase31.md"),
]);

const manifest = JSON.parse(manifestText);
const pkg = JSON.parse(packageText);
const phase28 = JSON.parse(phase28Text);
const worker = JSON.parse(workerText);
const scheduler = JSON.parse(schedulerText);

assert.equal(manifest.schemaVersion, 1);
assert.equal(manifest.scope, "transport-phases-5-30");
assert.equal(
  manifest.readinessState,
  "CODE_ACCEPTANCE_READY_PRODUCTION_EVIDENCE_REQUIRED",
);
assert.equal(manifest.productionAcceptance, false);
assert.equal(manifest.directMainMergeAllowed, false);
assert.equal(manifest.releaseDecision.codeMergeCandidate, true);
assert.equal(manifest.releaseDecision.productionDeployCandidate, false);

for (const section of [
  manifest.codeAcceptance.integrationClosure,
  manifest.codeAcceptance.sourceEndToEnd,
  manifest.codeAcceptance.postgresTransactional,
  manifest.codeAcceptance.advancedLiveHttp,
]) {
  for (const key of ["smoke"]) {
    assert.equal(typeof section[key], "string");
    assert.equal(await exists(section[key]), true, "missing Phase 31 referenced file: " + section[key]);
  }
}
for (const path of [
  manifest.codeAcceptance.integrationClosure.contract,
  manifest.codeAcceptance.sourceEndToEnd.contract,
  manifest.codeAcceptance.postgresTransactional.runtimeAcceptance,
  manifest.codeAcceptance.advancedLiveHttp.runtimeAcceptance,
  manifest.codeAcceptance.advancedLiveHttp.liveRunner,
  manifest.productionEvidence.workerContract,
  manifest.productionEvidence.schedulerContract,
  ...manifest.canonicalValidation.workflows,
]) {
  assert.equal(await exists(path), true, "missing release-readiness evidence path: " + path);
}

for (const phase of [27, 28, 29, 30]) {
  const name = "v2:transport-phase" + phase;
  assert.equal(typeof pkg.scripts[name], "string", "missing package script " + name);
  assert.ok(pkg.scripts.test.includes("npm run " + name), "full API test chain must include " + name);
}
assert.equal(
  pkg.scripts["v2:transport-phase31"],
  "node scripts/v2-transport-phase31-smoke.mjs",
);
assert.ok(pkg.scripts.test.includes("npm run v2:transport-phase31"));

const deployIndex = ciText.indexOf("- run: npm run db:deploy");
const postgresIndex = ciText.indexOf("Transport Phase 29 PostgreSQL transactional acceptance");
const bootstrapIndex = ciText.indexOf("- run: npm run db:bootstrap");
assert.ok(deployIndex >= 0 && postgresIndex > deployIndex && bootstrapIndex > postgresIndex);
assert.ok(
  slice8Text.includes('await import("./v2-transport-phase30-live-http.mjs");'),
  "Phase 30 live acceptance must remain chained from Slice 8",
);

assert.equal(phase28.productionAcceptance, false);
assert.equal(phase28.fullMatrixStillRequired, true);
assert.equal(phase28.liveUatEvidenceStillRequired, true);

for (const contract of [worker, scheduler]) {
  assert.equal(contract.productionAcceptance, false);
  assert.equal(contract.provider, "gcp");
  assert.equal(contract.jurisdiction, "SA");
  assert.equal(contract.region, "me-central2");
}
for (const key of [
  "liveDeploymentEvidenceRequired",
  "schedulerInvocationEvidenceRequired",
  "workerLeaseIdempotencyEvidenceRequired",
  "failureRecoveryEvidenceRequired",
]) {
  assert.equal(worker.acceptance[key], true, "worker production evidence must remain required: " + key);
  assert.equal(scheduler.acceptance[key], true, "scheduler production evidence must remain required: " + key);
}

assert.equal(
  scheduler.identity.staticServiceAccountKeysAllowed,
  false,
);
assert.equal(
  scheduler.identity.staticAccessTokensAllowed,
  false,
);
assert.equal(
  scheduler.scheduledWork.publicUnauthenticatedInvocationAllowed,
  false,
);
assert.equal(
  worker.scheduler.publicUnauthenticatedInvocationAllowed,
  false,
);

for (const workflow of [rcEvidence, uatWorkflow, promotionWorkflow, productionWorkflow]) {
  assert.ok(workflow.includes("concurrency:"), "release evidence workflow must define concurrency");
}
for (const branch of ["- main", "- v2/development", "- entorno-v2", '- "release/**"']) {
  assert.ok(rcEvidence.includes(branch), "RC evidence must target canonical branch: " + branch);
}

for (const [key, value] of Object.entries(manifest.privacyBoundary)) {
  assert.equal(value, false, "privacy boundary must remain false: " + key);
}

const requiredEvidence = new Set(manifest.productionEvidence.required);
for (const item of [
  "live-cloud-run-job-deployment",
  "cloud-scheduler-oidc-invocation",
  "worker-lease-idempotency",
  "failure-recovery",
  "private-regional-object-storage",
  "immutable-release-candidate-digest",
  "production-observability-and-siem",
  "live-uat",
  "promotion-approval",
]) {
  assert.equal(requiredEvidence.has(item), true, "missing production evidence requirement: " + item);
}

const serialized = JSON.stringify(manifest);
for (const forbidden of [
  "secretValue",
  "credentialValue",
  "privateKey",
  "accessToken",
  ".env",
]) {
  assert.equal(serialized.includes(forbidden), false, "release-readiness manifest contains forbidden material: " + forbidden);
}

for (const text of [
  "Transport Release Readiness Gate",
  "CODE_ACCEPTANCE_READY_PRODUCTION_EVIDENCE_REQUIRED",
  "productionAcceptance=false",
  "code merge candidate",
  "not a production deployment approval",
  "No new production environment variables",
  "No .env file",
]) {
  assert.ok(docs.includes(text), "Phase 31 docs must include: " + text);
}

console.log(
  "Transport Phase 31 release-readiness gate passed: code acceptance is mapped while production evidence remains explicitly required.",
);
