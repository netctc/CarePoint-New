#!/usr/bin/env node
import { readFileSync } from "node:fs";

const SCHEMA = "carepoint.release1-gcp-cloud-storage-recovery/v1";
const PHASE = "G6c";
const REGION = "me-central2";
const JURISDICTION = "SA";
const REGIONAL_ENDPOINT = "https://storage.me-central2.rep.googleapis.com/";
const MIN_SOFT_DELETE_SECONDS = 604800;
const MAX_SOFT_DELETE_SECONDS = 7776000;
const MAX_RPO_SECONDS = 900;
const MAX_RTO_SECONDS = 7200;
const SHA256 = /^sha256:[0-9a-f]{64}$/;
const SHA40 = /^[0-9a-f]{40}$/;
const VERSION = /^[0-9A-Za-z][0-9A-Za-z._+-]{0,63}$/;
const RFC3339_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

function fail(message) {
  throw new Error(message);
}

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object.`);
  return value;
}

function requireString(value, label) {
  if (typeof value !== "string" || !value.trim()) fail(`${label} must be a non-empty string.`);
  return value.trim();
}

function requireBoolean(value, label) {
  if (typeof value !== "boolean") fail(`${label} must be boolean.`);
  return value;
}

function requireNonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) fail(`${label} must be a non-negative integer.`);
  return value;
}

function assertSafeReference(value, label) {
  const ref = requireString(value, label);
  if (ref.length > 256 || !/^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{0,255}$/.test(ref)) {
    fail(`${label} must be an opaque non-secret reference.`);
  }
  return ref;
}

function assertNoSensitiveMaterial(value, path = "root") {
  if (typeof value === "string") {
    if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(value)) fail(`${path} contains private-key material.`);
    if (/"private_key"\s*:/.test(value)) fail(`${path} contains service-account private-key material.`);
    if (/ya29\.[A-Za-z0-9._-]+/.test(value)) fail(`${path} contains an access token.`);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (/^(password|secret|token|accessToken|refreshToken|apiKey|privateKey|private_key|clientSecret)$/i.test(key)) {
      fail(`${path}.${key} is a forbidden credential property.`);
    }
    assertNoSensitiveMaterial(child, `${path}.${key}`);
  }
}

function validateBase(evidence) {
  const root = requireObject(evidence, "evidence");
  assertNoSensitiveMaterial(root);
  if (root.schema !== SCHEMA) fail(`schema must be '${SCHEMA}'.`);
  if (root.phase !== PHASE) fail(`phase must be '${PHASE}'.`);
  if (!SHA40.test(requireString(root.sourceSha, "sourceSha"))) fail("sourceSha must be an exact 40-character lowercase Git SHA.");
  if (!VERSION.test(requireString(root.releaseVersion, "releaseVersion"))) fail("releaseVersion has an invalid format.");
  assertSafeReference(root.g5BundleEvidenceRef, "g5BundleEvidenceRef");
  if (root.provider !== "gcp") fail("provider must be 'gcp'.");
  if (root.jurisdiction !== JURISDICTION) fail(`jurisdiction must be '${JURISDICTION}'.`);
  if (root.region !== REGION) fail(`region must be '${REGION}'.`);
  if (root.recoveryTarget !== "clinical-documents") fail("recoveryTarget must be 'clinical-documents'.");
  if (!SHA256.test(requireString(root.bucketEvidenceHash, "bucketEvidenceHash"))) fail("bucketEvidenceHash must be sha256:<64 hex>.");
  const softDelete = requireNonNegativeInteger(root.softDeleteRetentionSeconds, "softDeleteRetentionSeconds");
  if (softDelete < MIN_SOFT_DELETE_SECONDS || softDelete >= MAX_SOFT_DELETE_SECONDS) {
    fail(`softDeleteRetentionSeconds must be between ${MIN_SOFT_DELETE_SECONDS} and ${MAX_SOFT_DELETE_SECONDS - 1}.`);
  }
  if (root.regionalEndpoint !== REGIONAL_ENDPOINT) fail(`regionalEndpoint must be '${REGIONAL_ENDPOINT}'.`);

  const rehearsal = requireObject(root.rehearsal, "rehearsal");
  if (!SHA256.test(requireString(rehearsal.objectIdentityHash, "rehearsal.objectIdentityHash"))) fail("rehearsal.objectIdentityHash must be sha256:<64 hex>.");
  if (!SHA256.test(requireString(rehearsal.contentDigestBefore, "rehearsal.contentDigestBefore"))) fail("rehearsal.contentDigestBefore must be sha256:<64 hex>.");
  if (!SHA256.test(requireString(rehearsal.contentDigestAfter, "rehearsal.contentDigestAfter"))) fail("rehearsal.contentDigestAfter must be sha256:<64 hex>.");
  if (!RFC3339_UTC.test(requireString(rehearsal.recoveryStartedAtUtc, "rehearsal.recoveryStartedAtUtc"))) fail("rehearsal.recoveryStartedAtUtc must be RFC3339 UTC.");
  if (!RFC3339_UTC.test(requireString(rehearsal.recoveryCompletedAtUtc, "rehearsal.recoveryCompletedAtUtc"))) fail("rehearsal.recoveryCompletedAtUtc must be RFC3339 UTC.");
  requireNonNegativeInteger(rehearsal.measuredRpoSeconds, "rehearsal.measuredRpoSeconds");
  requireNonNegativeInteger(rehearsal.measuredRtoSeconds, "rehearsal.measuredRtoSeconds");
  assertSafeReference(rehearsal.evidenceRef, "rehearsal.evidenceRef");

  const controls = requireObject(root.controls, "controls");
  for (const name of [
    "keylessAuthentication",
    "exactFrozenRcBound",
    "g5BundleBound",
    "regionalEndpointUsed",
    "bucketRegionVerified",
    "publicAccessPreventionVerified",
    "uniformBucketLevelAccessVerified",
    "cmekVerified",
    "softDeletePolicyVerified",
    "objectCreated",
    "objectSoftDeleted",
    "objectRestored",
    "restoredContentIntegrityVerified",
    "syntheticLiveObjectRemoved",
    "geographicDrClaimed",
    "productionRecoveryEvidence",
    "productionAcceptance",
  ]) requireBoolean(controls[name], `controls.${name}`);

  if (controls.geographicDrClaimed !== false) fail("controls.geographicDrClaimed must remain false: single-region Cloud Storage recovery is not geographic DR.");
  if (controls.productionAcceptance !== false) fail("controls.productionAcceptance must remain false in G6c.");
  return root;
}

function validateTemplate(evidence) {
  const root = validateBase(evidence);
  if (root.controls.productionRecoveryEvidence !== false) fail("template productionRecoveryEvidence must be false.");
  for (const name of [
    "keylessAuthentication",
    "exactFrozenRcBound",
    "g5BundleBound",
    "regionalEndpointUsed",
    "bucketRegionVerified",
    "publicAccessPreventionVerified",
    "uniformBucketLevelAccessVerified",
    "cmekVerified",
    "softDeletePolicyVerified",
    "objectCreated",
    "objectSoftDeleted",
    "objectRestored",
    "restoredContentIntegrityVerified",
    "syntheticLiveObjectRemoved",
  ]) {
    if (root.controls[name] !== false) fail(`template controls.${name} must be false.`);
  }
  return root;
}

function validateFinal(evidence, expectedSourceSha) {
  const root = validateBase(evidence);
  if (expectedSourceSha && root.sourceSha !== expectedSourceSha) fail("sourceSha does not match the exact frozen RC checkout.");
  for (const name of [
    "keylessAuthentication",
    "exactFrozenRcBound",
    "g5BundleBound",
    "regionalEndpointUsed",
    "bucketRegionVerified",
    "publicAccessPreventionVerified",
    "uniformBucketLevelAccessVerified",
    "cmekVerified",
    "softDeletePolicyVerified",
    "objectCreated",
    "objectSoftDeleted",
    "objectRestored",
    "restoredContentIntegrityVerified",
    "syntheticLiveObjectRemoved",
    "productionRecoveryEvidence",
  ]) {
    if (root.controls[name] !== true) fail(`final controls.${name} must be true.`);
  }
  if (root.rehearsal.contentDigestBefore !== root.rehearsal.contentDigestAfter) fail("restored content digest must exactly match the pre-delete digest.");
  if (root.rehearsal.measuredRpoSeconds > MAX_RPO_SECONDS) fail(`measured RPO must be <= ${MAX_RPO_SECONDS} seconds.`);
  if (root.rehearsal.measuredRtoSeconds > MAX_RTO_SECONDS) fail(`measured RTO must be <= ${MAX_RTO_SECONDS} seconds.`);
  if (Date.parse(root.rehearsal.recoveryCompletedAtUtc) < Date.parse(root.rehearsal.recoveryStartedAtUtc)) fail("recovery timestamps are out of order.");
  return root;
}

function validateWorkflow(source) {
  const required = [
    "workflow_dispatch:",
    "environment: gcp-production-equivalent",
    "id-token: write",
    "google-github-actions/auth@7c6bc770dae815cd3e89ee6cdf493a5fab2cc093",
    "google-github-actions/setup-gcloud@aa5489c8933f4cc7a4f7d45035b3b1440c9c10db",
    "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
    "CLOUDSDK_API_ENDPOINT_OVERRIDES_STORAGE: https://storage.me-central2.rep.googleapis.com/",
    "CAREPOINT_DOCUMENT_BUCKET_REF",
    "CAREPOINT_DOCUMENT_STORAGE_KEY_REF",
    "gcloud storage buckets describe",
    "gcloud storage cp",
    "gcloud storage rm",
    "--soft-deleted",
    "gcloud storage restore",
    "productionRecoveryEvidence: true",
    "productionAcceptance: false",
    "geographicDrClaimed: false",
  ];
  for (const token of required) if (!source.includes(token)) fail(`live workflow is missing required token: ${token}`);
  for (const forbidden of [
    "credentials_json",
    "service_account_key",
    "GOOGLE_APPLICATION_CREDENTIALS:",
    "productionAcceptance: true",
    "geographicDrClaimed: true",
    "storage.googleapis.com/",
  ]) if (source.includes(forbidden)) fail(`live workflow contains forbidden token: ${forbidden}`);
  return true;
}

function validFixture() {
  return {
    schema: SCHEMA,
    phase: PHASE,
    sourceSha: "a".repeat(40),
    releaseVersion: "r1.0.0-rc.1",
    g5BundleEvidenceRef: "restricted://gcp/g5e/example",
    provider: "gcp",
    jurisdiction: JURISDICTION,
    region: REGION,
    recoveryTarget: "clinical-documents",
    bucketEvidenceHash: `sha256:${"b".repeat(64)}`,
    softDeleteRetentionSeconds: MIN_SOFT_DELETE_SECONDS,
    regionalEndpoint: REGIONAL_ENDPOINT,
    rehearsal: {
      objectIdentityHash: `sha256:${"c".repeat(64)}`,
      contentDigestBefore: `sha256:${"d".repeat(64)}`,
      contentDigestAfter: `sha256:${"d".repeat(64)}`,
      recoveryStartedAtUtc: "2026-09-17T18:00:00Z",
      recoveryCompletedAtUtc: "2026-09-17T18:01:00Z",
      measuredRpoSeconds: 0,
      measuredRtoSeconds: 60,
      evidenceRef: "github://actions/runs/1/attempts/1",
    },
    controls: {
      keylessAuthentication: true,
      exactFrozenRcBound: true,
      g5BundleBound: true,
      regionalEndpointUsed: true,
      bucketRegionVerified: true,
      publicAccessPreventionVerified: true,
      uniformBucketLevelAccessVerified: true,
      cmekVerified: true,
      softDeletePolicyVerified: true,
      objectCreated: true,
      objectSoftDeleted: true,
      objectRestored: true,
      restoredContentIntegrityVerified: true,
      syntheticLiveObjectRemoved: true,
      geographicDrClaimed: false,
      productionRecoveryEvidence: true,
      productionAcceptance: false,
    },
  };
}

function selfTest() {
  validateFinal(validFixture(), "a".repeat(40));
  const cases = [
    ["self approval", (x) => { x.controls.productionAcceptance = true; }],
    ["geographic DR", (x) => { x.controls.geographicDrClaimed = true; }],
    ["wrong region", (x) => { x.region = "me-central1"; }],
    ["weak soft delete", (x) => { x.softDeleteRetentionSeconds = 3600; }],
    ["digest mismatch", (x) => { x.rehearsal.contentDigestAfter = `sha256:${"e".repeat(64)}`; }],
    ["RPO exceeded", (x) => { x.rehearsal.measuredRpoSeconds = 901; }],
    ["RTO exceeded", (x) => { x.rehearsal.measuredRtoSeconds = 7201; }],
    ["static credential property", (x) => { x.token = "forbidden"; }],
  ];
  for (const [label, mutate] of cases) {
    const value = structuredClone(validFixture());
    mutate(value);
    let rejected = false;
    try { validateFinal(value, "a".repeat(40)); } catch { rejected = true; }
    if (!rejected) fail(`negative self-test did not reject: ${label}`);
  }
  process.stdout.write("G6c Cloud Storage recovery contract self-test passed\n");
}

const [command, ...args] = process.argv.slice(2);
if (command === "--self-test") selfTest();
else if (command === "--validate-template") {
  validateTemplate(JSON.parse(readFileSync(args[0], "utf8")));
  process.stdout.write("G6c template valid\n");
} else if (command === "--validate-final") {
  validateFinal(JSON.parse(readFileSync(args[0], "utf8")), args[1]);
  process.stdout.write("G6c final evidence valid\n");
} else if (command === "--validate-workflow") {
  validateWorkflow(readFileSync(args[0], "utf8"));
  process.stdout.write("G6c live workflow contract valid\n");
} else {
  fail("Usage: --self-test | --validate-template <json> | --validate-final <json> [sourceSha] | --validate-workflow <yml>");
}
