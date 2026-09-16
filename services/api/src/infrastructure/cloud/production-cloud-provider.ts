export type ProductionCloudProvider = "aws" | "oci";

export const OCI_KSA_PRIMARY_REGION = "me-riyadh-1" as const;
export const OCI_KSA_DR_REGION = "me-jeddah-1" as const;
export const OCI_KSA_REGIONS = [OCI_KSA_PRIMARY_REGION, OCI_KSA_DR_REGION] as const;

export type OciKsaRegion = (typeof OCI_KSA_REGIONS)[number];

export type ProductionCloudContract = {
  provider: ProductionCloudProvider;
  jurisdiction: "SA";
  approvedDataRegions: readonly string[];
  primaryRegion: string;
  drRegion: string;
};

export function productionCloudContract(
  env: NodeJS.ProcessEnv = process.env,
): ProductionCloudContract | null {
  if (env.NODE_ENV !== "production") return null;

  const provider = required(env, "CAREPOINT_CLOUD_PROVIDER");
  if (provider !== "aws" && provider !== "oci") {
    throw new Error("CAREPOINT_CLOUD_PROVIDER must be 'aws' or 'oci' in production.");
  }

  const jurisdiction = required(env, "CAREPOINT_RESIDENCY_JURISDICTION").toUpperCase();
  if (jurisdiction !== "SA") {
    throw new Error("Release 1 production residency jurisdiction must be 'SA'.");
  }

  const approvedDataRegions = parseRegionSet(required(env, "CAREPOINT_APPROVED_DATA_REGIONS"));
  const primaryRegion = required(env, "CAREPOINT_PRIMARY_REGION");
  const drRegion = required(env, "CAREPOINT_DR_REGION");

  if (primaryRegion === drRegion) {
    throw new Error("CAREPOINT_PRIMARY_REGION and CAREPOINT_DR_REGION must be different.");
  }
  if (!approvedDataRegions.includes(primaryRegion)) {
    throw new Error("CAREPOINT_PRIMARY_REGION must be included in CAREPOINT_APPROVED_DATA_REGIONS.");
  }
  if (!approvedDataRegions.includes(drRegion)) {
    throw new Error("CAREPOINT_DR_REGION must be included in CAREPOINT_APPROVED_DATA_REGIONS.");
  }

  if (provider === "oci") {
    assertOciKsaContract(env, approvedDataRegions, primaryRegion, drRegion);
  } else {
    throw new Error(
      "AWS is retained as a compatibility provider but is not an accepted KSA-resident Release 1 production target.",
    );
  }

  return {
    provider,
    jurisdiction: "SA",
    approvedDataRegions,
    primaryRegion,
    drRegion,
  };
}

export function assertProductionCloudProviderReady(
  env: NodeJS.ProcessEnv = process.env,
): void {
  void productionCloudContract(env);
}

function assertOciKsaContract(
  env: NodeJS.ProcessEnv,
  approvedDataRegions: readonly string[],
  primaryRegion: string,
  drRegion: string,
): void {
  const ociRegion = required(env, "OCI_REGION");

  if (primaryRegion !== OCI_KSA_PRIMARY_REGION) {
    throw new Error(`OCI Release 1 primary region must be '${OCI_KSA_PRIMARY_REGION}'.`);
  }
  if (drRegion !== OCI_KSA_DR_REGION) {
    throw new Error(`OCI Release 1 DR region must be '${OCI_KSA_DR_REGION}'.`);
  }
  if (ociRegion !== primaryRegion) {
    throw new Error("OCI_REGION must match CAREPOINT_PRIMARY_REGION for the active production runtime.");
  }

  const approved = new Set(approvedDataRegions);
  for (const region of approved) {
    if (!isOciKsaRegion(region)) {
      throw new Error(`OCI approved data region '${region}' is outside the accepted KSA region set.`);
    }
  }
  for (const requiredRegion of OCI_KSA_REGIONS) {
    if (!approved.has(requiredRegion)) {
      throw new Error(`CAREPOINT_APPROVED_DATA_REGIONS must include '${requiredRegion}'.`);
    }
  }

  const tenancyId = required(env, "OCI_TENANCY_OCID");
  const compartmentId = required(env, "OCI_COMPARTMENT_OCID");
  if (!isOcid(tenancyId, "tenancy")) {
    throw new Error("OCI_TENANCY_OCID must be a tenancy OCID.");
  }
  if (!isOcid(compartmentId, "compartment")) {
    throw new Error("OCI_COMPARTMENT_OCID must be a compartment OCID.");
  }
}

function parseRegionSet(value: string): string[] {
  const regions = value
    .split(",")
    .map((region) => region.trim())
    .filter(Boolean);

  if (regions.length < 2) {
    throw new Error("CAREPOINT_APPROVED_DATA_REGIONS must contain at least primary and DR regions.");
  }
  if (new Set(regions).size !== regions.length) {
    throw new Error("CAREPOINT_APPROVED_DATA_REGIONS must not contain duplicates.");
  }
  return regions;
}

function isOciKsaRegion(value: string): value is OciKsaRegion {
  return (OCI_KSA_REGIONS as readonly string[]).includes(value);
}

function isOcid(value: string, resourceType: string): boolean {
  const prefix = `ocid1.${resourceType}.`;
  return value.startsWith(prefix) && value.length > prefix.length + 8 && !/\s/.test(value);
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required in production.`);
  return value;
}
