import {
  GCP_KSA_PRIMARY_REGION,
  assertApprovedProductionDataDestinationRegion,
  productionCloudContract,
} from "./production-cloud-provider";

export function assertProductionTelemetryDestinationRegion(
  env: NodeJS.ProcessEnv = process.env,
  variableName = "CAREPOINT_DATA_DESTINATION_REGION",
): string | null {
  const region = assertApprovedProductionDataDestinationRegion(env, variableName);
  if (env.NODE_ENV !== "production") return region;

  const provider = env.CAREPOINT_CLOUD_PROVIDER?.trim().toLowerCase();
  if (provider !== "gcp") return region;

  const contract = productionCloudContract(env);
  if (!contract || contract.provider !== "gcp") {
    throw new Error("GCP telemetry destination validation requires the approved GCP KSA production cloud contract.");
  }
  if (region !== GCP_KSA_PRIMARY_REGION || region !== contract.primaryRegion) {
    throw new Error(
      `${variableName} must remain in GCP Release 1 primary region '${GCP_KSA_PRIMARY_REGION}'.`,
    );
  }
  return region;
}
