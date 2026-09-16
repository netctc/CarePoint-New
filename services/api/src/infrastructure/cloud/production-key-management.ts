import {
  GCP_KSA_PRIMARY_REGION,
  OCI_KSA_PRIMARY_REGION,
  productionCloudContract,
  type ProductionCloudProvider,
} from "./production-cloud-provider";

export type ProductionKeyManagementProvider = "aws-kms" | "oci-vault-kms" | "gcp-cloud-kms";
export type ProductionManagedKeyUsage = "encrypt-decrypt" | "sign-verify";
export type ProductionManagedKeyRotationMode = "automatic" | "manual";

export type ProductionManagedKeyDomain = {
  label: "clinical-documents" | "clinical-document-attestation" | "external-integration-secrets";
  cloudProvider: ProductionCloudProvider;
  provider: ProductionKeyManagementProvider;
  region: string;
  vaultRef: string;
  keyRef: string;
  usage: ProductionManagedKeyUsage;
  rotationMode: ProductionManagedKeyRotationMode;
  maxRotationDays: number;
};

export type ProductionKeyManagementContract = {
  provider: ProductionKeyManagementProvider;
  region: string;
  vaultRef: string;
  domains: readonly ProductionManagedKeyDomain[];
};

export type ProductionManagedKeyInspection = {
  provider: ProductionKeyManagementProvider;
  region: string;
  vaultRef: string;
  keyRef: string;
  lifecycleState: string;
  customerManaged: boolean;
  usage: ProductionManagedKeyUsage;
  rotationEnabled: boolean;
  rotationPeriodDays?: number | undefined;
};

export type InspectProductionManagedKey = (
  domain: ProductionManagedKeyDomain,
) => Promise<ProductionManagedKeyInspection>;

export async function assertProductionKeyManagementInspectionReady(
  inspectKey: InspectProductionManagedKey,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const contract = productionKeyManagementContract(env);
  if (!contract) return;

  for (const domain of contract.domains) {
    let inspection: ProductionManagedKeyInspection;
    try {
      inspection = await inspectKey(domain);
    } catch (error) {
      throw new Error(
        `Production key-management inspection failed for '${domain.label}': ${errorName(error)}.`,
      );
    }
    validateProductionManagedKeyInspection(domain, inspection);
  }
}

