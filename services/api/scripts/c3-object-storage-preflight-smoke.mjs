import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { assertProductionObjectStorageReady } = require("../dist/infrastructure/security/production-object-storage-preflight.js");

const region = "me-south-1";
const accountId = "123456789012";
const bucket = "carepoint-private";
const keyId = "c3-storage-key";
const keyArn = `arn:aws:kms:${region}:${accountId}:key/${keyId}`;

function configureProduction() {
  process.env.NODE_ENV = "production";
  process.env.AWS_REGION = region;
  process.env.AWS_KMS_ACCOUNT_ID = accountId;
  delete process.env.AWS_ENDPOINT_URL_S3;
  process.env.DOCUMENT_STORAGE_PROVIDER = "s3";
  process.env.DOCUMENT_S3_BUCKET = bucket;
  process.env.DOCUMENT_S3_KMS_KEY_ID = keyId;
  process.env.DOCUMENT_S3_PREFIX = "carepoint/clinical";
  process.env.BULK_EXPORT_STORAGE_PROVIDER = "s3";
  process.env.BULK_EXPORT_S3_BUCKET = bucket;
  process.env.BULK_EXPORT_S3_KMS_KEY_ID = keyId;
  process.env.BULK_EXPORT_S3_PREFIX = "carepoint/bulk-export";
  process.env.BULK_EXPORT_RETENTION_SECONDS = "86400";
}

function validKms() {
  return {
    keyId,
    arn: keyArn,
    enabled: true,
    keyState: "Enabled",
    keyUsage: "ENCRYPT_DECRYPT",
    keySpec: "SYMMETRIC_DEFAULT",
    keyManager: "CUSTOMER",
  };
}

function validBucket() {
  return {
    region,
    publicAccessBlock: {
      blockPublicAcls: true,
      ignorePublicAcls: true,
      blockPublicPolicy: true,
      restrictPublicBuckets: true,
    },
    defaultEncryption: { algorithm: "aws:kms", kmsKeyId: keyArn },
    ownershipModes: ["BucketOwnerEnforced"],
    lifecycleRules: [
      { status: "Enabled", prefix: "carepoint/bulk-export", expirationDays: 1 },
    ],
  };
}

function inspectors({ bucketInspection = validBucket(), kmsInspection = validKms() } = {}) {
  return {
    inspectBucket: async () => structuredClone(bucketInspection),
    inspectKmsKey: async () => structuredClone(kmsInspection),
  };
}

async function expectReject(pattern, mutate, options = inspectors()) {
  configureProduction();
  mutate();
  await assert.rejects(() => assertProductionObjectStorageReady(options), pattern);
}

process.env.NODE_ENV = "test";
let nonProductionBucketCalls = 0;
let nonProductionKeyCalls = 0;
await assertProductionObjectStorageReady({
  inspectBucket: async () => { nonProductionBucketCalls += 1; return validBucket(); },
  inspectKmsKey: async () => { nonProductionKeyCalls += 1; return validKms(); },
});
assert.equal(nonProductionBucketCalls, 0, "non-production preflight must not inspect S3");
assert.equal(nonProductionKeyCalls, 0, "non-production preflight must not inspect storage KMS keys");

configureProduction();
let bucketCalls = 0;
let keyCalls = 0;
await assertProductionObjectStorageReady({
  inspectBucket: async (value) => {
    assert.equal(value, bucket);
    bucketCalls += 1;
    return validBucket();
  },
  inspectKmsKey: async (value) => {
    assert.equal(value, keyId);
    keyCalls += 1;
    return validKms();
  },
});
assert.equal(bucketCalls, 1, "shared document/bulk bucket must be inspected once");
assert.equal(keyCalls, 1, "shared document/bulk KMS key must be described once");

await expectReject(/AWS_REGION is required/, () => { delete process.env.AWS_REGION; });
await expectReject(/AWS_ENDPOINT_URL_S3 is development\/test-only/, () => { process.env.AWS_ENDPOINT_URL_S3 = "http://localhost:4566"; });
await expectReject(/DOCUMENT_STORAGE_PROVIDER must be 's3'/, () => { process.env.DOCUMENT_STORAGE_PROVIDER = "local"; });
await expectReject(/DOCUMENT_S3_BUCKET is required/, () => { delete process.env.DOCUMENT_S3_BUCKET; delete process.env.BULK_EXPORT_S3_BUCKET; });
await expectReject(/DOCUMENT_S3_KMS_KEY_ID is required/, () => { delete process.env.DOCUMENT_S3_KMS_KEY_ID; delete process.env.BULK_EXPORT_S3_KMS_KEY_ID; });
await expectReject(/BULK_EXPORT_STORAGE_PROVIDER must be 's3'/, () => { process.env.BULK_EXPORT_STORAGE_PROVIDER = "local"; });
await expectReject(/BULK_EXPORT_RETENTION_SECONDS must be a positive integer/, () => { process.env.BULK_EXPORT_RETENTION_SECONDS = "0"; });

