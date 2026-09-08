import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { AwsKmsKeyProvider } = require("../dist/infrastructure/security/aws-kms-key-provider.js");
const { AwsKmsHmacProvider } = require("../dist/infrastructure/security/aws-kms-hmac-provider.js");
const { validateKmsKeyMetadata } = require("../dist/infrastructure/security/kms-key-validation.js");
const { productionKmsRequirements } = require("../dist/infrastructure/security/kms-readiness.module.js");

const region = "me-south-1";
const accountId = "123456789012";
const encryptionKeyId = "11111111-1111-4111-8111-111111111111";
const encryptionArn = `arn:aws:kms:${region}:${accountId}:key/${encryptionKeyId}`;
const hmacKeyId = "22222222-2222-4222-8222-222222222222";
const hmacArn = `arn:aws:kms:${region}:${accountId}:key/${hmacKeyId}`;

const encryptionMetadata = {
  KeyId: encryptionKeyId,
  Arn: encryptionArn,
  Enabled: true,
  KeyState: "Enabled",
  KeyManager: "CUSTOMER",
  KeyUsage: "ENCRYPT_DECRYPT",
  KeySpec: "SYMMETRIC_DEFAULT",
};
const hmacMetadata = {
  KeyId: hmacKeyId,
  Arn: hmacArn,
  Enabled: true,
  KeyState: "Enabled",
  KeyManager: "CUSTOMER",
  KeyUsage: "GENERATE_VERIFY_MAC",
  KeySpec: "HMAC_256",
  MacAlgorithms: ["HMAC_SHA_256"],
};

class FakeEncryptionKms {
  constructor({ metadata = encryptionMetadata, encryptKeyId = encryptionArn, decryptKeyId = encryptionArn } = {}) {
    this.metadata = metadata;
    this.encryptKeyId = encryptKeyId;
    this.decryptKeyId = decryptKeyId;
    this.describeCount = 0;
    this.lastEncryptInput = null;
    this.lastDecryptInput = null;
  }

  async send(command) {
    switch (command.constructor.name) {
      case "DescribeKeyCommand":
        this.describeCount += 1;
        return { KeyMetadata: this.metadata };
      case "EncryptCommand":
        this.lastEncryptInput = command.input;
        return { CiphertextBlob: Uint8Array.from([1, 2, 3, 4]), KeyId: this.encryptKeyId };
      case "DecryptCommand":
        this.lastDecryptInput = command.input;
        return { Plaintext: new Uint8Array(32).fill(7), KeyId: this.decryptKeyId };
      default:
        throw new Error(`Unexpected fake encryption command ${command.constructor.name}`);
    }
  }
}

class FakeHmacKms {
  constructor({ metadata = hmacMetadata } = {}) {
    this.metadata = metadata;
    this.describeCount = 0;
    this.lastGenerateInput = null;
    this.lastVerifyInput = null;
  }

  async send(command) {
    switch (command.constructor.name) {
      case "DescribeKeyCommand":
        this.describeCount += 1;
        return { KeyMetadata: this.metadata };
      case "GenerateMacCommand":
        this.lastGenerateInput = command.input;
        return { Mac: new Uint8Array(32).fill(9), KeyId: hmacArn, MacAlgorithm: "HMAC_SHA_256" };
      case "VerifyMacCommand":
        this.lastVerifyInput = command.input;
        return { KeyId: hmacArn, MacValid: true, MacAlgorithm: "HMAC_SHA_256" };
      default:
        throw new Error(`Unexpected fake HMAC command ${command.constructor.name}`);
    }
  }
}

const fakeEncryption = new FakeEncryptionKms();
const encryption = new AwsKmsKeyProvider(
  `alias/carepoint-phi-test`,
  "carepoint-c1-test-dek",
  region,
  undefined,
  { client: fakeEncryption, expectedAccountId: accountId, environment: "test" },
);
const validatedEncryption = await encryption.validateReady();
assert.equal(validatedEncryption.arn, encryptionArn);
assert.equal((await encryption.validateReady()).keyId, encryptionKeyId);
const wrapped = await encryption.wrapDataKey(new Uint8Array(32).fill(5));
assert.equal(wrapped.keyId, encryptionArn);
const unwrapped = await encryption.unwrapDataKey(wrapped);
assert.equal(unwrapped.byteLength, 32);
assert.equal(fakeEncryption.describeCount, 1, "KMS metadata validation must be memoized per provider instance.");
assert.equal(fakeEncryption.lastEncryptInput.KeyId, encryptionArn);
assert.equal(fakeEncryption.lastEncryptInput.EncryptionContext.purpose, "carepoint-c1-test-dek");
assert.equal(fakeEncryption.lastDecryptInput.KeyId, encryptionArn);
assert.equal(fakeEncryption.lastDecryptInput.EncryptionContext.purpose, "carepoint-c1-test-dek");
await assert.rejects(
  () => encryption.unwrapDataKey({ keyId: "arn:aws:kms:me-south-1:123456789012:key/rogue", wrappedKey: wrapped.wrappedKey }),
  /different AWS KMS key/i,
);

