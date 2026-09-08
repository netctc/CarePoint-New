import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { assertProductionKmsReady } = require("../dist/infrastructure/security/production-kms-preflight.js");

const TEST_REGION = "me-south-1";
const TEST_ACCOUNT = "123456789012";

const providerEnv = {
  MFA_KEY_PROVIDER: "aws-kms",
  CLINICAL_KEY_PROVIDER: "aws-kms",
  ORDER_KEY_PROVIDER: "aws-kms",
  ORDER_SIGNING_PROVIDER: "aws-kms-hmac",
  DOCUMENT_KEY_PROVIDER: "aws-kms",
  DOCUMENT_SIGNING_PROVIDER: "aws-kms-hmac",
  MESSAGING_KEY_PROVIDER: "aws-kms",
  TELEHEALTH_KEY_PROVIDER: "aws-kms",
};

const keyEnv = {
  MFA_KMS_KEY_ID: "c1-mfa",
  CLINICAL_KMS_KEY_ID: "c1-clinical",
  ORDER_KMS_KEY_ID: "c1-orders",
  ORDER_SIGNING_KMS_KEY_ID: "c1-orders-signing",
  DOCUMENT_KMS_KEY_ID: "c1-documents",
  DOCUMENT_SIGNING_KMS_KEY_ID: "c1-documents-signing",
  MESSAGING_KMS_KEY_ID: "c1-messaging",
  TELEHEALTH_KMS_KEY_ID: "c1-telehealth",
};

const signingKeys = new Set([keyEnv.ORDER_SIGNING_KMS_KEY_ID, keyEnv.DOCUMENT_SIGNING_KMS_KEY_ID]);

function configureProduction() {
  process.env.NODE_ENV = "production";
  process.env.AWS_REGION = TEST_REGION;
  delete process.env.AWS_ENDPOINT_URL_KMS;
  delete process.env.AWS_KMS_ACCOUNT_ID;
  Object.assign(process.env, providerEnv, keyEnv);
}

function validMetadata(keyId, overrides = {}) {
  const signing = signingKeys.has(keyId);
  return {
    KeyId: keyId,
    Arn: `arn:aws:kms:${TEST_REGION}:${TEST_ACCOUNT}:key/${keyId}`,
    Enabled: true,
    KeyState: "Enabled",
    KeyManager: "CUSTOMER",
    KeyUsage: signing ? "GENERATE_VERIFY_MAC" : "ENCRYPT_DECRYPT",
    KeySpec: signing ? "HMAC_256" : "SYMMETRIC_DEFAULT",
    ...(signing ? { MacAlgorithms: ["HMAC_SHA_256"] } : {}),
    ...overrides,
  };
}

async function expectReject(pattern, mutate, describeKey = async (keyId) => validMetadata(keyId)) {
  configureProduction();
  mutate();
  await assert.rejects(() => assertProductionKmsReady({ describeKey }), pattern);
}

process.env.NODE_ENV = "test";
delete process.env.AWS_REGION;
process.env.AWS_ENDPOINT_URL_KMS = "http://localhost:4566";
let nonProductionCalls = 0;
await assertProductionKmsReady({ describeKey: async () => { nonProductionCalls += 1; return undefined; } });
assert.equal(nonProductionCalls, 0, "non-production preflight must not call KMS");

configureProduction();
const described = [];
await assertProductionKmsReady({
  describeKey: async (keyId) => {
    described.push(keyId);
    return validMetadata(keyId);
  },
});
assert.equal(described.length, 8, "all C1 production KMS keys must be described");
assert.equal(new Set(described).size, 8, "C1 production KMS keys must be checked individually");

await expectReject(/AWS_REGION is required/, () => { delete process.env.AWS_REGION; });
await expectReject(/AWS_ENDPOINT_URL_KMS is development\/test-only/, () => { process.env.AWS_ENDPOINT_URL_KMS = "http://localhost:4566"; });
await expectReject(/AWS_KMS_ACCOUNT_ID must contain exactly 12 digits/, () => { process.env.AWS_KMS_ACCOUNT_ID = "123"; });
await expectReject(/ORDER_KEY_PROVIDER must be 'aws-kms'/, () => { process.env.ORDER_KEY_PROVIDER = "local"; });
await expectReject(/TELEHEALTH_KMS_KEY_ID is required/, () => { delete process.env.TELEHEALTH_KMS_KEY_ID; });

await expectReject(
  /CLINICAL_KMS_KEY_ID is not enabled/,
  () => {},
  async (keyId) => keyId === keyEnv.CLINICAL_KMS_KEY_ID
    ? validMetadata(keyId, { Enabled: false, KeyState: "Disabled" })
    : validMetadata(keyId),
);

await expectReject(
  /MFA_KMS_KEY_ID must be a customer-managed KMS key/,
  () => {},
  async (keyId) => keyId === keyEnv.MFA_KMS_KEY_ID
    ? validMetadata(keyId, { KeyManager: "AWS" })
    : validMetadata(keyId),
);

await expectReject(
  /ORDER_SIGNING_KMS_KEY_ID must use HMAC_256/,
  () => {},
  async (keyId) => keyId === keyEnv.ORDER_SIGNING_KMS_KEY_ID
    ? validMetadata(keyId, { KeySpec: "SYMMETRIC_DEFAULT" })
    : validMetadata(keyId),
);

await expectReject(
  /DOCUMENT_SIGNING_KMS_KEY_ID must support HMAC_SHA_256/,
  () => {},
  async (keyId) => keyId === keyEnv.DOCUMENT_SIGNING_KMS_KEY_ID
    ? validMetadata(keyId, { MacAlgorithms: ["HMAC_SHA_384"] })
    : validMetadata(keyId),
);

await expectReject(
  /MESSAGING_KMS_KEY_ID region 'eu-west-1' does not match AWS_REGION/,
  () => {},
  async (keyId) => keyId === keyEnv.MESSAGING_KMS_KEY_ID
    ? validMetadata(keyId, { Arn: `arn:aws:kms:eu-west-1:${TEST_ACCOUNT}:key/${keyId}` })
    : validMetadata(keyId),
);

await expectReject(
  /CLINICAL_KMS_KEY_ID account '123456789012' does not match AWS_KMS_ACCOUNT_ID '210987654321'/,
  () => { process.env.AWS_KMS_ACCOUNT_ID = "210987654321"; },
);

await expectReject(
  /ORDER_KMS_KEY_ID returned an invalid KMS key ARN/,
  () => {},
  async (keyId) => keyId === keyEnv.ORDER_KMS_KEY_ID
    ? validMetadata(keyId, { Arn: "not-a-kms-arn" })
    : validMetadata(keyId),
);

await expectReject(
  /could not describe MESSAGING_KMS_KEY_ID/,
  () => {},
  async (keyId) => {
    if (keyId === keyEnv.MESSAGING_KMS_KEY_ID) throw new Error("AccessDeniedException");
    return validMetadata(keyId);
  },
);

console.log("Phase C1 production KMS preflight acceptance passed");
