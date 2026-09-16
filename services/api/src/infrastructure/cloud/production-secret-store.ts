import {
  OCI_KSA_PRIMARY_REGION,
  productionCloudContract,
  type ProductionCloudProvider,
} from "./production-cloud-provider";
import {
  productionKeyManagementContract,
  type ProductionKeyManagementProvider,
} from "./production-key-management";

export const PRODUCTION_EXTERNAL_SECRET_STORE_PROVIDERS = [
  "aws-kms-files",
  "oci-vault-secrets",
] as const;

export type ProductionExternalSecretStoreProvider =
  (typeof PRODUCTION_EXTERNAL_SECRET_STORE_PROVIDERS)[number];

export const PRODUCTION_EXTERNAL_SECRET_DEFINITIONS = [
  {
    name: "payment-gateway-api-key",
    refEnv: "CAREPOINT_PAYMENT_GATEWAY_SECRET_REF",
    legacyEnv: "PAYMENT_GATEWAY_API_KEY",
  },
  {
    name: "insurance-gateway-api-key",
    refEnv: "CAREPOINT_INSURANCE_GATEWAY_SECRET_REF",
    legacyEnv: "INSURANCE_GATEWAY_API_KEY",
  },
  {
    name: "claims-gateway-api-key",
    refEnv: "CAREPOINT_CLAIMS_GATEWAY_SECRET_REF",
    legacyEnv: "CLAIMS_GATEWAY_API_KEY",
  },
  {
    name: "notification-gateway-api-key",
    refEnv: "CAREPOINT_NOTIFICATION_GATEWAY_SECRET_REF",
    legacyEnv: "NOTIFICATION_GATEWAY_API_KEY",
  },
  {
    name: "siem-export-api-key",
    refEnv: "CAREPOINT_SIEM_EXPORT_SECRET_REF",
    legacyEnv: "SIEM_EXPORT_API_KEY",
  },
  {
    name: "livekit-api-key",
    refEnv: "CAREPOINT_LIVEKIT_API_KEY_SECRET_REF",
    legacyEnv: "LIVEKIT_API_KEY",
  },
  {
    name: "livekit-api-secret",
    refEnv: "CAREPOINT_LIVEKIT_API_SECRET_REF",
    legacyEnv: "LIVEKIT_API_SECRET",
  },
] as const;

export type ProductionExternalSecretName =
  (typeof PRODUCTION_EXTERNAL_SECRET_DEFINITIONS)[number]["name"];

export type ProductionExternalSecretDomain = {
  name: ProductionExternalSecretName;
  cloudProvider: ProductionCloudProvider;
  keyManagementProvider: ProductionKeyManagementProvider;
  provider: ProductionExternalSecretStoreProvider;
  region: string;
  vaultRef: string;
  secretRef: string;
  encryptionKeyRef: string;
};

export type ProductionExternalSecretStoreContract = {
  provider: ProductionExternalSecretStoreProvider;
  region: string;
  vaultRef: string;
  secrets: readonly ProductionExternalSecretDomain[];
};

export type ProductionExternalSecretInspection = {
  provider: ProductionExternalSecretStoreProvider;
  region: string;
  vaultRef: string;
  secretRef: string;
  encryptionKeyRef: string;
  lifecycleState: string;
  currentVersionPresent: boolean;
};

export type InspectProductionExternalSecret = (
  secret: ProductionExternalSecretDomain,
) => Promise<ProductionExternalSecretInspection>;

export async function assertProductionExternalSecretInspectionReady(
  inspectSecret: InspectProductionExternalSecret,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const contract = productionExternalSecretStoreContract(env);
  if (!contract) return;

  for (const secret of contract.secrets) {
    let inspection: ProductionExternalSecretInspection;
    try {
      inspection = await inspectSecret(secret);
    } catch (error) {
      throw new Error(
        `Production external-secret inspection failed for '${secret.name}': ${errorName(error)}.`,
      );
    }
    validateProductionExternalSecretInspection(secret, inspection);
  }
}

