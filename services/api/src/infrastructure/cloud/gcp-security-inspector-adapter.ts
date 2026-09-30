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

export type GcpDuration = {
  seconds?: string | number | bigint;
};

export type GcpCryptoKeyResource = {
  name?: string;
  purpose?: string;
  primary?: {
    state?: string;
    protectionLevel?: string;
  };
  rotationPeriod?: GcpDuration;
};

export type GcpRegionalSecretResource = {
  name?: string;
  customerManagedEncryption?: {
    kmsKeyName?: string;
  };
};

export type GcpSecretVersionResource = {
  name?: string;
  state?: string;
};

export interface GcpKmsClientPort {
  getCryptoKey(request: { name: string }): Promise<{ cryptoKey?: GcpCryptoKeyResource }>;
}

export interface GcpSecretManagerClientPort {
  getSecret(request: { name: string }): Promise<{ secret?: GcpRegionalSecretResource }>;
  getSecretVersion(request: { name: string }): Promise<{ secretVersion?: GcpSecretVersionResource }>;
}

export type GcpManagedKeyInspectorOptions = {
  region: string;
  client: GcpKmsClientPort;
};

export type GcpExternalCredentialInspectorOptions = {
  region: string;
  client: GcpSecretManagerClientPort;
};

export function createGcpManagedKeyInspector(
  options: GcpManagedKeyInspectorOptions,
): InspectProductionManagedKey {
  const region = requiredRegion(options.region);

  return async (
    domain: ProductionManagedKeyDomain,
  ): Promise<ProductionManagedKeyInspection> => {
    if (domain.provider !== "gcp-cloud-kms") {
      throw namedError("GcpProviderMismatch", "GCP managed-key inspector received a non-GCP key domain.");
    }
    if (domain.region !== region) {
      throw namedError("GcpRegionMismatch", "GCP managed-key inspector client region does not match the key domain.");
    }

    const response = await options.client.getCryptoKey({ name: domain.keyRef });
    const resource = response.cryptoKey;
    if (!resource) {
      throw namedError("GcpKeyNotFound", "GCP Cloud KMS returned no CryptoKey resource.");
    }

    const keyRef = resource.name?.trim() ?? "";
    const parsed = parseCryptoKeyRef(keyRef);
    if (!parsed) {
      throw namedError("GcpInvalidKeyResource", "GCP Cloud KMS returned an invalid CryptoKey resource name.");
    }

    return {
      provider: "gcp-cloud-kms",
      region: parsed.region,
      vaultRef: parsed.keyRingRef,
      keyRef,
      lifecycleState: normalizeState(resource.primary?.state),
      customerManaged: isCustomerManagedProtection(resource.primary?.protectionLevel),
      usage: inferKeyUsage(resource, domain),
      rotationEnabled: durationDays(resource.rotationPeriod) !== undefined,
      rotationPeriodDays: durationDays(resource.rotationPeriod),
    };
  };
}

export function createGcpExternalCredentialInspector(
  options: GcpExternalCredentialInspectorOptions,
): InspectProductionExternalSecret {
  const region = requiredRegion(options.region);

  return async (
    domain: ProductionExternalSecretDomain,
  ): Promise<ProductionExternalSecretInspection> => {
    if (domain.provider !== "gcp-secret-manager") {
      throw namedError("GcpProviderMismatch", "GCP external-credential inspector received a non-GCP secret domain.");
    }
    if (domain.region !== region) {
      throw namedError("GcpRegionMismatch", "GCP Secret Manager client region does not match the credential domain.");
    }

    const response = await options.client.getSecret({ name: domain.secretRef });
    const resource = response.secret;
    if (!resource) {
      throw namedError("GcpCredentialNotFound", "GCP Secret Manager returned no secret resource.");
    }

    const secretRef = resource.name?.trim() ?? "";
    const parsedSecret = parseRegionalSecretRef(secretRef);
    if (!parsedSecret) {
      throw namedError("GcpInvalidSecretResource", "GCP Secret Manager returned an invalid regional secret resource name.");
    }

    const encryptionKeyRef = resource.customerManagedEncryption?.kmsKeyName?.trim() ?? "";
    const parsedKey = parseCryptoKeyRef(encryptionKeyRef);
    const latest = await options.client.getSecretVersion({
      name: `${domain.secretRef}/versions/latest`,
    });
    const version = latest.secretVersion;
    const currentVersionPresent = Boolean(
      version
      && version.name?.trim().startsWith(`${domain.secretRef}/versions/`)
      && normalizeState(version.state) === "ENABLED",
    );

    return {
      provider: "gcp-secret-manager",
      region: parsedSecret.region,
      vaultRef: parsedKey?.keyRingRef ?? "",
      secretRef,
      encryptionKeyRef,
      lifecycleState: "ACTIVE",
      currentVersionPresent,
    };
  };
}

function inferKeyUsage(
  resource: GcpCryptoKeyResource,
  domain: ProductionManagedKeyDomain,
): ProductionManagedKeyUsage {
  const purpose = resource.purpose?.trim().toUpperCase();
  if (purpose === "ENCRYPT_DECRYPT") return "encrypt-decrypt";
  if (purpose === "ASYMMETRIC_SIGN") return "sign-verify";
  throw namedError(
    "GcpUnsupportedKeyPurpose",
    `GCP CryptoKey purpose is not supported for '${domain.label}'.`,
  );
}

function durationDays(value: GcpDuration | undefined): number | undefined {
  const raw = value?.seconds;
  if (raw === undefined) return undefined;
  const seconds = typeof raw === "bigint" ? Number(raw) : Number(raw);
  if (!Number.isSafeInteger(seconds) || seconds <= 0 || seconds % 86_400 !== 0) return undefined;
  const days = seconds / 86_400;
  return Number.isSafeInteger(days) && days > 0 ? days : undefined;
}

function isCustomerManagedProtection(value: string | undefined): boolean {
  const normalized = value?.trim().toUpperCase();
  return normalized === "SOFTWARE" || normalized === "HSM";
}

function parseCryptoKeyRef(value: string): { region: string; keyRingRef: string } | null {
  const match = /^(projects\/[a-z][a-z0-9-]{4,28}[a-z0-9]\/locations\/([a-z0-9-]+)\/keyRings\/[A-Za-z0-9_-]{1,63})\/cryptoKeys\/[A-Za-z0-9_-]{1,63}$/.exec(value);
  if (!match?.[1] || !match[2]) return null;
  return { region: match[2], keyRingRef: match[1] };
}

function parseRegionalSecretRef(value: string): { region: string } | null {
  const match = /^projects\/[a-z][a-z0-9-]{4,28}[a-z0-9]\/locations\/([a-z0-9-]+)\/secrets\/[A-Za-z0-9_-]{1,255}$/.exec(value);
  if (!match?.[1]) return null;
  return { region: match[1] };
}

function normalizeState(value: string | undefined): string {
  return value?.trim().toUpperCase() ?? "";
}

function requiredRegion(value: string): string {
  const region = value.trim();
  if (!region) throw new Error("GCP security inspector region is required.");
  return region;
}

function namedError(name: string, message: string): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}
