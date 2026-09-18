import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  productionObjectStorageContract,
  validateProductionObjectStorageBucketInspection,
} = require("../dist/infrastructure/cloud/production-object-storage.js");

const primaryRegion = "me-riyadh-1";
const drRegion = "me-jeddah-1";
const documentBucket = "carepoint-r1-clinical";
const documentKey = "ocid1.key.oc1.me-riyadh-1.carepointrelease1documents0001";

function validEnv() {
  return {
    NODE_ENV: "production",
    CAREPOINT_CLOUD_PROVIDER: "oci",
    CAREPOINT_RESIDENCY_JURISDICTION: "SA",
    CAREPOINT_APPROVED_DATA_REGIONS: `${primaryRegion},${drRegion}`,
    CAREPOINT_PRIMARY_REGION: primaryRegion,
    CAREPOINT_DR_REGION: drRegion,
    OCI_REGION: primaryRegion,
    OCI_TENANCY_OCID: "ocid1.tenancy.oc1..carepointrelease1ksa0001",
    OCI_COMPARTMENT_OCID: "ocid1.compartment.oc1..carepointrelease1prod0001",
    CAREPOINT_OBJECT_STORAGE_PROVIDER: "oci-object-storage",
    CAREPOINT_OBJECT_STORAGE_REGION: primaryRegion,
    CAREPOINT_DOCUMENT_BUCKET_REF: documentBucket,
    CAREPOINT_DOCUMENT_STORAGE_KEY_REF: documentKey,
    CAREPOINT_DOCUMENT_STORAGE_PREFIX: "carepoint/clinical",
    CAREPOINT_BULK_EXPORT_BUCKET_REF: documentBucket,
    CAREPOINT_BULK_EXPORT_STORAGE_KEY_REF: documentKey,
    CAREPOINT_BULK_EXPORT_PREFIX: "carepoint/bulk-export",
    BULK_EXPORT_RETENTION_SECONDS: "86400",
  };
}

function validInspection(domain) {
  return {
    provider: domain.provider,
    region: domain.region,
    bucketRef: domain.bucketRef,
    publicAccessDisabled: true,
    customerManagedEncryption: true,
    kmsKeyRef: domain.kmsKeyRef,
  };
}

assert.equal(productionObjectStorageContract({ NODE_ENV: "test" }), null);

const valid = validEnv();
const contract = productionObjectStorageContract(valid);
assert.equal(contract.provider, "oci-object-storage");
assert.equal(contract.region, primaryRegion);
assert.equal(contract.domains.length, 2);
assert.equal(contract.domains[0].label, "clinical-documents");
assert.equal(contract.domains[0].bucketRef, documentBucket);
assert.equal(contract.domains[1].label, "fhir-bulk-export");
assert.equal(contract.domains[1].lifecycleRetentionDays, 1);
for (const domain of contract.domains) {
  assert.doesNotThrow(() => validateProductionObjectStorageBucketInspection(domain, validInspection(domain)));
}

assert.throws(
  () => productionObjectStorageContract({ ...valid, CAREPOINT_OBJECT_STORAGE_PROVIDER: "" }),
  /CAREPOINT_OBJECT_STORAGE_PROVIDER is required/,
);
assert.throws(
  () => productionObjectStorageContract({ ...valid, CAREPOINT_OBJECT_STORAGE_PROVIDER: "local" }),
  /must be 'aws-s3' or 'oci-object-storage'/,
);
assert.throws(
  () => productionObjectStorageContract({ ...valid, CAREPOINT_OBJECT_STORAGE_PROVIDER: "aws-s3" }),
  /OCI Release 1 production requires CAREPOINT_OBJECT_STORAGE_PROVIDER='oci-object-storage'/,
);
assert.throws(
  () => productionObjectStorageContract({ ...valid, CAREPOINT_OBJECT_STORAGE_REGION: drRegion }),
  /active object storage must be in primary region 'me-riyadh-1'/,
);
assert.throws(
  () => productionObjectStorageContract({
    ...valid,
    CAREPOINT_OBJECT_STORAGE_REGION: "me-dubai-1",
  }),
  /outside CAREPOINT_APPROVED_DATA_REGIONS/,
);
assert.throws(
  () => productionObjectStorageContract({ ...valid, CAREPOINT_DOCUMENT_BUCKET_REF: "bad bucket" }),
  /CAREPOINT_DOCUMENT_BUCKET_REF must be a non-secret bucket reference/,
);
assert.throws(
  () => productionObjectStorageContract({ ...valid, CAREPOINT_DOCUMENT_STORAGE_KEY_REF: "not-an-ocid" }),
  /must be an OCI Key Management key OCID/,
);
assert.throws(
  () => productionObjectStorageContract({ ...valid, BULK_EXPORT_RETENTION_SECONDS: "0" }),
  /must be a positive integer/,
);

const clinical = contract.domains[0];
assert.throws(
  () => validateProductionObjectStorageBucketInspection(clinical, {
    ...validInspection(clinical),
    provider: "aws-s3",
  }),
  /inspection provider 'aws-s3' does not match configured provider 'oci-object-storage'/,
);
assert.throws(
  () => validateProductionObjectStorageBucketInspection(clinical, {
    ...validInspection(clinical),
    bucketRef: "other-bucket",
  }),
  /does not match configured bucket/,
);
assert.throws(
  () => validateProductionObjectStorageBucketInspection(clinical, {
    ...validInspection(clinical),
    region: drRegion,
  }),
  /is in region 'me-jeddah-1', expected 'me-riyadh-1'/,
);
assert.throws(
  () => validateProductionObjectStorageBucketInspection(clinical, {
    ...validInspection(clinical),
    publicAccessDisabled: false,
  }),
  /must have public access disabled/,
);
assert.throws(
  () => validateProductionObjectStorageBucketInspection(clinical, {
    ...validInspection(clinical),
    customerManagedEncryption: false,
  }),
  /must use customer-managed encryption/,
);
assert.throws(
  () => validateProductionObjectStorageBucketInspection(clinical, {
    ...validInspection(clinical),
    kmsKeyRef: "ocid1.key.oc1.me-riyadh-1.otherkey0001",
  }),
  /encryption key does not match configured key reference/,
);

console.log("R3 OCI KSA object-storage contract smoke passed");