const mismatchedEncrypt = new AwsKmsKeyProvider(
  encryptionKeyId,
  "carepoint-c1-test-dek",
  region,
  undefined,
  { client: new FakeEncryptionKms({ encryptKeyId: "arn:aws:kms:me-south-1:123456789012:key/rogue" }), environment: "test" },
);
await assert.rejects(() => mismatchedEncrypt.wrapDataKey(new Uint8Array(32)), /different key/i);

for (const [name, metadata, pattern] of [
  ["disabled", { ...encryptionMetadata, Enabled: false, KeyState: "Disabled" }, /Enabled/i],
  ["AWS-managed", { ...encryptionMetadata, KeyManager: "AWS" }, /customer-managed/i],
  ["wrong usage", { ...encryptionMetadata, KeyUsage: "SIGN_VERIFY" }, /ENCRYPT_DECRYPT/i],
  ["wrong spec", { ...encryptionMetadata, KeySpec: "RSA_2048" }, /SYMMETRIC_DEFAULT/i],
]) {
  assert.throws(() => validateKmsKeyMetadata(metadata, { kind: "encryption", region }), pattern, name);
}
assert.throws(
  () => validateKmsKeyMetadata(encryptionMetadata, { kind: "encryption", region: "eu-west-1" }),
  /does not match configured AWS_REGION/i,
);
assert.throws(
  () => validateKmsKeyMetadata(encryptionMetadata, { kind: "encryption", region, accountId: "999999999999" }),
  /does not match configured AWS_KMS_ACCOUNT_ID/i,
);
assert.throws(
  () => new AwsKmsKeyProvider(encryptionKeyId, "purpose", region, "http://localstack:4566", { environment: "production" }),
  /forbidden in production/i,
);

const fakeHmac = new FakeHmacKms();
const hmac = new AwsKmsHmacProvider(
  hmacKeyId,
  region,
  undefined,
  { client: fakeHmac, expectedAccountId: accountId, environment: "test" },
);
const mac = await hmac.generate(Buffer.from("carepoint-c1"));
assert.equal(mac.keyId, hmacArn);
assert.equal(await hmac.verify(Buffer.from("carepoint-c1"), mac.mac, hmacArn), true);
assert.equal(await hmac.verify(Buffer.from("carepoint-c1"), mac.mac, encryptionArn), false);
assert.equal(fakeHmac.describeCount, 1);
assert.equal(fakeHmac.lastGenerateInput.MacAlgorithm, "HMAC_SHA_256");
assert.equal(fakeHmac.lastVerifyInput.KeyId, hmacArn);
assert.throws(
  () => validateKmsKeyMetadata({ ...hmacMetadata, KeyUsage: "ENCRYPT_DECRYPT" }, { kind: "hmac-sha256", region }),
  /GENERATE_VERIFY_MAC/i,
);
assert.throws(
  () => validateKmsKeyMetadata({ ...hmacMetadata, KeySpec: "HMAC_512" }, { kind: "hmac-sha256", region }),
  /HMAC_256/i,
);

const productionEnv = {
  NODE_ENV: "production",
  AWS_REGION: region,
  AWS_KMS_ACCOUNT_ID: accountId,
  MFA_KMS_KEY_ID: encryptionKeyId,
  CLINICAL_KMS_KEY_ID: encryptionKeyId,
  ORDER_KMS_KEY_ID: encryptionKeyId,
  DOCUMENT_KMS_KEY_ID: encryptionKeyId,
  MESSAGING_KMS_KEY_ID: encryptionKeyId,
  TELEHEALTH_KMS_KEY_ID: encryptionKeyId,
  DOCUMENT_SIGNING_KMS_KEY_ID: hmacKeyId,
};
const requirements = productionKmsRequirements(productionEnv);
assert.equal(requirements.length, 7);
assert.equal(requirements.filter((item) => item.kind === "encryption").length, 6);
assert.equal(requirements.filter((item) => item.kind === "hmac-sha256").length, 1);
assert.throws(
  () => productionKmsRequirements({ ...productionEnv, AWS_ENDPOINT_URL_KMS: "http://localstack:4566" }),
  /forbidden in production/i,
);
assert.throws(
  () => productionKmsRequirements({ ...productionEnv, CLINICAL_KMS_KEY_ID: "" }),
  /CLINICAL_KMS_KEY_ID is required/i,
);
assert.throws(
  () => productionKmsRequirements({ ...productionEnv, DOCUMENT_SIGNING_PROVIDER: "local" }),
  /DOCUMENT_SIGNING_PROVIDER must be 'aws-kms-hmac'/i,
);
assert.deepEqual(productionKmsRequirements({ NODE_ENV: "test" }), []);

console.log(JSON.stringify({
  status: "passed",
  phase: "C1-KMS-Readiness",
  encryptionKeyMetadataValidated: true,
  hmacKeyMetadataValidated: true,
  regionAndAccountPinned: true,
  productionCustomEndpointRejected: true,
  returnedKeyIdPinned: true,
  encryptionContextPreserved: true,
  readinessValidationMemoized: true,
  productionConfigurationInventoryValidated: true,
  externalAwsCallsRequired: false,
}));
