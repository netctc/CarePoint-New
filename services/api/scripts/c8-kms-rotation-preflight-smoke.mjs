import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  assertProductionKmsRotationReady,
} = require("../dist/infrastructure/security/production-kms-rotation-preflight.js");
const {
  PRODUCTION_KMS_REQUIREMENTS,
} = require("../dist/infrastructure/security/production-kms-preflight.js");

const TEST_REGION = "me-south-1";
const NOW = new Date("2026-09-09T00:00:00.000Z");
const ALIAS_PREFIX = "alias/carepoint/";

const aliases = new Map(PRODUCTION_KMS_REQUIREMENTS.map((requirement) => [
  requirement.keyEnv,
  `${ALIAS_PREFIX}${requirement.keyEnv.toLowerCase().replace(/_kms_key_id$/, "").replaceAll("_", "-")}`,
]));
const targetByAlias = new Map([...aliases.entries()].map(([keyEnv, aliasName]) => [aliasName, `target-${keyEnv.toLowerCase()}`]));
const requirementByTarget = new Map(PRODUCTION_KMS_REQUIREMENTS.map((requirement) => [
  `target-${requirement.keyEnv.toLowerCase()}`,
  requirement,
]));

function configureProduction() {
  process.env.NODE_ENV = "production";
  process.env.AWS_REGION = TEST_REGION;
  process.env.AWS_KMS_ALIAS_PREFIX = ALIAS_PREFIX;
  process.env.AWS_KMS_MAX_ROTATION_DAYS = "365";
  process.env.AWS_KMS_HMAC_MAX_KEY_AGE_DAYS = "365";
  delete process.env.AWS_ENDPOINT_URL_KMS;
  for (const [keyEnv, aliasName] of aliases) process.env[keyEnv] = aliasName;
}

function validOptions(overrides = {}) {
  return {
    now: NOW,
    resolveAlias: async (aliasName) => ({ targetKeyId: targetByAlias.get(aliasName) }),
    getRotationStatus: async () => ({ keyRotationEnabled: true, rotationPeriodInDays: 180 }),
    describeTargetKey: async () => ({ creationDate: new Date(NOW.getTime() - 90 * 86_400_000) }),
    ...overrides,
  };
}

async function expectReject(pattern, mutate, overrides = {}) {
  configureProduction();
  mutate();
  await assert.rejects(() => assertProductionKmsRotationReady(validOptions(overrides)), pattern);
}

process.env.NODE_ENV = "test";
delete process.env.AWS_REGION;
let nonProductionCalls = 0;
await assertProductionKmsRotationReady({
  resolveAlias: async () => { nonProductionCalls += 1; return undefined; },
  getRotationStatus: async () => { nonProductionCalls += 1; return undefined; },
  describeTargetKey: async () => { nonProductionCalls += 1; return undefined; },
});
assert.equal(nonProductionCalls, 0, "non-production C8 preflight must not call AWS KMS");

configureProduction();
const resolvedAliases = [];
const automaticRotationTargets = [];
const hmacTargets = [];
await assertProductionKmsRotationReady(validOptions({
  resolveAlias: async (aliasName) => {
    resolvedAliases.push(aliasName);
    return { targetKeyId: targetByAlias.get(aliasName), lastUpdatedDate: NOW };
  },
  getRotationStatus: async (targetKeyId) => {
    automaticRotationTargets.push(targetKeyId);
    return { keyRotationEnabled: true, rotationPeriodInDays: 180 };
  },
  describeTargetKey: async (targetKeyId) => {
    hmacTargets.push(targetKeyId);
    return { creationDate: new Date(NOW.getTime() - 90 * 86_400_000) };
  },
}));
assert.equal(resolvedAliases.length, 9, "all production KMS references must resolve through aliases");
assert.equal(automaticRotationTargets.length, 7, "all seven symmetric encryption keys must have automatic rotation checked");
assert.equal(hmacTargets.length, 2, "both HMAC signing keys must have manual rollover age checked");

