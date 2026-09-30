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

function validGcpProductionEnv() {
  return {
    NODE_ENV: "production",
    CAREPOINT_CLOUD_PROVIDER: "gcp",
    CAREPOINT_RESIDENCY_JURISDICTION: "SA",
    CAREPOINT_APPROVED_DATA_REGIONS: "me-central2",
    CAREPOINT_PRIMARY_REGION: "me-central2",
    GCP_REGION: "me-central2",
    DATA_RESIDENCY_JURISDICTION: "SA",
    DATA_RESIDENCY_REGION: "me-central2",
    DATA_RESIDENCY_POLICY_VERSION: "release1-ksa-gcp-v1",
    DATA_RESIDENCY_EVIDENCE_REFERENCE: "R3-GCP-G2-STARTUP-TEST",
    DATABASE_DEPLOYMENT_REGION: "me-central2",
    REDIS_DEPLOYMENT_REGION: "me-central2",
    DATA_RETENTION_POLICY_JSON: preservePolicy(),
    DATA_RETENTION_BATCH_SIZE: "100",
  };
}

assert.equal(assertProductionCloudStartupReady({ NODE_ENV: "test" }), null);

const validOci = validOciProductionEnv();
const ociContract = assertProductionCloudStartupReady(validOci);
assert.equal(ociContract.provider, "oci");
assert.equal(ociContract.primaryRegion, "me-riyadh-1");
assert.equal(ociContract.drRegion, "me-jeddah-1");

assert.throws(
  () => assertProductionCloudStartupReady({ ...validOci, CAREPOINT_CLOUD_PROVIDER: "" }),
  /CAREPOINT_CLOUD_PROVIDER is required in production/,
);
assert.throws(
  () => assertProductionCloudStartupReady({ ...validOci, CAREPOINT_CLOUD_PROVIDER: "azure" }),
  /must be 'aws', 'oci', or 'gcp'/,
);
assert.throws(
  () => assertProductionCloudStartupReady({ ...validOci, CAREPOINT_CLOUD_PROVIDER: "aws" }),
  /AWS is retained as a compatibility provider but is not an accepted KSA-resident Release 1 production target/,
);
assert.throws(
  () => assertProductionCloudStartupReady({ ...validOci, DATA_RESIDENCY_REGION: "me-jeddah-1" }),
  /OCI_REGION.*must match DATA_RESIDENCY_REGION/,
);
assert.throws(
  () => assertProductionCloudStartupReady({ ...validOci, DATABASE_DEPLOYMENT_REGION: "me-jeddah-1" }),
  /DATABASE_DEPLOYMENT_REGION.*must match DATA_RESIDENCY_REGION/,
);
assert.throws(
  () => assertProductionCloudStartupReady({ ...validOci, REDIS_DEPLOYMENT_REGION: "me-jeddah-1" }),
  /REDIS_DEPLOYMENT_REGION.*must match DATA_RESIDENCY_REGION/,
);

const validGcp = validGcpProductionEnv();
const gcpContract = assertProductionCloudStartupReady(validGcp);
assert.equal(gcpContract.provider, "gcp");
assert.equal(gcpContract.primaryRegion, "me-central2");
assert.equal(gcpContract.drRegion, null);
assert.deepEqual(gcpContract.approvedDataRegions, ["me-central2"]);
assert.throws(
  () => assertProductionCloudStartupReady({ ...validGcp, DATA_RESIDENCY_REGION: "me-central1" }),
  /GCP_REGION.*must match DATA_RESIDENCY_REGION/,
);
assert.throws(
  () => assertProductionCloudStartupReady({ ...validGcp, DATABASE_DEPLOYMENT_REGION: "me-central1" }),
  /DATABASE_DEPLOYMENT_REGION.*must match DATA_RESIDENCY_REGION/,
);
assert.throws(
  () => assertProductionCloudStartupReady({ ...validGcp, REDIS_DEPLOYMENT_REGION: "me-central1" }),
  /REDIS_DEPLOYMENT_REGION.*must match DATA_RESIDENCY_REGION/,
);
assert.throws(
  () => assertProductionCloudStartupReady({ ...validGcp, GCP_REGION: "" }),
  /GCP_REGION is required in production/,
);
assert.throws(
  () => assertProductionCloudStartupReady({ ...validGcp, CAREPOINT_DR_REGION: "me-central2" }),
  /CAREPOINT_DR_REGION must be unset for the GCP KSA profile/,
);

console.log("R3 production cloud startup binding smoke passed for OCI and GCP KSA profiles");
