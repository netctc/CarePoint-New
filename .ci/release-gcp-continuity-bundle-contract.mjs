#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const MANIFEST_SCHEMA = "carepoint.release1-gcp-continuity-bundle-manifest/v1";
const RESULT_SCHEMA = "carepoint.release1-gcp-continuity-bundle-result/v1";
const CONTRACT_SCHEMA = "carepoint.release1-gcp-continuity-bundle-contract/v1";
const PHASE = "G6d";
const REGION = "me-central2";
const JURISDICTION = "SA";
const MAX_RPO_SECONDS = 900;
const MAX_RTO_SECONDS = 7200;
const SHA40 = /^[0-9a-f]{40}$/;
const VERSION = /^[0-9A-Za-z][0-9A-Za-z._+-]{0,63}$/;
const G6A_SCHEMA = "carepoint.release1-gcp-cloud-sql-pitr-rehearsal/v1";
const G6B_SCHEMA = "carepoint.release1-gcp-memorystore-failover-rehearsal/v1";
const G6C_SCHEMA = "carepoint.release1-gcp-cloud-storage-recovery/v1";
const G6A_VALIDATOR = ".ci/release-gcp-cloud-sql-pitr-rehearsal-contract.mjs";
const G6B_VALIDATOR = ".ci/release-gcp-memorystore-failover-rehearsal-contract.mjs";
const G6C_VALIDATOR = ".ci/release-gcp-cloud-storage-recovery-contract.mjs";

