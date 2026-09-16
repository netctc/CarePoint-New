import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  OCI_KSA_PRIMARY_REGION,
  OCI_KSA_DR_REGION,
  productionCloudContract,
  assertProductionCloudProviderReady,
} = require("../dist/infrastructure/cloud/production-cloud-provider.js");

function validOciProductionEnv() {
  return {
    NODE_ENV: "production",
    CAREPOINT_CLOUD_PROVIDER: "oci",
    CAREPOINT_RESIDENCY_JURISDICTION: "SA",
    CAREPOINT_APPROVED_DATA_REGIONS: `${OCI_KSA_PRIMARY_REGION},${OCI_KSA_DR_REGION}`,
    CAREPOINT_PRIMARY_REGION: OCI_KSA_PRIMARY_REGION,
    CAREPOINT_DR_REGION: OCI_KSA_DR_REGION,
    OCI_REGION: OCI_KSA_PRIMARY_REGION,
    OCI_TENANCY_OCID: "ocid1.tenancy.oc1..carepointrelease1ksa0001",
    OCI_COMPARTMENT_OCID: "ocid1.compartment.oc1..carepointrelease1prod0001",
  };
}

assert.equal(productionCloudContract({ NODE_ENV: "test" }), null);
assert.doesNotThrow(() => assertProductionCloudProviderReady({ NODE_ENV: "development" }));

const valid = validOciProductionEnv();
const contract = productionCloudContract(valid);
assert.equal(contract.provider, "oci");
assert.equal(contract.jurisdiction, "SA");
assert.equal(contract.primaryRegion, OCI_KSA_PRIMARY_REGION);
assert.equal(contract.drRegion, OCI_KSA_DR_REGION);
assert.deepEqual(contract.approvedDataRegions, [OCI_KSA_PRIMARY_REGION, OCI_KSA_DR_REGION]);

assert.throws(
  () => productionCloudContract({ ...valid, CAREPOINT_CLOUD_PROVIDER: "" }),
  /CAREPOINT_CLOUD_PROVIDER is required in production/,
);
assert.throws(
  () => productionCloudContract({ ...valid, CAREPOINT_CLOUD_PROVIDER: "gcp" }),
  /must be 'aws' or 'oci'/,
);
assert.throws(
  () => productionCloudContract({ ...valid, CAREPOINT_RESIDENCY_JURISDICTION: "AE" }),
  /must be 'SA'/,
);
assert.throws(
  () => productionCloudContract({ ...valid, CAREPOINT_APPROVED_DATA_REGIONS: OCI_KSA_PRIMARY_REGION }),
  /must contain at least primary and DR regions/,
);
assert.throws(
  () => productionCloudContract({
    ...valid,
    CAREPOINT_APPROVED_DATA_REGIONS: `${OCI_KSA_PRIMARY_REGION},${OCI_KSA_PRIMARY_REGION}`,
  }),
  /must not contain duplicates/,
);
assert.throws(
  () => productionCloudContract({
    ...valid,
    CAREPOINT_APPROVED_DATA_REGIONS: `me-dubai-1,${OCI_KSA_DR_REGION}`,
    CAREPOINT_PRIMARY_REGION: "me-dubai-1",
    OCI_REGION: "me-dubai-1",
  }),
  /primary region must be 'me-riyadh-1'/,
);
assert.throws(
  () => productionCloudContract({ ...valid, CAREPOINT_DR_REGION: OCI_KSA_PRIMARY_REGION }),
  /PRIMARY_REGION and CAREPOINT_DR_REGION must be different|DR region must be 'me-jeddah-1'/,
);
assert.throws(
  () => productionCloudContract({ ...valid, OCI_REGION: OCI_KSA_DR_REGION }),
  /OCI_REGION must match CAREPOINT_PRIMARY_REGION/,
);
assert.throws(
  () => productionCloudContract({
    ...valid,
    CAREPOINT_APPROVED_DATA_REGIONS: `${OCI_KSA_PRIMARY_REGION},eu-frankfurt-1`,
    CAREPOINT_DR_REGION: "eu-frankfurt-1",
  }),
  /DR region must be 'me-jeddah-1'|outside the accepted KSA region set/,
);
assert.throws(
  () => productionCloudContract({ ...valid, OCI_TENANCY_OCID: "not-an-ocid" }),
  /OCI_TENANCY_OCID must be a tenancy OCID/,
);
assert.throws(
  () => productionCloudContract({ ...valid, OCI_COMPARTMENT_OCID: "not-an-ocid" }),
  /OCI_COMPARTMENT_OCID must be a compartment OCID/,
);
assert.throws(
  () => productionCloudContract({
    ...valid,
    CAREPOINT_CLOUD_PROVIDER: "aws",
  }),
  /AWS is retained as a compatibility provider but is not an accepted KSA-resident Release 1 production target/,
);

console.log("R3 KSA production cloud provider contract smoke passed");
