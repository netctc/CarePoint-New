import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { assertProductionKmsReady } = require("../dist/infrastructure/security/production-kms-preflight.js");

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
  process.env.AWS_REGION = "me-south-1";
  Object.assign(process.env, providerEnv, keyEnv);
}

function validMetadata(keyId) {
  const signing = signingKeys.has(keyId);
  return {
    KeyId: keyId,
    Enabled: true,
    KeyState: "Enabled",
    KeyUsage: signing ? "GENERATE_VERIFY_MAC" : "ENCRYPT_DECRYPT",
    KeySpec: signing ? "HMAC_256" : "SYMMETRIC_DEFAULT",
  };
}

async function expectReject(pattern, mutate, describeKey = async (keyId) => validMetadata(keyId)) {
  configureProduction();
  mutate();
  await assert.rejects(() => assertProductionKmsReady({ describeKey }), pattern);
}

process.env.NODE_ENV = "test";
delete process.env.AWS_REGION;
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
await expectReject(/ORDER_KEY_PROVIDER must be 'aws-kms'/, () => { process.env.ORDER_KEY_PROVIDER = "local"; });
await expectReject(/TELEHEALTH_KMS_KEY_ID is required/, () => { delete process.env.TELEHEALTH_KMS_KEY_ID; });

await expectReject(
  /CLINICAL_KMS_KEY_ID is not enabled/,
  () => {},
  async (keyId) => keyId === keyEnv.CLINICAL_KMS_KEY_ID
    ? { ...validMetadata(keyId), Enabled: false, KeyState: "Disabled" }
    : validMetadata(keyId),
);

await expectReject(
  /ORDER_SIGNING_KMS_KEY_ID must use HMAC_256/,
  () => {},
  async (keyId) => keyId === keyEnv.ORDER_SIGNING_KMS_KEY_ID
    ? { ...validMetadata(keyId), KeySpec: "SYMMETRIC_DEFAULT" }
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
