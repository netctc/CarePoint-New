import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  OCI_KSA_PRIMARY_REGION,
  OCI_KSA_DR_REGION,
  GCP_KSA_PRIMARY_REGION,
  productionCloudContract,
  assertProductionCloudProviderReady,
  assertApprovedProductionDataDestinationRegion,
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

function validGcpProductionEnv() {
  return {
    NODE_ENV: "production",
    CAREPOINT_CLOUD_PROVIDER: "gcp",
    CAREPOINT_RESIDENCY_JURISDICTION: "SA",
    CAREPOINT_APPROVED_DATA_REGIONS: GCP_KSA_PRIMARY_REGION,
    CAREPOINT_PRIMARY_REGION: GCP_KSA_PRIMARY_REGION,
    GCP_REGION: GCP_KSA_PRIMARY_REGION,
  };
}

assert.equal(productionCloudContract({ NODE_ENV: "test" }), null);
assert.doesNotThrow(() => assertProductionCloudProviderReady({ NODE_ENV: "development" }));

const validOci = validOciProductionEnv();
const ociContract = productionCloudContract(validOci);
assert.equal(ociContract.provider, "oci");
assert.equal(ociContract.jurisdiction, "SA");
assert.equal(ociContract.primaryRegion, OCI_KSA_PRIMARY_REGION);
assert.equal(ociContract.drRegion, OCI_KSA_DR_REGION);
assert.deepEqual(ociContract.approvedDataRegions, [OCI_KSA_PRIMARY_REGION, OCI_KSA_DR_REGION]);

const validGcp = validGcpProductionEnv();
const gcpContract = productionCloudContract(validGcp);
assert.equal(gcpContract.provider, "gcp");
assert.equal(gcpContract.jurisdiction, "SA");
assert.equal(gcpContract.primaryRegion, GCP_KSA_PRIMARY_REGION);
assert.equal(gcpContract.drRegion, null);
assert.deepEqual(gcpContract.approvedDataRegions, [GCP_KSA_PRIMARY_REGION]);
assert.doesNotThrow(() => productionCloudContract({ ...validGcp, OCI_REGION: "not-used-by-gcp" }));
assert.equal(
  assertApprovedProductionDataDestinationRegion(
    { ...validGcp, CAREPOINT_OTEL_DESTINATION_REGION: GCP_KSA_PRIMARY_REGION },
    "CAREPOINT_OTEL_DESTINATION_REGION",
  ),
  GCP_KSA_PRIMARY_REGION,
);

assert.throws(
  () => productionCloudContract({ ...validOci, CAREPOINT_CLOUD_PROVIDER: "" }),
  /CAREPOINT_CLOUD_PROVIDER is required in production/,
);
assert.throws(
  () => productionCloudContract({ ...validOci, CAREPOINT_CLOUD_PROVIDER: "azure" }),
  /must be 'aws', 'oci', or 'gcp'/,
);
assert.throws(
  () => productionCloudContract({ ...validOci, CAREPOINT_RESIDENCY_JURISDICTION: "AE" }),
  /must be 'SA'/,
);
assert.throws(
  () => productionCloudContract({ ...validOci, CAREPOINT_APPROVED_DATA_REGIONS: OCI_KSA_PRIMARY_REGION }),
  /must contain at least primary and DR regions for OCI/,
);
assert.throws(
  () => productionCloudContract({
    ...validOci,
    CAREPOINT_APPROVED_DATA_REGIONS: `${OCI_KSA_PRIMARY_REGION},${OCI_KSA_PRIMARY_REGION}`,
  }),
  /must not contain duplicates/,
);
assert.throws(
  () => productionCloudContract({
    ...validOci,
    CAREPOINT_APPROVED_DATA_REGIONS: `me-dubai-1,${OCI_KSA_DR_REGION}`,
    CAREPOINT_PRIMARY_REGION: "me-dubai-1",
    OCI_REGION: "me-dubai-1",
  }),
  /primary region must be 'me-riyadh-1'/,
);
assert.throws(
  () => productionCloudContract({ ...validOci, CAREPOINT_DR_REGION: OCI_KSA_PRIMARY_REGION }),
  /PRIMARY_REGION and CAREPOINT_DR_REGION must be different|DR region must be 'me-jeddah-1'/,
);
assert.throws(
  () => productionCloudContract({ ...validOci, OCI_REGION: OCI_KSA_DR_REGION }),
  /OCI_REGION must match CAREPOINT_PRIMARY_REGION/,
);
assert.throws(
  () => productionCloudContract({
    ...validOci,
    CAREPOINT_APPROVED_DATA_REGIONS: `${OCI_KSA_PRIMARY_REGION},eu-frankfurt-1`,
    CAREPOINT_DR_REGION: "eu-frankfurt-1",
  }),
  /DR region must be 'me-jeddah-1'|outside the accepted KSA region set/,
);
assert.throws(
  () => productionCloudContract({ ...validOci, OCI_TENANCY_OCID: "not-an-ocid" }),
  /OCI_TENANCY_OCID must be a tenancy OCID/,
);
assert.throws(
  () => productionCloudContract({ ...validOci, OCI_COMPARTMENT_OCID: "not-an-ocid" }),
  /OCI_COMPARTMENT_OCID must be a compartment OCID/,
);
assert.throws(
  () => productionCloudContract({
    ...validOci,
    CAREPOINT_CLOUD_PROVIDER: "aws",
  }),
  /AWS is retained as a compatibility provider but is not an accepted KSA-resident Release 1 production target/,
);

assert.throws(
  () => productionCloudContract({ ...validGcp, GCP_REGION: "" }),
  /GCP_REGION is required in production/,
);
assert.throws(
  () => productionCloudContract({ ...validGcp, GCP_REGION: "me-central1" }),
  /GCP_REGION must match CAREPOINT_PRIMARY_REGION/,
);
assert.throws(
  () => productionCloudContract({ ...validGcp, CAREPOINT_PRIMARY_REGION: "me-central1", GCP_REGION: "me-central1" }),
  /CAREPOINT_PRIMARY_REGION must be included|GCP Release 1 primary region must be 'me-central2'/,
);
assert.throws(
  () => productionCloudContract({ ...validGcp, CAREPOINT_DR_REGION: "me-central2" }),
  /CAREPOINT_DR_REGION must be unset for the GCP KSA profile/,
);
assert.throws(
  () => productionCloudContract({
    ...validGcp,
    CAREPOINT_APPROVED_DATA_REGIONS: `${GCP_KSA_PRIMARY_REGION},me-riyadh-1`,
  }),
  /approved data regions must contain only 'me-central2'/,
);
assert.throws(
  () => assertApprovedProductionDataDestinationRegion(
    { ...validGcp, CAREPOINT_OTEL_DESTINATION_REGION: "me-central1" },
    "CAREPOINT_OTEL_DESTINATION_REGION",
  ),
  /outside CAREPOINT_APPROVED_DATA_REGIONS/,
);

console.log("R3 KSA production cloud provider contract smoke passed for OCI + GCP");