await expectReject(/AWS_REGION is required/, () => { delete process.env.AWS_REGION; });
await expectReject(/AWS_ENDPOINT_URL_KMS is development\/test-only/, () => { process.env.AWS_ENDPOINT_URL_KMS = "http://localhost:4566"; });
await expectReject(/AWS_KMS_ALIAS_PREFIX must be a customer-managed/, () => { process.env.AWS_KMS_ALIAS_PREFIX = "alias/aws/"; });
await expectReject(/AWS_KMS_MAX_ROTATION_DAYS must be between 90 and 365/, () => { process.env.AWS_KMS_MAX_ROTATION_DAYS = "400"; });
await expectReject(/AWS_KMS_HMAC_MAX_KEY_AGE_DAYS must be between 1 and 365/, () => { process.env.AWS_KMS_HMAC_MAX_KEY_AGE_DAYS = "0"; });
await expectReject(/MFA_KMS_KEY_ID must use a KMS alias/, () => { process.env.MFA_KMS_KEY_ID = "1234abcd-raw-key-id"; });
await expectReject(/CLINICAL_KMS_KEY_ID must use the configured AWS_KMS_ALIAS_PREFIX/, () => { process.env.CLINICAL_KMS_KEY_ID = "alias/other/clinical"; });
await expectReject(
  /DOCUMENT_KMS_KEY_ID must resolve to an enabled customer-managed KMS key/,
  () => {},
  { resolveAlias: async (aliasName) => aliasName === aliases.get("DOCUMENT_KMS_KEY_ID") ? undefined : { targetKeyId: targetByAlias.get(aliasName) } },
);
await expectReject(
  /MESSAGING_KMS_KEY_ID must have automatic KMS key rotation enabled/,
  () => {},
  {
    getRotationStatus: async (targetKeyId) => targetKeyId === targetByAlias.get(aliases.get("MESSAGING_KMS_KEY_ID"))
      ? { keyRotationEnabled: false, rotationPeriodInDays: 180 }
      : { keyRotationEnabled: true, rotationPeriodInDays: 180 },
  },
);
await expectReject(
  /TELEHEALTH_KMS_KEY_ID rotation period exceeds AWS_KMS_MAX_ROTATION_DAYS \(365\)/,
  () => {},
  {
    getRotationStatus: async (targetKeyId) => targetKeyId === targetByAlias.get(aliases.get("TELEHEALTH_KMS_KEY_ID"))
      ? { keyRotationEnabled: true, rotationPeriodInDays: 400 }
      : { keyRotationEnabled: true, rotationPeriodInDays: 180 },
  },
);
await expectReject(
  /ORDER_SIGNING_KMS_KEY_ID HMAC rollover target exceeds AWS_KMS_HMAC_MAX_KEY_AGE_DAYS \(365\)/,
  () => {},
  {
    describeTargetKey: async (targetKeyId) => {
      const requirement = requirementByTarget.get(targetKeyId);
      const days = requirement?.keyEnv === "ORDER_SIGNING_KMS_KEY_ID" ? 366 : 90;
      return { creationDate: new Date(NOW.getTime() - days * 86_400_000) };
    },
  },
);
await expectReject(
  /DOCUMENT_SIGNING_KMS_KEY_ID HMAC rollover target must expose a valid KMS creation date/,
  () => {},
  {
    describeTargetKey: async (targetKeyId) => requirementByTarget.get(targetKeyId)?.keyEnv === "DOCUMENT_SIGNING_KMS_KEY_ID"
      ? {}
      : { creationDate: new Date(NOW.getTime() - 90 * 86_400_000) },
  },
);

configureProduction();
try {
  await assertProductionKmsRotationReady(validOptions({
    resolveAlias: async () => {
      const error = new Error("credential=should-never-leak");
      error.name = "AccessDeniedException";
      throw error;
    },
  }));
  assert.fail("expected sanitized alias-resolution failure");
} catch (error) {
  assert.match(String(error), /AccessDeniedException/);
  assert.doesNotMatch(String(error), /should-never-leak/);
}

const ordersAttestation = await readFile(new URL("../src/modules/orders/orders-attestation.service.ts", import.meta.url), "utf8");
const documentsAttestation = await readFile(new URL("../src/modules/documents/documents-attestation.service.ts", import.meta.url), "utf8");
for (const [name, source] of [["orders", ordersAttestation], ["documents", documentsAttestation]]) {
  assert.match(source, /keyId:\s*result\.KeyId\s*\?\?\s*keyId/, `${name} attestation must persist the concrete KMS KeyId returned after alias resolution`);
  assert.match(source, /KeyId:\s*effectiveKeyId/, `${name} attestation verification must use the stored concrete KMS KeyId`);
}

console.log("Phase C8 KMS rotation readiness acceptance passed");
