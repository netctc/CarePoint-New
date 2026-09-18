import { EXTERNAL_SECRET_NAMES, ExternalSecretResolverService } from "./external-secret-resolver.service";
import type { CarePointRuntimeFeatures } from "../release/private-pilot-policy";
import {
  productionExternalSecretStoreContract,
  validateProductionExternalSecretInspection,
  type InspectProductionExternalSecret,
} from "../cloud/production-secret-store";

export interface ProductionExternalSecretsPreflightOptions {
  inspectExternalCredential?: InspectProductionExternalSecret;
}

export async function assertProductionExternalSecretsReady(
  env: NodeJS.ProcessEnv = process.env,
  features?: CarePointRuntimeFeatures,
  options: ProductionExternalSecretsPreflightOptions = {},
): Promise<void> {
  if (env.NODE_ENV !== "production") return;

  const requiredNames = externalCredentialNames(features);
  const cloudProvider = configuredCloudProvider(env);
  if (cloudProvider === "oci" || cloudProvider === "gcp") {
    const inspect = options.inspectExternalCredential;
    if (!inspect) {
      if (cloudProvider === "oci") {
        throw new Error("OCI production external credential preflight requires a live OCI Vault inspector.");
      }
      throw new Error("GCP production external credential preflight requires a live GCP Secret Manager inspector.");
    }

    const contract = productionExternalSecretStoreContract(env);
    if (!contract) return;
    for (const name of requiredNames) {
      const domain = contract.secrets.find((candidate) => candidate.name === name);
      if (!domain) throw new Error(`Production external credential contract is missing '${name}'.`);
      try {
        const inspection = await inspect(domain);
        validateProductionExternalSecretInspection(domain, inspection);
      } catch (error) {
        throw new Error(`External credential preflight failed for '${name}' (${errorName(error)}).`);
      }
    }
    return;
  }

  if (env !== process.env) {
    throw new Error("Production external secret preflight must run against process.env.");
  }

  const resolver = new ExternalSecretResolverService();
  for (const name of requiredNames) {
    try {
      await resolver.resolve(name);
    } catch (error) {
      const code = error instanceof Error ? error.name : "UnknownError";
      throw new Error(`External secret preflight failed for '${name}' (${code}).`);
    }
  }
}

function externalCredentialNames(
  features?: CarePointRuntimeFeatures,
): readonly (typeof EXTERNAL_SECRET_NAMES)[number][] {
  if (!features?.privatePilot) return EXTERNAL_SECRET_NAMES;
  return EXTERNAL_SECRET_NAMES.filter((name) => {
    if (name.startsWith("payment-") || name.startsWith("insurance-") || name.startsWith("claims-")) return features.payments;
    if (name.startsWith("notification-")) return features.externalNotifications;
    if (name.startsWith("livekit-")) return features.telehealth;
    return true;
  });
}

function configuredCloudProvider(env: NodeJS.ProcessEnv): "aws" | "oci" | "gcp" {
  const value = env.CAREPOINT_CLOUD_PROVIDER?.trim();
  if (!value || value === "aws") return "aws";
  if (value === "oci") return "oci";
  if (value === "gcp") return "gcp";
  throw new Error("CAREPOINT_CLOUD_PROVIDER must be 'aws', 'oci' or 'gcp' in production external credential preflight.");
}

function errorName(error: unknown): string {
  if (error instanceof Error && error.name) {
    return error.name.replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 80) || "ExternalCredentialError";
  }
  return "ExternalCredentialError";
}
