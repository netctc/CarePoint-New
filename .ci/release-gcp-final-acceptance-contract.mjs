#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { validateEvidence } from "./release-infrastructure-evidence-contract.mjs";
import { validateGcpInfrastructureEvidence } from "./release-infrastructure-gcp-evidence-contract.mjs";

const MANIFEST_SCHEMA = "carepoint.release1-gcp-final-acceptance-manifest/v1";
const RESULT_SCHEMA = "carepoint.release1-gcp-final-acceptance-result/v1";
const CONTRACT_SCHEMA = "carepoint.release1-gcp-final-acceptance-contract/v1";
const PHASE = "G7";
const REGION = "me-central2";
const JURISDICTION = "SA";
const G6_VALIDATOR = ".ci/release-gcp-continuity-bundle-contract.mjs";
const SHA40 = /^[0-9a-f]{40}$/;
const VERSION = /^[0-9A-Za-z][0-9A-Za-z._+-]{0,63}$/;
const APPROVAL_ROLES = ["Operations", "SRE", "Database", "Security", "Privacy", "Product"];

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
function safeRef(value, label, { allowPlaceholder = false } = {}) {
  const result = string(value, label);
  if (allowPlaceholder && result.startsWith("REPLACE_WITH_")) return result;
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/#@+\-]{0,511}$/.test(result)) fail(`${label} must be an opaque non-secret reference.`);
  return result;
}
function real(value, label) {
  const result = string(value, label);
  if (result.startsWith("REPLACE_WITH_")) fail(`${label} is still a placeholder.`);
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
        fail(`${path}.${key} is forbidden in final-acceptance evidence.`);
      }
      assertNoSensitiveMaterial(child, `${path}.${key}`);
    }
  }
}
function currentSha() {
  const sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim().toLowerCase();
  if (!SHA40.test(sha)) fail("Unable to resolve exact checkout SHA.");
  return sha;
}

function validateManifest(manifest, { final = false } = {}) {
  manifest = object(manifest, "manifest");
  assertNoSensitiveMaterial(manifest);
  if (manifest.schema !== MANIFEST_SCHEMA) fail(`schema must be ${MANIFEST_SCHEMA}.`);
  if (manifest.phase !== PHASE) fail(`phase must be ${PHASE}.`);

  const release = object(manifest.release, "release");
  const sourceSha = string(release.sourceSha, "release.sourceSha");
  const releaseVersion = string(release.releaseVersion, "release.releaseVersion");
  safeRef(release.g5BundleEvidenceRef, "release.g5BundleEvidenceRef", { allowPlaceholder: !final });
  if (final) {
    if (!SHA40.test(sourceSha)) fail("release.sourceSha must be an exact lowercase 40-hex Git SHA.");
    if (!VERSION.test(releaseVersion)) fail("release.releaseVersion format is invalid.");
    real(release.g5BundleEvidenceRef, "release.g5BundleEvidenceRef");
  }

  const scope = object(manifest.scope, "scope");
  if (scope.provider !== "gcp") fail("scope.provider must be gcp.");
  if (scope.jurisdiction !== JURISDICTION) fail(`scope.jurisdiction must be ${JURISDICTION}.`);
  if (scope.region !== REGION) fail(`scope.region must be ${REGION}.`);
  if (bool(scope.secondSaudiRegionApproved, "scope.secondSaudiRegionApproved") !== false) {
    fail("G7 must not invent approval for a second Saudi GCP region.");
  }
  if (bool(scope.geographicDrClaimed, "scope.geographicDrClaimed") !== false) {
    fail("G7 must not claim geographic DR from the accepted single-region Release 1 profile.");
  }

  const evidence = object(manifest.evidenceRefs, "evidenceRefs");
  for (const name of ["infrastructure", "g6aCloudSql", "g6bMemorystore", "g6cCloudStorage", "finalRecord"]) {
    safeRef(evidence[name], `evidenceRefs.${name}`, { allowPlaceholder: !final });
    if (final) real(evidence[name], `evidenceRefs.${name}`);
  }
  return manifest;
}

function parseJsonOutput(output, label) {
  const lines = String(output).trim().split(/\r?\n/).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try { return JSON.parse(lines[index]); } catch { /* continue */ }
  }
  fail(`${label} did not emit a JSON result.`);
}

