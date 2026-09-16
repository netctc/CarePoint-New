import type {
  InspectProductionManagedKey,
  ProductionManagedKeyDomain,
  ProductionManagedKeyInspection,
  ProductionManagedKeyUsage,
} from "./production-key-management";
import type {
  InspectProductionExternalSecret,
  ProductionExternalSecretDomain,
  ProductionExternalSecretInspection,
} from "./production-secret-store";

export type OciKeyResource = {
  id?: string;
  vaultId?: string;
  lifecycleState?: string;
  protectionMode?: string;
  keyShape?: {
    algorithm?: string;
  };
  isAutoRotationEnabled?: boolean;
  autoKeyRotationDetails?: {
    rotationIntervalInDays?: number;
  };
};

export type OciSecretResource = {
  id?: string;
  vaultId?: string;
  keyId?: string;
  lifecycleState?: string;
};

export type OciSecretBundleResource = {
  secretId?: string;
  versionName?: string;
  versionNumber?: number;
};

export interface OciKeyManagementClientPort {
  getKey(request: { keyId: string }): Promise<{ key?: OciKeyResource }>;
}

export interface OciSecretsClientPort {
  getSecret(request: { secretId: string }): Promise<{ secret?: OciSecretResource }>;
  getSecretBundle(request: {
    secretId: string;
    stage: "CURRENT";
  }): Promise<{ secretBundle?: OciSecretBundleResource }>;
}

export type OciManagedKeyInspectorOptions = {
  region: string;
  client: OciKeyManagementClientPort;
};

export type OciExternalCredentialInspectorOptions = {
  region: string;
  client: OciSecretsClientPort;
};

export function createOciManagedKeyInspector(
  options: OciManagedKeyInspectorOptions,
): InspectProductionManagedKey {
  const region = requiredRegion(options.region);

  return async (
    domain: ProductionManagedKeyDomain,
  ): Promise<ProductionManagedKeyInspection> => {
    if (domain.provider !== "oci-vault-kms") {
      throw namedError("OciProviderMismatch", "OCI managed-key inspector received a non-OCI key domain.");
    }
    if (domain.region !== region) {
      throw namedError("OciRegionMismatch", "OCI managed-key inspector client region does not match the key domain.");
    }

    const response = await options.client.getKey({ keyId: domain.keyRef });
    const resource = response.key;
    if (!resource) {
      throw namedError("OciKeyNotFound", "OCI Key Management returned no key resource.");
    }

    return {
      provider: "oci-vault-kms",
      region,
      vaultRef: resource.vaultId?.trim() ?? "",
      keyRef: resource.id?.trim() ?? "",
      lifecycleState: normalizeState(resource.lifecycleState),
      customerManaged: isCustomerManagedProtection(resource.protectionMode),
      usage: inferKeyUsage(resource, domain),
      rotationEnabled: resource.isAutoRotationEnabled === true,
      rotationPeriodDays: positiveInteger(
        resource.autoKeyRotationDetails?.rotationIntervalInDays,
      ),
    };
  };
}

export function createOciExternalCredentialInspector(
  options: OciExternalCredentialInspectorOptions,
): InspectProductionExternalSecret {
  const region = requiredRegion(options.region);

  return async (
    domain: ProductionExternalSecretDomain,
  ): Promise<ProductionExternalSecretInspection> => {
    if (domain.provider !== "oci-vault-secrets") {
      throw namedError("OciProviderMismatch", "OCI external-credential inspector received a non-OCI domain.");
    }
    if (domain.region !== region) {
      throw namedError("OciRegionMismatch", "OCI Secrets client region does not match the credential domain.");
    }

    const metadata = await options.client.getSecret({ secretId: domain.secretRef });
    const resource = metadata.secret;
    if (!resource) {
      throw namedError("OciCredentialNotFound", "OCI Vault returned no external credential resource.");
    }

    const current = await options.client.getSecretBundle({
      secretId: domain.secretRef,
      stage: "CURRENT",
    });
    const bundle = current.secretBundle;
    const currentVersionPresent = Boolean(
      bundle
      && bundle.secretId?.trim() === domain.secretRef
      && (
        (typeof bundle.versionNumber === "number" && Number.isInteger(bundle.versionNumber) && bundle.versionNumber > 0)
        || Boolean(bundle.versionName?.trim())
      ),
    );

    return {
      provider: "oci-vault-secrets",
      region,
      vaultRef: resource.vaultId?.trim() ?? "",
      secretRef: resource.id?.trim() ?? "",
      encryptionKeyRef: resource.keyId?.trim() ?? "",
      lifecycleState: normalizeState(resource.lifecycleState),
      currentVersionPresent,
    };
  };
}

function inferKeyUsage(
  resource: OciKeyResource,
  domain: ProductionManagedKeyDomain,
): ProductionManagedKeyUsage {
  const algorithm = resource.keyShape?.algorithm?.trim().toUpperCase();
  if (algorithm === "AES") return "encrypt-decrypt";
  if (algorithm === "RSA" || algorithm === "ECDSA") return "sign-verify";
  throw namedError(
    "OciUnsupportedKeyShape",
    `OCI key shape is not supported for '${domain.label}'.`,
  );
}

function isCustomerManagedProtection(value: string | undefined): boolean {
  const normalized = value?.trim().toUpperCase();
  return normalized === "HSM" || normalized === "SOFTWARE";
}

function normalizeState(value: string | undefined): string {
  return value?.trim().toUpperCase() ?? "";
}

function positiveInteger(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : undefined;
}

function requiredRegion(value: string): string {
  const region = value.trim();
  if (!region) throw new Error("OCI security inspector region is required.");
  return region;
}

function namedError(name: string, message: string): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}