export function productionExternalSecretStoreContract(
  env: NodeJS.ProcessEnv = process.env,
): ProductionExternalSecretStoreContract | null {
  if (env.NODE_ENV !== "production") return null;

  const cloud = productionCloudContract(env);
  const keyManagement = productionKeyManagementContract(env);
  if (!cloud || !keyManagement) return null;

  const provider = required(env, "CAREPOINT_EXTERNAL_SECRET_PROVIDER");
  if (!PRODUCTION_EXTERNAL_SECRET_STORE_PROVIDERS.includes(provider as ProductionExternalSecretStoreProvider)) {
    throw new Error(
      "CAREPOINT_EXTERNAL_SECRET_PROVIDER must be 'aws-kms-files' or 'oci-vault-secrets' in production.",
    );
  }
  const resolvedProvider = provider as ProductionExternalSecretStoreProvider;
  if (cloud.provider === "oci" && resolvedProvider !== "oci-vault-secrets") {
    throw new Error(
      "OCI Release 1 production requires CAREPOINT_EXTERNAL_SECRET_PROVIDER" +
        "='oci-vault-secrets'.",
    );
  }

  const region = required(env, "CAREPOINT_EXTERNAL_SECRET_REGION");
  if (!cloud.approvedDataRegions.includes(region)) {
    throw new Error(
      `External-secret region '${region}' is outside CAREPOINT_APPROVED_DATA_REGIONS.`,
    );
  }
  if (cloud.provider === "oci" && region !== OCI_KSA_PRIMARY_REGION) {
    throw new Error(
      `OCI Release 1 active external-secret store must be in primary region '${OCI_KSA_PRIMARY_REGION}'.`,
    );
  }
  if (region !== keyManagement.region) {
    throw new Error(
      "CAREPOINT_EXTERNAL_SECRET_REGION must match CAREPOINT_KEY_MANAGEMENT_REGION.",
    );
  }

  const externalSecretKey = keyManagement.domains.find(
    (domain) => domain.label === "external-integration-secrets",
  );
  if (!externalSecretKey) {
    throw new Error("External-integration secret encryption key contract is missing.");
  }

  const secrets: ProductionExternalSecretDomain[] = PRODUCTION_EXTERNAL_SECRET_DEFINITIONS.map(
    (definition) => {
      if (env[definition.legacyEnv]?.trim()) {
        throw new Error(
          `${definition.legacyEnv} plaintext environment configuration is forbidden for the production external-secret contract.`,
        );
      }
      return {
        name: definition.name,
        cloudProvider: cloud.provider,
        keyManagementProvider: keyManagement.provider,
        provider: resolvedProvider,
        region,
        vaultRef: keyManagement.vaultRef,
        secretRef: validateSecretRef(
          required(env, definition.refEnv),
          resolvedProvider,
          definition.refEnv,
        ),
        encryptionKeyRef: externalSecretKey.keyRef,
      };
    },
  );

  if (new Set(secrets.map((secret) => secret.secretRef)).size !== secrets.length) {
    throw new Error(
      "Each production external integration secret must use a distinct secret reference.",
    );
  }

  return {
    provider: resolvedProvider,
    region,
    vaultRef: keyManagement.vaultRef,
    secrets,
  };
}

export function assertProductionExternalSecretStoreContractReady(
  env: NodeJS.ProcessEnv = process.env,
): void {
  void productionExternalSecretStoreContract(env);
}

export function validateProductionExternalSecretInspection(
  secret: ProductionExternalSecretDomain,
  inspection: ProductionExternalSecretInspection,
): void {
  if (inspection.provider !== secret.provider) {
    throw new Error(
      `External-secret inspection provider '${inspection.provider}' does not match configured provider '${secret.provider}'.`,
    );
  }
  if (inspection.region !== secret.region) {
    throw new Error(
      `External secret '${secret.name}' is in region '${inspection.region}', expected '${secret.region}'.`,
    );
  }
  if (inspection.vaultRef !== secret.vaultRef) {
    throw new Error(
      `External secret '${secret.name}' does not belong to configured vault '${secret.vaultRef}'.`,
    );
  }
  if (inspection.secretRef !== secret.secretRef) {
    throw new Error(
      `External-secret inspection reference '${inspection.secretRef}' does not match configured secret '${secret.name}'.`,
    );
  }
  if (inspection.encryptionKeyRef !== secret.encryptionKeyRef) {
    throw new Error(
      `External secret '${secret.name}' encryption key does not match configured external-secret key reference.`,
    );
  }
  if (inspection.lifecycleState !== "ACTIVE") {
    throw new Error(
      `External secret '${secret.name}' must be in ACTIVE lifecycle state.`,
    );
  }
  if (inspection.currentVersionPresent !== true) {
    throw new Error(
      `External secret '${secret.name}' must expose a current secret version.`,
    );
  }
}

function validateSecretRef(
  value: string,
  provider: ProductionExternalSecretStoreProvider,
  name: string,
): string {
  const trimmed = value.trim();
  if (provider === "oci-vault-secrets" && !isOcid(trimmed, "vaultsecret")) {
    throw new Error(`${name} must be an OCI Vault secret OCID.`);
  }
  if (!trimmed) throw new Error(`${name} is required in production.`);
  return trimmed;
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

function errorName(error: unknown): string {
  if (error instanceof Error && error.name) {
    return error.name.replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 80) || "ExternalSecretError";
  }
  return "ExternalSecretError";
}