function validateApprovalSet(infrastructure) {
  const approvals = Array.isArray(infrastructure.approvals) ? infrastructure.approvals : [];
  const byRole = new Map(approvals.map((item) => [item?.role, item]));
  for (const role of APPROVAL_ROLES) {
    const approval = object(byRole.get(role), `${role} approval`);
    if (approval.decision !== "APPROVE") fail(`${role} approval must be APPROVE.`);
    real(approval.approverRef, `${role}.approverRef`);
    real(approval.evidenceRef, `${role}.evidenceRef`);
    const approvedAt = real(approval.approvedAt, `${role}.approvedAt`);
    if (!Number.isFinite(Date.parse(approvedAt))) fail(`${role}.approvedAt must be a valid timestamp.`);
  }
  if (byRole.size !== APPROVAL_ROLES.length) fail("Final infrastructure evidence contains unexpected or duplicate approval roles.");
}

async function validateFinal(manifestPath, infrastructurePath, g6aPath, g6bPath, g6cPath) {
  const manifest = validateManifest(JSON.parse(readFileSync(manifestPath, "utf8")), { final: true });
  const checkoutSha = currentSha();
  if (manifest.release.sourceSha !== checkoutSha) {
    fail(`G7 manifest source SHA ${manifest.release.sourceSha} does not match exact checkout ${checkoutSha}.`);
  }

  const infrastructure = JSON.parse(readFileSync(infrastructurePath, "utf8"));
  assertNoSensitiveMaterial(infrastructure, "infrastructure");
  const baseResult = await validateEvidence(infrastructure, { checkoutSha });
  const gcpResult = await validateGcpInfrastructureEvidence(infrastructure, { checkoutSha });
  validateApprovalSet(infrastructure);

  if (infrastructure.release?.sourceSha !== checkoutSha) fail("Infrastructure evidence source SHA does not match exact RC checkout.");
  if (infrastructure.release?.releaseVersion !== manifest.release.releaseVersion) fail("Infrastructure release version does not match G7 manifest.");
  if (infrastructure.residency?.jurisdiction !== JURISDICTION || infrastructure.residency?.primaryRegion !== REGION) {
    fail("Infrastructure evidence does not match the GCP/KSA Release 1 region contract.");
  }

  const g6Output = execFileSync(process.execPath, [
    G6_VALIDATOR,
    "--validate-bundle",
    g6aPath,
    g6bPath,
    g6cPath,
  ], { encoding: "utf8" });
  const g6Result = parseJsonOutput(g6Output, "G6 continuity bundle validator");
  if (g6Result.schema !== "carepoint.release1-gcp-continuity-bundle-result/v1" || g6Result.phase !== "G6d") {
    fail("G6 continuity bundle result schema/phase mismatch.");
  }
  if (g6Result.sourceSha !== checkoutSha) fail("G6 continuity bundle source SHA does not match exact RC checkout.");
  if (g6Result.releaseVersion !== manifest.release.releaseVersion) fail("G6 continuity release version does not match G7 manifest.");
  if (g6Result.g5BundleEvidenceRef !== manifest.release.g5BundleEvidenceRef) fail("G6 continuity bundle and G7 manifest must reference the same G5e immutable deployment bundle.");
  if (g6Result.provider !== "gcp" || g6Result.jurisdiction !== JURISDICTION || g6Result.region !== REGION) fail("G6 continuity bundle topology mismatch.");
  if (g6Result.controls?.phaseComplete !== true || g6Result.productionRecoveryEvidence !== true) fail("G6 continuity bundle is not complete production recovery evidence.");
  if (g6Result.geographicDrProven !== false || g6Result.controls?.geographicDrClaimed !== false || g6Result.controls?.secondSaudiRegionApproved !== false) {
    fail("G6/G7 must not represent regional HA as geographic DR.");
  }

  if (baseResult.productionAcceptance !== true || gcpResult.productionAcceptance !== true) {
    fail("Base and GCP infrastructure validators must both grant final infrastructure acceptance.");
  }

  return {
    schema: RESULT_SCHEMA,
    phase: PHASE,
    sourceSha: checkoutSha,
    releaseVersion: manifest.release.releaseVersion,
    provider: "gcp",
    jurisdiction: JURISDICTION,
    region: REGION,
    g5BundleEvidenceRef: manifest.release.g5BundleEvidenceRef,
    approvalRoles: APPROVAL_ROLES,
    validators: {
      baseInfrastructure: true,
      gcpInfrastructureOverlay: true,
      g6ContinuityBundle: true,
    },
    recovery: g6Result.recovery,
    secondSaudiRegionApproved: false,
    geographicDrProven: false,
    productionRecoveryEvidence: true,
    productionAcceptance: true,
    acceptedAt: infrastructure.acceptedAt,
    finalRecordRef: manifest.evidenceRefs.finalRecord,
  };
}

