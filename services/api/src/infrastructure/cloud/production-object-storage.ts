import {
  GCP_KSA_PRIMARY_REGION,
  OCI_KSA_PRIMARY_REGION,
  productionCloudContract,
  type ProductionCloudProvider,
} from "./production-cloud-provider";

export type ProductionObjectStorageProvider = "aws-s3" | "oci-object-storage" | "gcp-cloud-storage";

export type ProductionObjectStorageDomain = {
  label: "clinical-documents" | "fhir-bulk-export";
  cloudProvider: ProductionCloudProvider;
  provider: ProductionObjectStorageProvider;
  region: string;
  bucketRef: string;
  kmsKeyRef: string;
  prefix: string;
  lifecycleRetentionDays?: number;
};

export type ProductionObjectStorageContract = {
  provider: ProductionObjectStorageProvider;
  region: string;
  domains: readonly ProductionObjectStorageDomain[];
};

export type ProductionObjectStorageBucketInspection = {
  provider: ProductionObjectStorageProvider;
  region: string;
  bucketRef: string;
  publicAccessDisabled: boolean;
  customerManagedEncryption: boolean;
  kmsKeyRef?: string | undefined;
};

export function productionObjectStorageContract(
  env: NodeJS.ProcessEnv = process.env,
): ProductionObjectStorageContract | null {
  if (env.NODE_ENV !== "production") return null;

  const cloud = productionCloudContract(env);
  if (!cloud) return null;

  const provider = required(env, "CAREPOINT_OBJECT_STORAGE_PROVIDER");
  if (provider !== "aws-s3" && provider !== "oci-object-storage" && provider !== "gcp-cloud-storage") {
    throw new Error(
      "CAREPOINT_OBJECT_STORAGE_PROVIDER must be 'aws-s3', 'oci-object-storage', or 'gcp-cloud-storage' in production.",
    );
  }

  if (cloud.provider === "oci" && provider !== "oci-object-storage") {
    throw new Error(
      "OCI Release 1 production requires CAREPOINT_OBJECT_STORAGE_PROVIDER='oci-object-storage'.",
    );
  }
  if (cloud.provider === "gcp" && provider !== "gcp-cloud-storage") {
    throw new Error(
      "GCP Release 1 production requires CAREPOINT_OBJECT_STORAGE_PROVIDER='gcp-cloud-storage'.",
    );
  }

  const region = required(env, "CAREPOINT_OBJECT_STORAGE_REGION");
  if (!cloud.approvedDataRegions.includes(region)) {
    throw new Error(
      `Object-storage region '${region}' is outside CAREPOINT_APPROVED_DATA_REGIONS.`,
    );
  }
  if (cloud.provider === "oci" && region !== OCI_KSA_PRIMARY_REGION) {
    throw new Error(
      `OCI Release 1 active object storage must be in primary region '${OCI_KSA_PRIMARY_REGION}'.`,
    );
  }
  if (cloud.provider === "gcp" && region !== GCP_KSA_PRIMARY_REGION) {
    throw new Error(
      `GCP Release 1 active object storage must be in primary region '${GCP_KSA_PRIMARY_REGION}'.`,
    );
  }

  const documentBucketRef = validateBucketRef(
    required(env, "CAREPOINT_DOCUMENT_BUCKET_REF"),
    provider,
    "CAREPOINT_DOCUMENT_BUCKET_REF",
  );
  const documentKeyRef = validateKeyRef(
    required(env, "CAREPOINT_DOCUMENT_STORAGE_KEY_REF"),
    provider,
    region,
    "CAREPOINT_DOCUMENT_STORAGE_KEY_REF",
  );
  const documentPrefix = normalizePrefix(
    env.CAREPOINT_DOCUMENT_STORAGE_PREFIX ?? "carepoint/clinical",
  );

  const bulkBucketRef = validateBucketRef(
    env.CAREPOINT_BULK_EXPORT_BUCKET_REF?.trim() || documentBucketRef,
    provider,
    "CAREPOINT_BULK_EXPORT_BUCKET_REF",
  );
  const bulkKeyRef = validateKeyRef(
    env.CAREPOINT_BULK_EXPORT_STORAGE_KEY_REF?.trim() || documentKeyRef,
    provider,
    region,
    "CAREPOINT_BULK_EXPORT_STORAGE_KEY_REF",
  );
  const bulkPrefix = normalizePrefix(
    env.CAREPOINT_BULK_EXPORT_PREFIX ?? "carepoint/bulk-export",
  );
  const retentionSeconds = parsePositiveInteger(
    env.BULK_EXPORT_RETENTION_SECONDS ?? "86400",
    "BULK_EXPORT_RETENTION_SECONDS",
  );
  const retentionDays = Math.max(1, Math.ceil(retentionSeconds / 86_400));

  return {
    provider,
    region,
    domains: [
      {
        label: "clinical-documents",
        cloudProvider: cloud.provider,
        provider,
        region,
        bucketRef: documentBucketRef,
        kmsKeyRef: documentKeyRef,
        prefix: documentPrefix,
      },
      {
        label: "fhir-bulk-export",
        cloudProvider: cloud.provider,
        provider,
        region,
        bucketRef: bulkBucketRef,
        kmsKeyRef: bulkKeyRef,
        prefix: bulkPrefix,
        lifecycleRetentionDays: retentionDays,
      },
    ],
  };
}