export function productionKeyManagementContract(
  env: NodeJS.ProcessEnv = process.env,
): ProductionKeyManagementContract | null {
  if (env.NODE_ENV !== "production") return null;

  const cloud = productionCloudContract(env);
  if (!cloud) return null;

  const provider = required(env, "CAREPOINT_KEY_MANAGEMENT_PROVIDER");
  if (provider !== "aws-kms" && provider !== "oci-vault-kms" && provider !== "gcp-cloud-kms") {
    throw new Error(
      "CAREPOINT_KEY_MANAGEMENT_PROVIDER must be 'aws-kms', 'oci-vault-kms', or 'gcp-cloud-kms' in production.",
    );
  }
  if (cloud.provider === "oci" && provider !== "oci-vault-kms") {
    throw new Error(
      "OCI Release 1 production requires CAREPOINT_KEY_MANAGEMENT_PROVIDER='oci-vault-kms'.",
    );
  }
  if (cloud.provider === "gcp" && provider !== "gcp-cloud-kms") {
    throw new Error(
      "GCP Release 1 production requires CAREPOINT_KEY_MANAGEMENT_PROVIDER='gcp-cloud-kms'.",
    );
  }

  const region = required(env, "CAREPOINT_KEY_MANAGEMENT_REGION");
  if (!cloud.approvedDataRegions.includes(region)) {
    throw new Error(
      `Key-management region '${region}' is outside CAREPOINT_APPROVED_DATA_REGIONS.`,
    );
  }
  if (cloud.provider === "oci" && region !== OCI_KSA_PRIMARY_REGION) {
    throw new Error(
      `OCI Release 1 active key management must be in primary region '${OCI_KSA_PRIMARY_REGION}'.`,
    );
  }
  if (cloud.provider === "gcp" && region !== GCP_KSA_PRIMARY_REGION) {
    throw new Error(
      `GCP Release 1 active key management must be in primary region '${GCP_KSA_PRIMARY_REGION}'.`,
    );
  }

  const vaultRef = validateVaultRef(
    required(env, "CAREPOINT_VAULT_REF"),
    provider,
    region,
    "CAREPOINT_VAULT_REF",
  );
  const maxRotationDays = parseRotationDays(
    env.CAREPOINT_KEY_MAX_ROTATION_DAYS ?? "365",
    "CAREPOINT_KEY_MAX_ROTATION_DAYS",
  );

  const domains: ProductionManagedKeyDomain[] = [
    {
      label: "clinical-documents",
      cloudProvider: cloud.provider,
      provider,
      region,
      vaultRef,
      keyRef: validateKeyRef(
        required(env, "CAREPOINT_DOCUMENT_KEY_REF"),
        provider,
        region,
        vaultRef,
        "CAREPOINT_DOCUMENT_KEY_REF",
      ),
      usage: "encrypt-decrypt",
      rotationMode: "automatic",
      maxRotationDays,
    },
    {
      label: "clinical-document-attestation",
      cloudProvider: cloud.provider,
      provider,
      region,
      vaultRef,
      keyRef: validateKeyRef(
        required(env, "CAREPOINT_DOCUMENT_SIGNING_KEY_REF"),
        provider,
        region,
        vaultRef,
        "CAREPOINT_DOCUMENT_SIGNING_KEY_REF",
      ),
      usage: "sign-verify",
      rotationMode: provider === "gcp-cloud-kms" ? "manual" : "automatic",
      maxRotationDays,
    },
    {
      label: "external-integration-secrets",
      cloudProvider: cloud.provider,
      provider,
      region,
      vaultRef,
      keyRef: validateKeyRef(
        required(env, "CAREPOINT_EXTERNAL_SECRET_KEY_REF"),
        provider,
        region,
        vaultRef,
        "CAREPOINT_EXTERNAL_SECRET_KEY_REF",
      ),
      usage: "encrypt-decrypt",
      rotationMode: "automatic",
      maxRotationDays,
    },
  ];

  if (new Set(domains.map((domain) => domain.keyRef)).size !== domains.length) {
    throw new Error(
      "Release 1 production document encryption, document signing and external-secret keys must use distinct key references.",
    );
  }

  return { provider, region, vaultRef, domains };
}

export function assertProductionKeyManagementContractReady(
  env: NodeJS.ProcessEnv = process.env,
): void {
  void productionKeyManagementContract(env);
}

export function validateProductionManagedKeyInspection(
  domain: ProductionManagedKeyDomain,
  inspection: ProductionManagedKeyInspection,
): void {
  if (inspection.provider !== domain.provider) {
    throw new Error(
      `Managed-key inspection provider '${inspection.provider}' does not match configured provider '${domain.provider}'.`,
    );
  }
  if (inspection.region !== domain.region) {
    throw new Error(
      `Managed key '${domain.keyRef}' is in region '${inspection.region}', expected '${domain.region}'.`,
    );
  }
  if (inspection.vaultRef !== domain.vaultRef) {
    throw new Error(
      `Managed key '${domain.keyRef}' does not belong to configured key-management container '${domain.vaultRef}'.`,
    );
  }
  if (inspection.keyRef !== domain.keyRef) {
    throw new Error(
      `Managed-key inspection reference '${inspection.keyRef}' does not match configured key '${domain.keyRef}'.`,
    );
  }
  if (inspection.lifecycleState !== "ENABLED") {
    throw new Error(
      `Managed key '${domain.keyRef}' must be in ENABLED lifecycle state.`,
    );
  }
  if (inspection.customerManaged !== true) {
    throw new Error(
      `Managed key '${domain.keyRef}' must be customer-managed.`,
    );
  }
  if (inspection.usage !== domain.usage) {
    throw new Error(
      `Managed key '${domain.keyRef}' usage '${inspection.usage}' does not match required usage '${domain.usage}'.`,
    );
  }

  if (domain.rotationMode === "manual") {
    if (inspection.rotationEnabled === true || inspection.rotationPeriodDays !== undefined) {
      throw new Error(
        `Managed key '${domain.keyRef}' must use manual rotation without an automatic rotation schedule.`,
      );
    }
    return;
  }

  if (inspection.rotationEnabled !== true) {
    throw new Error(
      `Managed key '${domain.keyRef}' must have rotation enabled.`,
    );
  }
  const period = inspection.rotationPeriodDays;
  if (typeof period !== "number" || !Number.isInteger(period) || period < 1) {
    throw new Error(
      `Managed key '${domain.keyRef}' must expose a positive rotation period.`,
    );
  }
  if (period > domain.maxRotationDays) {
    throw new Error(
      `Managed key '${domain.keyRef}' rotation period exceeds CAREPOINT_KEY_MAX_ROTATION_DAYS (${domain.maxRotationDays}).`,
    );
  }
}