await expectReject(
  /is in region 'eu-west-1', expected 'me-south-1'/,
  () => {},
  inspectors({ bucketInspection: { ...validBucket(), region: "eu-west-1" } }),
);
await expectReject(
  /must enable all four S3 Block Public Access controls/,
  () => {},
  inspectors({ bucketInspection: { ...validBucket(), publicAccessBlock: { ...validBucket().publicAccessBlock, restrictPublicBuckets: false } } }),
);
await expectReject(
  /must use BucketOwnerEnforced/,
  () => {},
  inspectors({ bucketInspection: { ...validBucket(), ownershipModes: ["BucketOwnerPreferred"] } }),
);
await expectReject(
  /must use KMS default encryption/,
  () => {},
  inspectors({ bucketInspection: { ...validBucket(), defaultEncryption: { algorithm: "AES256" } } }),
);
await expectReject(
  /default encryption key does not match/,
  () => {},
  inspectors({ bucketInspection: { ...validBucket(), defaultEncryption: { algorithm: "aws:kms", kmsKeyId: "other-key" } } }),
);

await expectReject(
  /must be Enabled/,
  () => {},
  inspectors({ kmsInspection: { ...validKms(), enabled: false, keyState: "Disabled" } }),
);
await expectReject(
  /must use SYMMETRIC_DEFAULT \/ ENCRYPT_DECRYPT/,
  () => {},
  inspectors({ kmsInspection: { ...validKms(), keyUsage: "SIGN_VERIFY" } }),
);
await expectReject(
  /must be customer-managed/,
  () => {},
  inspectors({ kmsInspection: { ...validKms(), keyManager: "AWS" } }),
);
await expectReject(
  /KMS key 'c3-storage-key' is in region 'eu-west-1'/,
  () => {},
  inspectors({ kmsInspection: { ...validKms(), arn: `arn:aws:kms:eu-west-1:${accountId}:key/${keyId}` } }),
);
await expectReject(
  /belongs to account '999999999999', expected '123456789012'/,
  () => {},
  inspectors({ kmsInspection: { ...validKms(), arn: `arn:aws:kms:${region}:999999999999:key/${keyId}` } }),
);

await expectReject(
  /needs an Enabled lifecycle expiration rule/,
  () => {},
  inspectors({ bucketInspection: { ...validBucket(), lifecycleRules: [] } }),
);
await expectReject(
  /needs an Enabled lifecycle expiration rule/,
  () => {},
  inspectors({ bucketInspection: { ...validBucket(), lifecycleRules: [{ status: "Disabled", prefix: "carepoint/bulk-export", expirationDays: 1 }] } }),
);
await expectReject(
  /needs an Enabled lifecycle expiration rule/,
  () => {},
  inspectors({ bucketInspection: { ...validBucket(), lifecycleRules: [{ status: "Enabled", prefix: "other/prefix", expirationDays: 1 }] } }),
);
await expectReject(
  /within 1 day\(s\)/,
  () => {},
  inspectors({ bucketInspection: { ...validBucket(), lifecycleRules: [{ status: "Enabled", prefix: "carepoint/bulk-export", expirationDays: 2 }] } }),
);

configureProduction();
process.env.BULK_EXPORT_RETENTION_SECONDS = "172800";
await assertProductionObjectStorageReady(inspectors({
  bucketInspection: { ...validBucket(), lifecycleRules: [{ status: "Enabled", prefix: "carepoint", expirationDays: 2 }] },
}));

await expectReject(
  /could not inspect bucket 'carepoint-private': AccessDenied/,
  () => {},
  { inspectBucket: async () => { throw new Error("AccessDenied"); }, inspectKmsKey: async () => validKms() },
);
await expectReject(
  /could not describe KMS key 'c3-storage-key': AccessDenied/,
  () => {},
  { inspectBucket: async () => validBucket(), inspectKmsKey: async () => { throw new Error("AccessDenied"); } },
);

console.log("Phase C3 private object-storage preflight acceptance passed");