export function assertProductionObjectStorageContractReady(
  env: NodeJS.ProcessEnv = process.env,
): void {
  void productionObjectStorageContract(env);
}

export function validateProductionObjectStorageBucketInspection(
  domain: ProductionObjectStorageDomain,
  inspection: ProductionObjectStorageBucketInspection,
): void {
  if (inspection.provider !== domain.provider) {
    throw new Error(
      `Object-storage inspection provider '${inspection.provider}' does not match configured provider '${domain.provider}'.`,
    );
  }
  if (inspection.bucketRef !== domain.bucketRef) {
    throw new Error(
      `Object-storage inspection bucket '${inspection.bucketRef}' does not match configured bucket '${domain.bucketRef}'.`,
    );
  }
  if (inspection.region !== domain.region) {
    throw new Error(
      `Object-storage bucket '${domain.bucketRef}' is in region '${inspection.region}', expected '${domain.region}'.`,
    );
  }
  if (inspection.publicAccessDisabled !== true) {
    throw new Error(
      `Object-storage bucket '${domain.bucketRef}' must have public access disabled.`,
    );
  }
  if (inspection.customerManagedEncryption !== true) {
    throw new Error(
      `Object-storage bucket '${domain.bucketRef}' must use customer-managed encryption.`,
    );
  }
  const inspectedKeyRef = inspection.kmsKeyRef?.trim();
  if (!inspectedKeyRef || inspectedKeyRef !== domain.kmsKeyRef) {
    throw new Error(
      `Object-storage bucket '${domain.bucketRef}' encryption key does not match configured key reference.`,
    );
  }
}

function validateBucketRef(
  value: string,
  provider: ProductionObjectStorageProvider,
  name: string,
): string {
  const trimmed = value.trim();
  if (provider === "gcp-cloud-storage") {
    if (trimmed.length < 3 || trimmed.length > 63 || !/^[a-z0-9][a-z0-9._-]*[a-z0-9]$/.test(trimmed)) {
      throw new Error(`${name} must be a valid lowercase GCP Cloud Storage bucket name.`);
    }
    if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(trimmed)) {
      throw new Error(`${name} must not use an IP-address-shaped GCP bucket name.`);
    }
    return trimmed;
  }
  if (trimmed.length < 3 || trimmed.length > 256 || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(trimmed)) {
    throw new Error(`${name} must be a non-secret bucket reference using only letters, digits, '.', '_' or '-'.`);
  }
  return trimmed;
}

function validateKeyRef(
  value: string,
  provider: ProductionObjectStorageProvider,
  region: string,
  name: string,
): string {
  const trimmed = value.trim();
  if (provider === "oci-object-storage") {
    if (!isOciKeyOcid(trimmed)) {
      throw new Error(`${name} must be an OCI Key Management key OCID.`);
    }
    return trimmed;
  }
  if (provider === "gcp-cloud-storage") {
    const parsed = parseGcpCryptoKeyRef(trimmed);
    if (!parsed) {
      throw new Error(`${name} must be a full GCP Cloud KMS CryptoKey resource name.`);
    }
    if (parsed.region !== region) {
      throw new Error(`${name} GCP CryptoKey region '${parsed.region}' must match CAREPOINT_OBJECT_STORAGE_REGION '${region}'.`);
    }
    return trimmed;
  }
  if (!trimmed) throw new Error(`${name} is required in production.`);
  return trimmed;
}

function parseGcpCryptoKeyRef(value: string): { region: string } | null {
  const match = /^projects\/[a-z][a-z0-9-]{4,28}[a-z0-9]\/locations\/([a-z0-9-]+)\/keyRings\/[A-Za-z0-9_-]{1,63}\/cryptoKeys\/[A-Za-z0-9_-]{1,63}$/.exec(value);
  if (!match?.[1]) return null;
  return { region: match[1] };
}

function isOciKeyOcid(value: string): boolean {
  const prefix = "ocid1.key.";
  return value.startsWith(prefix) && value.length > prefix.length + 8 && !/\s/.test(value);
}

function normalizePrefix(value: string): string {
  return value.trim().replace(/^\/+|\/+$/g, "");
}

function parsePositiveInteger(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required in production.`);
  return value;
}