function validateVaultRef(
  value: string,
  provider: ProductionKeyManagementProvider,
  region: string,
  name: string,
): string {
  const trimmed = value.trim();
  if (provider === "oci-vault-kms" && !isOcid(trimmed, "vault")) {
    throw new Error(`${name} must be an OCI Vault OCID.`);
  }
  if (provider === "gcp-cloud-kms") {
    const parsed = parseGcpKeyRingRef(trimmed);
    if (!parsed) {
      throw new Error(`${name} must be a full GCP Cloud KMS key-ring resource name.`);
    }
    if (parsed.region !== region) {
      throw new Error(`${name} GCP key-ring region '${parsed.region}' must match CAREPOINT_KEY_MANAGEMENT_REGION '${region}'.`);
    }
  }
  if (!trimmed) throw new Error(`${name} is required in production.`);
  return trimmed;
}

function validateKeyRef(
  value: string,
  provider: ProductionKeyManagementProvider,
  region: string,
  vaultRef: string,
  name: string,
): string {
  const trimmed = value.trim();
  if (provider === "oci-vault-kms" && !isOcid(trimmed, "key")) {
    throw new Error(`${name} must be an OCI Key Management key OCID.`);
  }
  if (provider === "gcp-cloud-kms") {
    const parsed = parseGcpCryptoKeyRef(trimmed);
    if (!parsed) {
      throw new Error(`${name} must be a full GCP Cloud KMS CryptoKey resource name.`);
    }
    if (parsed.region !== region) {
      throw new Error(`${name} GCP CryptoKey region '${parsed.region}' must match CAREPOINT_KEY_MANAGEMENT_REGION '${region}'.`);
    }
    if (parsed.keyRingRef !== vaultRef) {
      throw new Error(`${name} must belong to CAREPOINT_VAULT_REF GCP key ring.`);
    }
  }
  if (!trimmed) throw new Error(`${name} is required in production.`);
  return trimmed;
}

function parseGcpKeyRingRef(value: string): { projectId: string; region: string } | null {
  const match = /^projects\/([a-z][a-z0-9-]{4,28}[a-z0-9])\/locations\/([a-z0-9-]+)\/keyRings\/([A-Za-z0-9_-]{1,63})$/.exec(value);
  if (!match?.[1] || !match[2] || !match[3]) return null;
  return { projectId: match[1], region: match[2] };
}

function parseGcpCryptoKeyRef(value: string): { projectId: string; region: string; keyRingRef: string } | null {
  const match = /^(projects\/([a-z][a-z0-9-]{4,28}[a-z0-9])\/locations\/([a-z0-9-]+)\/keyRings\/[A-Za-z0-9_-]{1,63})\/cryptoKeys\/[A-Za-z0-9_-]{1,63}$/.exec(value);
  if (!match?.[1] || !match[2] || !match[3]) return null;
  return { projectId: match[2], region: match[3], keyRingRef: match[1] };
}

function isOcid(value: string, resourceType: string): boolean {
  const prefix = `ocid1.${resourceType}.`;
  return value.startsWith(prefix) && value.length > prefix.length + 8 && !/\s/.test(value);
}

function parseRotationDays(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 365) {
    throw new Error(`${name} must be an integer between 1 and 365.`);
  }
  return parsed;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required in production.`);
  return value;
}

function errorName(error: unknown): string {
  if (error instanceof Error && error.name) {
    return error.name.replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 80) || "KeyManagementError";
  }
  return "KeyManagementError";
}
