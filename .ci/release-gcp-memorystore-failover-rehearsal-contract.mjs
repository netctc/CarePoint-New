import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

const SCHEMA = "carepoint.release1-gcp-memorystore-failover-rehearsal/v1";
const CONTRACT_SCHEMA = "carepoint.release1-gcp-memorystore-failover-contract/v1";
const PHASE = "G6b";
const REGION = "me-central2";
const JURISDICTION = "SA";
const MAX_RTO_SECONDS = 120 * 60;
const SHA256 = /^sha256:[0-9a-f]{64}$/;
const SHA40 = /^[0-9a-f]{40}$/;
const VERSION = /^[0-9A-Za-z][0-9A-Za-z._+-]{0,63}$/;
const RFC3339_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

function fail(message) {
  throw new Error(message);
}
function assert(condition, message) {
  if (!condition) fail(message);
}
function object(value, name) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${name} must be an object.`);
  return value;
}
function string(value, name) {
  assert(typeof value === "string" && value.trim(), `${name} must be a non-empty string.`);
  return value.trim();
}
function bool(value, name) {
  assert(typeof value === "boolean", `${name} must be boolean.`);
  return value;
}
function integer(value, name) {
  assert(Number.isSafeInteger(value) && value >= 0, `${name} must be a non-negative integer.`);
  return value;
}
function utc(value, name) {
  const result = string(value, name);
  assert(RFC3339_UTC.test(result) && Number.isFinite(Date.parse(result)), `${name} must be RFC3339 UTC.`);
  return result;
}
function evidenceRef(value, name) {
  const result = string(value, name);
  assert(result.length <= 512, `${name} is too long.`);
  assert(!/[\r\n\0]/.test(result), `${name} contains invalid characters.`);
  return result;
}
function hash(value, name) {
  const result = string(value, name);
  assert(SHA256.test(result), `${name} must be a sha256 evidence hash.`);
  return result;
}

function inspect(evidence, { final = false } = {}) {
  const root = object(evidence, "evidence");
  assert(root.schema === SCHEMA, `schema must be ${SCHEMA}.`);
  assert(root.phase === PHASE, `phase must be ${PHASE}.`);
  assert(root.provider === "gcp", "provider must be gcp.");
  assert(root.jurisdiction === JURISDICTION, `jurisdiction must be ${JURISDICTION}.`);
  assert(root.region === REGION, `region must be ${REGION}.`);

  const sourceSha = string(root.sourceSha, "sourceSha");
  assert(SHA40.test(sourceSha), "sourceSha must be an exact 40-hex commit SHA.");
  const releaseVersion = string(root.releaseVersion, "releaseVersion");
  assert(VERSION.test(releaseVersion), "releaseVersion format is invalid.");
  evidenceRef(root.g5BundleEvidenceRef, "g5BundleEvidenceRef");

  assert(root.cacheRole === "ephemeral-non-authoritative", "cacheRole must be ephemeral-non-authoritative.");
  assert(root.authoritativeDataStored === false, "Memorystore must not be represented as authoritative data storage.");
  assert(root.cacheStateMayBeLost === true, "cacheStateMayBeLost must remain true for Memorystore failover evidence.");
  assert(root.dataProtectionMode === "limited-data-loss", "Only limited-data-loss mode is accepted for the rehearsal.");

  const sourceHash = hash(root.sourceInstanceEvidenceHash, "sourceInstanceEvidenceHash");
  const postHash = hash(root.postFailoverInstanceEvidenceHash, "postFailoverInstanceEvidenceHash");
  assert(sourceHash === postHash, "Pre/post failover hashes must identify the same logical Memorystore instance.");

  const started = utc(root.failoverStartedAtUtc, "failoverStartedAtUtc");
  const ready = utc(root.controlPlaneReadyAtUtc, "controlPlaneReadyAtUtc");
  const appReady = utc(root.applicationRecoveryValidatedAtUtc, "applicationRecoveryValidatedAtUtc");
  const startedMs = Date.parse(started);
  const readyMs = Date.parse(ready);
  const appReadyMs = Date.parse(appReady);
  assert(readyMs >= startedMs, "controlPlaneReadyAtUtc must not precede failoverStartedAtUtc.");
  assert(appReadyMs >= readyMs, "applicationRecoveryValidatedAtUtc must not precede controlPlaneReadyAtUtc.");

  const controlPlaneRecoverySeconds = integer(root.controlPlaneRecoverySeconds, "controlPlaneRecoverySeconds");
  const applicationRecoverySeconds = integer(root.applicationRecoverySeconds, "applicationRecoverySeconds");
  assert(controlPlaneRecoverySeconds === Math.floor((readyMs - startedMs) / 1000), "controlPlaneRecoverySeconds does not match timestamps.");
  assert(applicationRecoverySeconds === Math.floor((appReadyMs - startedMs) / 1000), "applicationRecoverySeconds does not match timestamps.");
  assert(applicationRecoverySeconds <= MAX_RTO_SECONDS, `Application recovery exceeds the Release 1 RTO objective of ${MAX_RTO_SECONDS}s.`);

  evidenceRef(root.applicationValidationEvidenceRef, "applicationValidationEvidenceRef");
  evidenceRef(root.monitoringEvidenceRef, "monitoringEvidenceRef");

  const controls = object(root.controls, "controls");
  const requiredTrue = [
    "keylessAuthentication",
    "sourcePreflightVerified",
    "manualFailoverInvoked",
    "limitedDataLossMode",
    "instanceReadyAfterFailover",
    "sameInstanceIdentity",
    "sameKsaRegion",
    "primaryZoneChanged",
    "privateTlsAuthControlsPreserved",
    "applicationReconnectValidated",
    "healthReadinessRecovered",
    "redisBackedSecurityCanaryValidated",
    "rateLimitPathValidated",
  ];
  for (const name of requiredTrue) {
    const value = bool(controls[name], `controls.${name}`);
    if (final) assert(value === true, `controls.${name} must be true for final G6b evidence.`);
  }
  assert(bool(controls.forceDataLossUsed, "controls.forceDataLossUsed") === false, "force-data-loss mode is forbidden for Release 1 G6b evidence.");
  assert(bool(controls.geographicDrClaimed, "controls.geographicDrClaimed") === false, "Single-region Memorystore HA must not be claimed as geographic DR.");
  assert(bool(controls.productionAcceptance, "controls.productionAcceptance") === false, "G6b cannot grant production acceptance.");
  const recoveryEvidence = bool(controls.productionRecoveryEvidence, "controls.productionRecoveryEvidence");
  if (final) assert(recoveryEvidence === true, "Final G6b evidence must set productionRecoveryEvidence=true.");
  else assert(recoveryEvidence === false, "Template/contract evidence must keep productionRecoveryEvidence=false.");

  return { sourceSha, releaseVersion, applicationRecoverySeconds };
}

function validateWorkflow(path) {
  const text = readFileSync(path, "utf8");
  const required = [
    "workflow_dispatch:",
    "id-token: write",
    "gcp-production-equivalent",
    "google-github-actions/auth@7c6bc770dae815cd3e89ee6cdf493a5fab2cc093",
    "google-github-actions/setup-gcloud@aa5489c8933f4cc7a4f7d45035b3b1440c9c10db",
    "gcloud redis instances describe",
    "gcloud redis instances failover",
    "--data-protection-mode=limited-data-loss",
    "currentLocationId",
    "productionRecoveryEvidence: false",
    "productionAcceptance: false",
    "geographicDrClaimed: false",
  ];
  for (const token of required) assert(text.includes(token), `Live workflow is missing required token: ${token}`);
  const forbidden = [
    "force-data-loss",
    "credentials_json",
    "service_account_key",
    "GOOGLE_APPLICATION_CREDENTIALS:",
    ":latest",
    "pull_request:",
    "push:",
  ];
  for (const token of forbidden) assert(!text.includes(token), `Live workflow contains forbidden token: ${token}`);
  for (const match of text.matchAll(/^\s*uses:\s*([^\s#]+)(?:\s+#.*)?$/gm)) {
    const action = match[1];
    const at = action.lastIndexOf("@");
    assert(at > 0 && /^[0-9a-f]{40}$/.test(action.slice(at + 1)), `Action must be pinned to a full commit SHA: ${action}`);
  }
  return true;
}

function emitContractResult(path, sourceSha) {
  assert(SHA40.test(sourceSha), "Contract result source SHA must be exact 40-hex.");
  const result = {
    schema: CONTRACT_SCHEMA,
    phase: PHASE,
    sourceSha,
    region: REGION,
    workflowPurpose: "contract-validation-only",
    liveFailoverExecuted: false,
    productionRecoveryEvidence: false,
    geographicDrClaimed: false,
    productionAcceptance: false,
  };
  writeFileSync(path, `${JSON.stringify(result, null, 2)}\n`);
}

function selfTest() {
  const base = {
    schema: SCHEMA,
    phase: PHASE,
    provider: "gcp",
    jurisdiction: JURISDICTION,
    region: REGION,
    sourceSha: "a".repeat(40),
    releaseVersion: "1.0.0-rc.1",
    g5BundleEvidenceRef: "restricted://g5e/example",
    cacheRole: "ephemeral-non-authoritative",
    authoritativeDataStored: false,
    cacheStateMayBeLost: true,
    dataProtectionMode: "limited-data-loss",
    sourceInstanceEvidenceHash: `sha256:${"1".repeat(64)}`,
    postFailoverInstanceEvidenceHash: `sha256:${"1".repeat(64)}`,
    failoverStartedAtUtc: "2026-09-17T17:00:00Z",
    controlPlaneReadyAtUtc: "2026-09-17T17:01:00Z",
    applicationRecoveryValidatedAtUtc: "2026-09-17T17:02:00Z",
    controlPlaneRecoverySeconds: 60,
    applicationRecoverySeconds: 120,
    applicationValidationEvidenceRef: "restricted://g6b/application-validation",
    monitoringEvidenceRef: "restricted://g6b/monitoring",
    controls: {
      keylessAuthentication: true,
      sourcePreflightVerified: true,
      manualFailoverInvoked: true,
      limitedDataLossMode: true,
      instanceReadyAfterFailover: true,
      sameInstanceIdentity: true,
      sameKsaRegion: true,
      primaryZoneChanged: true,
      privateTlsAuthControlsPreserved: true,
      applicationReconnectValidated: true,
      healthReadinessRecovered: true,
      redisBackedSecurityCanaryValidated: true,
      rateLimitPathValidated: true,
      forceDataLossUsed: false,
      geographicDrClaimed: false,
      productionRecoveryEvidence: true,
      productionAcceptance: false,
    },
  };
  inspect(base, { final: true });
  const bad = structuredClone(base);
  bad.controls.geographicDrClaimed = true;
  let rejected = false;
  try { inspect(bad, { final: true }); } catch { rejected = true; }
  assert(rejected, "Self-test failed to reject a geographic DR claim.");
  const force = structuredClone(base);
  force.dataProtectionMode = "force-data-loss";
  rejected = false;
  try { inspect(force, { final: true }); } catch { rejected = true; }
  assert(rejected, "Self-test failed to reject force-data-loss mode.");
  const rto = structuredClone(base);
  rto.applicationRecoveryValidatedAtUtc = "2026-09-17T19:00:01Z";
  rto.applicationRecoverySeconds = 7201;
  rejected = false;
  try { inspect(rto, { final: true }); } catch { rejected = true; }
  assert(rejected, "Self-test failed to reject an RTO breach.");
}

const [command, ...args] = process.argv.slice(2);
try {
  if (command === "--self-test") selfTest();
  else if (command === "--validate-template") inspect(JSON.parse(readFileSync(args[0], "utf8")), { final: false });
  else if (command === "--validate-final") inspect(JSON.parse(readFileSync(args[0], "utf8")), { final: true });
  else if (command === "--validate-workflow") validateWorkflow(args[0]);
  else if (command === "--emit-contract-result") emitContractResult(args[0], args[1]);
  else fail("Usage: --self-test | --validate-template <file> | --validate-final <file> | --validate-workflow <file> | --emit-contract-result <file> <sha>");
  process.stdout.write(`GCP ${PHASE} Memorystore failover contract: PASS\n`);
} catch (error) {
  process.stderr.write(`GCP ${PHASE} Memorystore failover contract: FAIL: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