function syntheticFixture() {
  const sha = "a".repeat(40);
  return {
    schema: MANIFEST_SCHEMA,
    phase: PHASE,
    release: {
      sourceSha: sha,
      releaseVersion: "r1.0.0-rc.1",
      g5BundleEvidenceRef: "restricted://gcp/g5e/example",
    },
    scope: {
      provider: "gcp",
      jurisdiction: JURISDICTION,
      region: REGION,
      secondSaudiRegionApproved: false,
      geographicDrClaimed: false,
    },
    evidenceRefs: {
      infrastructure: "restricted://gcp/g7/infrastructure",
      g6aCloudSql: "restricted://gcp/g6a/cloud-sql",
      g6bMemorystore: "restricted://gcp/g6b/memorystore",
      g6cCloudStorage: "restricted://gcp/g6c/cloud-storage",
      finalRecord: "restricted://gcp/g7/final-acceptance",
    },
  };
}

function expectReject(label, mutate) {
  const value = structuredClone(syntheticFixture());
  mutate(value);
  let rejected = false;
  try { validateManifest(value, { final: true }); } catch { rejected = true; }
  if (!rejected) fail(`Self-test expected rejection: ${label}`);
}
function selfTest() {
  validateManifest(syntheticFixture(), { final: true });
  expectReject("wrong provider", (value) => { value.scope.provider = "oci"; });
  expectReject("wrong region", (value) => { value.scope.region = "me-central1"; });
  expectReject("invented second Saudi region approval", (value) => { value.scope.secondSaudiRegionApproved = true; });
  expectReject("false geographic DR", (value) => { value.scope.geographicDrClaimed = true; });
  expectReject("placeholder final evidence", (value) => { value.evidenceRefs.finalRecord = "REPLACE_WITH_FINAL_RECORD"; });
  console.log("GCP G7 final acceptance contract self-test passed");
}

function emitContractEvidence(manifestPath, outPath) {
  validateManifest(JSON.parse(readFileSync(manifestPath, "utf8")), { final: false });
  const value = {
    schema: CONTRACT_SCHEMA,
    phase: PHASE,
    sourceSha: currentSha(),
    provider: "gcp",
    jurisdiction: JURISDICTION,
    region: REGION,
    requiredApprovalRoles: APPROVAL_ROLES,
    baseInfrastructureValidated: false,
    gcpInfrastructureValidated: false,
    g6ContinuityValidated: false,
    productionRecoveryEvidence: false,
    secondSaudiRegionApproved: false,
    geographicDrProven: false,
    productionAcceptance: false,
    workflowPurpose: "contract-validation-only",
  };
  writeFileSync(outPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

const [command, ...args] = process.argv.slice(2);
try {
  if (command === "--self-test") selfTest();
  else if (command === "--validate-manifest") {
    validateManifest(JSON.parse(readFileSync(args[0], "utf8")), { final: false });
    console.log("G7 manifest valid");
  } else if (command === "--contract-evidence") {
    emitContractEvidence(args[0], args[1]);
    console.log(`Wrote ${args[1]}`);
  } else if (command === "--validate-final") {
    const outIndex = args.indexOf("--out");
    const inputs = outIndex >= 0 ? args.slice(0, outIndex) : args;
    if (inputs.length !== 5) fail("--validate-final requires <manifest> <infrastructure> <g6a> <g6b> <g6c>.");
    const result = await validateFinal(...inputs);
    if (outIndex >= 0) {
      const outPath = args[outIndex + 1];
      if (!outPath) fail("--out requires a path.");
      writeFileSync(outPath, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
    }
    console.log(JSON.stringify(result));
  } else {
    fail("Usage: --self-test | --validate-manifest <json> | --contract-evidence <manifest> <out> | --validate-final <manifest> <infrastructure> <g6a> <g6b> <g6c> [--out <file>]");
  }
} catch (error) {
  console.error(`GCP G7 final acceptance contract: FAIL: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
