import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  assertProductionCloudStartupReady,
} = require("../dist/infrastructure/cloud/production-cloud-startup.js");

function preservePolicy() {
  return JSON.stringify({
    version: "release1-startup-test-v1",
    rules: [
      "AUTH_EPHEMERAL",
      "IDENTITY_PROFILE",
      "CLINICAL_RECORD",
      "CLINICAL_DOCUMENT",
      "DIAGNOSTIC_REPORT",
      "CONSENT",
      "FINANCIAL",
      "COMMUNICATION",
      "AUDIT_SECURITY",
    ].map((dataClass) => ({ dataClass, action: "PRESERVE" })),
  });
}

function validOciProductionEnv() {
  return {
    NODE_ENV: "production",
    CAREPOINT_CLOUD_PROVIDER: "oci",
    CAREPOINT_RESIDENCY_JURISDICTION: "SA",
    CAREPOINT_APPROVED_DATA_REGIONS: "me-riyadh-1,me-jeddah-1",
    CAREPOINT_PRIMARY_REGION: "me-riyadh-1",
    CAREPOINT_DR_REGION: "me-jeddah-1",
    OCI_REGION: "me-riyadh-1",
    OCI_TENANCY_OCID: "ocid1.tenancy.oc1..carepointrelease1ksa0001",
    OCI_COMPARTMENT_OCID: "ocid1.compartment.oc1..carepointrelease1prod0001",
    DATA_RESIDENCY_JURISDICTION: "SA",
    DATA_RESIDENCY_REGION: "me-riyadh-1",
    DATA_RESIDENCY_POLICY_VERSION: "release1-ksa-v1",
    DATA_RESIDENCY_EVIDENCE_REFERENCE: "R3-OCI-STARTUP-TEST",
    DATABASE_DEPLOYMENT_REGION: "me-riyadh-1",
    REDIS_DEPLOYMENT_REGION: "me-riyadh-1",
    DATA_RETENTION_POLICY_JSON: preservePolicy(),
    DATA_RETENTION_BATCH_SIZE: "100",
  };
}

assert.equal(assertProductionCloudStartupReady({ NODE_ENV: "test" }), null);

const valid = validOciProductionEnv();
const contract = assertProductionCloudStartupReady(valid);
assert.equal(contract.provider, "oci");
assert.equal(contract.primaryRegion, "me-riyadh-1");
assert.equal(contract.drRegion, "me-jeddah-1");

assert.throws(
  () => assertProductionCloudStartupReady({ ...valid, CAREPOINT_CLOUD_PROVIDER: "" }),
  /CAREPOINT_CLOUD_PROVIDER is required in production/,
);
assert.throws(
  () => assertProductionCloudStartupReady({ ...valid, CAREPOINT_CLOUD_PROVIDER: "gcp" }),
  /must be 'aws' or 'oci'/,
);
assert.throws(
  () => assertProductionCloudStartupReady({ ...valid, CAREPOINT_CLOUD_PROVIDER: "aws" }),
  /AWS is retained as a compatibility provider but is not an accepted KSA-resident Release 1 production target/,
);
assert.throws(
  () => assertProductionCloudStartupReady({ ...valid, DATA_RESIDENCY_REGION: "me-jeddah-1" }),
  /OCI_REGION.*must match DATA_RESIDENCY_REGION/,
);
assert.throws(
  () => assertProductionCloudStartupReady({ ...valid, DATABASE_DEPLOYMENT_REGION: "me-jeddah-1" }),
  /DATABASE_DEPLOYMENT_REGION.*must match DATA_RESIDENCY_REGION/,
);
assert.throws(
  () => assertProductionCloudStartupReady({ ...valid, REDIS_DEPLOYMENT_REGION: "me-jeddah-1" }),
  /REDIS_DEPLOYMENT_REGION.*must match DATA_RESIDENCY_REGION/,
);

console.log("R3 production cloud startup binding smoke passed");