function fail(message) { throw new Error(message); }
function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object.`);
  return value;
}
function string(value, label) {
  if (typeof value !== "string" || !value.trim()) fail(`${label} must be a non-empty string.`);
  const result = value.trim();
  if (result.length > 1000 || /[\r\n\0]/.test(result)) fail(`${label} must be a bounded single-line string.`);
  return result;
}
function bool(value, label) {
  if (typeof value !== "boolean") fail(`${label} must be boolean.`);
  return value;
}
function integer(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) fail(`${label} must be a non-negative integer.`);
  return value;
}
function isPlaceholder(value) {
  return typeof value === "string" && value.startsWith("REPLACE_WITH_");
}
function real(value, label) {
  const result = string(value, label);
  if (isPlaceholder(result)) fail(`${label} is still a placeholder.`);
  return result;
}
function safeRef(value, label, { allowPlaceholder = false } = {}) {
  const result = string(value, label);
  if (allowPlaceholder && isPlaceholder(result)) return result;
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/#@+\-]{0,511}$/.test(result)) fail(`${label} must be an opaque non-secret reference.`);
  return result;
}
function assertNoSensitiveMaterial(value, path = "root") {
  if (typeof value === "string") {
    if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(value)) fail(`${path} contains private-key material.`);
    if (/"private_key"\s*:/.test(value)) fail(`${path} contains service-account private-key material.`);
    if (/\b(?:ya29\.|AIza[0-9A-Za-z_-]{20,}|gh[pousr]_[0-9A-Za-z]{20,})/.test(value)) fail(`${path} appears to contain a credential/token.`);
    if (/postgres(?:ql)?:\/\//i.test(value)) fail(`${path} must not contain a database connection string.`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSensitiveMaterial(item, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (/^(password|privateKey|private_key|secretValue|accessToken|refreshToken|apiKey|credentialsJson|databaseUrl|token)$/i.test(key)) {
        fail(`${path}.${key} is forbidden in continuity evidence.`);
      }
      assertNoSensitiveMaterial(child, `${path}.${key}`);
    }
  }
}

function validateManifest(manifest) {
  manifest = object(manifest, "manifest");
  assertNoSensitiveMaterial(manifest);
  if (manifest.schema !== MANIFEST_SCHEMA) fail(`schema must be ${MANIFEST_SCHEMA}.`);
  if (manifest.phase !== PHASE) fail(`phase must be ${PHASE}.`);

  const release = object(manifest.release, "release");
  string(release.sourceSha, "release.sourceSha");
  string(release.releaseVersion, "release.releaseVersion");
  safeRef(release.g5BundleEvidenceRef, "release.g5BundleEvidenceRef", { allowPlaceholder: true });

  const evidence = object(manifest.evidence, "evidence");
  for (const name of ["g6aCloudSql", "g6bMemorystore", "g6cCloudStorage"]) {
    safeRef(evidence[name], `evidence.${name}`, { allowPlaceholder: true });
  }

  const controls = object(manifest.controls, "controls");
  for (const name of [
    "exactRcIdentityAcrossSlices",
    "g5BundleReferenceAligned",
    "cloudSqlPitrValidated",
    "memorystoreFailoverValidated",
    "cloudStorageRestoreValidated",
    "rpoObjectiveMet",
    "rtoObjectiveMet",
    "secondSaudiRegionApproved",
    "geographicDrClaimed",
    "phaseComplete",
  ]) bool(controls[name], `controls.${name}`);

  if (controls.secondSaudiRegionApproved !== false) fail("G6d must not invent approval for a second GCP Saudi region.");
  if (controls.geographicDrClaimed !== false) fail("G6d single-region continuity evidence must not claim geographic DR.");
  if (bool(manifest.productionRecoveryEvidence, "productionRecoveryEvidence") !== false) fail("Manifest must keep productionRecoveryEvidence=false.");
  if (bool(manifest.productionAcceptance, "productionAcceptance") !== false) fail("G6d cannot grant production acceptance.");
  if (bool(manifest.bundleComplete, "bundleComplete") !== false) fail("Manifest must keep bundleComplete=false.");
  return manifest;
}

function runPhaseValidators(g6aPath, g6bPath, g6cPath, expectedSourceSha) {
  execFileSync(process.execPath, [G6A_VALIDATOR, "--validate", g6aPath], { stdio: "pipe" });
  execFileSync(process.execPath, [G6B_VALIDATOR, "--validate-final", g6bPath], { stdio: "pipe" });
  execFileSync(process.execPath, [G6C_VALIDATOR, "--validate-final", g6cPath, expectedSourceSha], { stdio: "pipe" });
}

function validateBundle(g6a, g6b, g6c, { expectedSourceSha } = {}) {
  assertNoSensitiveMaterial(g6a, "g6a");
  assertNoSensitiveMaterial(g6b, "g6b");
  assertNoSensitiveMaterial(g6c, "g6c");

  if (g6a.schema !== G6A_SCHEMA || g6a.phase !== "G6a") fail("G6a Cloud SQL evidence schema/phase mismatch.");
  if (g6b.schema !== G6B_SCHEMA || g6b.phase !== "G6b") fail("G6b Memorystore evidence schema/phase mismatch.");
  if (g6c.schema !== G6C_SCHEMA || g6c.phase !== "G6c") fail("G6c Cloud Storage evidence schema/phase mismatch.");

  const sourceSha = real(g6a.release?.sourceSha, "g6a.release.sourceSha");
  if (!SHA40.test(sourceSha)) fail("G6a source SHA must be an exact lowercase 40-hex Git SHA.");
  if (expectedSourceSha && sourceSha !== expectedSourceSha) fail(`G6 source SHA ${sourceSha} does not match exact checkout ${expectedSourceSha}.`);
  if (g6b.sourceSha !== sourceSha || g6c.sourceSha !== sourceSha) fail("G6a/G6b/G6c must bind to the same exact frozen RC SHA.");

  const releaseVersion = real(g6a.release?.releaseVersion, "g6a.release.releaseVersion");
  if (!VERSION.test(releaseVersion)) fail("G6 release version format is invalid.");
  if (g6b.releaseVersion !== releaseVersion || g6c.releaseVersion !== releaseVersion) fail("G6a/G6b/G6c release versions must match exactly.");

  const g5BundleEvidenceRef = real(g6a.release?.g5BundleEvidenceRef, "g6a.release.g5BundleEvidenceRef");
  if (g6b.g5BundleEvidenceRef !== g5BundleEvidenceRef || g6c.g5BundleEvidenceRef !== g5BundleEvidenceRef) {
    fail("G6a/G6b/G6c must reference the same G5e immutable deployment bundle.");
  }

  if (g6a.topology?.provider !== "gcp" || g6b.provider !== "gcp" || g6c.provider !== "gcp") fail("All G6 slices must use provider gcp.");
  if (g6a.topology?.jurisdiction !== JURISDICTION || g6b.jurisdiction !== JURISDICTION || g6c.jurisdiction !== JURISDICTION) fail("All G6 slices must remain in jurisdiction SA.");
  if (g6a.topology?.region !== REGION || g6b.region !== REGION || g6c.region !== REGION) fail(`All G6 slices must remain in ${REGION}.`);

  if (g6a.controls?.productionRecoveryEvidence !== true) fail("G6a final productionRecoveryEvidence must be true.");
  if (g6b.controls?.productionRecoveryEvidence !== true) fail("G6b final productionRecoveryEvidence must be true.");
  if (g6c.controls?.productionRecoveryEvidence !== true) fail("G6c final productionRecoveryEvidence must be true.");

  if (g6a.productionAcceptance !== false || g6b.controls?.productionAcceptance !== false || g6c.controls?.productionAcceptance !== false) {
    fail("G6 evidence cannot grant production acceptance.");
  }
  if (g6a.topology?.geographicDrProven !== false || g6a.controls?.geographicDrClaimed !== false || g6b.controls?.geographicDrClaimed !== false || g6c.controls?.geographicDrClaimed !== false) {
    fail("G6 regional continuity evidence cannot be used as geographic-DR proof.");
  }

  const cloudSqlRpoSeconds = integer(g6a.metrics?.rpoSeconds, "g6a.metrics.rpoSeconds");
  const cloudSqlRtoSeconds = integer(g6a.metrics?.rtoSeconds, "g6a.metrics.rtoSeconds");
  const memorystoreRtoSeconds = integer(g6b.applicationRecoverySeconds, "g6b.applicationRecoverySeconds");
  const cloudStorageRpoSeconds = integer(g6c.rehearsal?.measuredRpoSeconds, "g6c.rehearsal.measuredRpoSeconds");
  const cloudStorageRtoSeconds = integer(g6c.rehearsal?.measuredRtoSeconds, "g6c.rehearsal.measuredRtoSeconds");

  const overallRpoSeconds = Math.max(cloudSqlRpoSeconds, cloudStorageRpoSeconds);
  const overallRtoSeconds = Math.max(cloudSqlRtoSeconds, memorystoreRtoSeconds, cloudStorageRtoSeconds);
  if (overallRpoSeconds > MAX_RPO_SECONDS) fail(`Measured applicable RPO ${overallRpoSeconds}s exceeds ${MAX_RPO_SECONDS}s objective.`);
  if (overallRtoSeconds > MAX_RTO_SECONDS) fail(`Measured RTO ${overallRtoSeconds}s exceeds ${MAX_RTO_SECONDS}s objective.`);

  return {
    schema: RESULT_SCHEMA,
    phase: PHASE,
    sourceSha,
    releaseVersion,
    provider: "gcp",
    jurisdiction: JURISDICTION,
    region: REGION,
    g5BundleEvidenceRef,
    recovery: {
      cloudSql: { rpoSeconds: cloudSqlRpoSeconds, rtoSeconds: cloudSqlRtoSeconds },
      memorystore: { rpoApplicable: false, rtoSeconds: memorystoreRtoSeconds },
      cloudStorage: { rpoSeconds: cloudStorageRpoSeconds, rtoSeconds: cloudStorageRtoSeconds },
      overallApplicableRpoSeconds: overallRpoSeconds,
      overallRtoSeconds,
      rpoObjectiveSeconds: MAX_RPO_SECONDS,
      rtoObjectiveSeconds: MAX_RTO_SECONDS,
    },
    controls: {
      exactRcIdentityAcrossSlices: true,
      g5BundleReferenceAligned: true,
      cloudSqlPitrValidated: true,
      memorystoreFailoverValidated: true,
      cloudStorageRestoreValidated: true,
      rpoObjectiveMet: true,
      rtoObjectiveMet: true,
      secondSaudiRegionApproved: false,
      geographicDrClaimed: false,
      phaseComplete: true,
    },
    productionRecoveryEvidence: true,
    geographicDrProven: false,
    productionAcceptance: false,
  };
}

function fixture() {
  const sourceSha = "a".repeat(40);
  const version = "r1.0.0-rc.1";
  const g5 = "restricted://gcp/g5e/example";
  const g6a = {
    schema: G6A_SCHEMA, phase: "G6a", productionAcceptance: false,
    release: { sourceSha, releaseVersion: version, g5BundleEvidenceRef: g5 },
    topology: { provider: "gcp", jurisdiction: JURISDICTION, region: REGION, geographicDrProven: false },
    metrics: { rpoSeconds: 300, rtoSeconds: 1200 },
    controls: { geographicDrClaimed: false, productionRecoveryEvidence: true },
  };
  const g6b = {
    schema: G6B_SCHEMA, phase: "G6b", provider: "gcp", jurisdiction: JURISDICTION, region: REGION,
    sourceSha, releaseVersion: version, g5BundleEvidenceRef: g5,
    applicationRecoverySeconds: 90,
    controls: { geographicDrClaimed: false, productionRecoveryEvidence: true, productionAcceptance: false },
  };
  const g6c = {
    schema: G6C_SCHEMA, phase: "G6c", provider: "gcp", jurisdiction: JURISDICTION, region: REGION,
    sourceSha, releaseVersion: version, g5BundleEvidenceRef: g5,
    rehearsal: { measuredRpoSeconds: 0, measuredRtoSeconds: 60 },
    controls: { geographicDrClaimed: false, productionRecoveryEvidence: true, productionAcceptance: false },
  };
  return { sourceSha, g6a, g6b, g6c };
}

function expectFailure(fn, label) {
  let rejected = false;
  try { fn(); } catch { rejected = true; }
  if (!rejected) fail(`Self-test expected rejection did not occur: ${label}`);
}

function selfTest() {
  const { sourceSha, g6a, g6b, g6c } = fixture();
  validateBundle(g6a, g6b, g6c, { expectedSourceSha: sourceSha });

  const shaMismatch = structuredClone(g6b); shaMismatch.sourceSha = "b".repeat(40);
  expectFailure(() => validateBundle(g6a, shaMismatch, g6c, { expectedSourceSha: sourceSha }), "source SHA mismatch");
  const versionMismatch = structuredClone(g6c); versionMismatch.releaseVersion = "r1.0.0-rc.2";
  expectFailure(() => validateBundle(g6a, g6b, versionMismatch, { expectedSourceSha: sourceSha }), "version mismatch");
  const g5Mismatch = structuredClone(g6b); g5Mismatch.g5BundleEvidenceRef = "restricted://gcp/g5e/other";
  expectFailure(() => validateBundle(g6a, g5Mismatch, g6c, { expectedSourceSha: sourceSha }), "G5 bundle mismatch");
  const rpo = structuredClone(g6c); rpo.rehearsal.measuredRpoSeconds = 901;
  expectFailure(() => validateBundle(g6a, g6b, rpo, { expectedSourceSha: sourceSha }), "RPO breach");
  const rto = structuredClone(g6b); rto.applicationRecoverySeconds = 7201;
  expectFailure(() => validateBundle(g6a, rto, g6c, { expectedSourceSha: sourceSha }), "RTO breach");
  const geo = structuredClone(g6c); geo.controls.geographicDrClaimed = true;
  expectFailure(() => validateBundle(g6a, g6b, geo, { expectedSourceSha: sourceSha }), "geographic DR claim");
  const incomplete = structuredClone(g6a); incomplete.controls.productionRecoveryEvidence = false;
  expectFailure(() => validateBundle(incomplete, g6b, g6c, { expectedSourceSha: sourceSha }), "incomplete recovery evidence");
  console.log("G6d continuity bundle contract self-test passed");
}

function contractEvidence(manifestPath, outPath) {
  validateManifest(JSON.parse(readFileSync(manifestPath, "utf8")));
  const result = {
    schema: CONTRACT_SCHEMA,
    phase: PHASE,
    region: REGION,
    workflowPurpose: "contract-validation-only",
    bundleComplete: false,
    productionRecoveryEvidence: false,
    secondSaudiRegionApproved: false,
    geographicDrClaimed: false,
    productionAcceptance: false,
  };
  writeFileSync(outPath, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
}

const [command, ...args] = process.argv.slice(2);
if (command === "--self-test") selfTest();
else if (command === "--validate-manifest") {
  validateManifest(JSON.parse(readFileSync(args[0], "utf8")));
  console.log("G6d continuity bundle manifest valid");
} else if (command === "--contract-evidence") {
  contractEvidence(args[0], args[1]);
  console.log(`Wrote ${args[1]}`);
} else if (command === "--validate-bundle") {
  const [g6aPath, g6bPath, g6cPath] = args;
  const outIndex = args.indexOf("--out");
  const outPath = outIndex >= 0 ? args[outIndex + 1] : null;
  const expectedSourceSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  runPhaseValidators(g6aPath, g6bPath, g6cPath, expectedSourceSha);
  const result = validateBundle(
    JSON.parse(readFileSync(g6aPath, "utf8")),
    JSON.parse(readFileSync(g6bPath, "utf8")),
    JSON.parse(readFileSync(g6cPath, "utf8")),
    { expectedSourceSha },
  );
  if (outPath) writeFileSync(outPath, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify(result));
} else {
  fail("Usage: --self-test | --validate-manifest <json> | --contract-evidence <manifest> <out> | --validate-bundle <g6a> <g6b> <g6c> [--out <file>]");
}
