import {
  GetBucketEncryptionCommand,
  GetBucketLifecycleConfigurationCommand,
  GetBucketLocationCommand,
  GetBucketOwnershipControlsCommand,
  GetPublicAccessBlockCommand,
  HeadBucketCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { DescribeKeyCommand, KMSClient } from "@aws-sdk/client-kms";

type PublicAccessBlockInspection = {
  blockPublicAcls?: boolean;
  ignorePublicAcls?: boolean;
  blockPublicPolicy?: boolean;
  restrictPublicBuckets?: boolean;
};

type LifecycleRuleInspection = {
  status?: string;
  prefix: string;
  expirationDays?: number;
};

export type ObjectStorageBucketInspection = {
  region: string;
  publicAccessBlock?: PublicAccessBlockInspection;
  defaultEncryption?: { algorithm?: string; kmsKeyId?: string };
  ownershipModes: string[];
  lifecycleRules: LifecycleRuleInspection[];
};

export type ObjectStorageKmsInspection = {
  keyId?: string;
  arn?: string;
  enabled?: boolean;
  keyState?: string;
  keyUsage?: string;
  keySpec?: string;
  keyManager?: string;
};

export type InspectProductionBucket = (bucket: string) => Promise<ObjectStorageBucketInspection>;
export type InspectProductionStorageKmsKey = (keyId: string) => Promise<ObjectStorageKmsInspection>;

export interface ProductionObjectStoragePreflightOptions {
  inspectBucket?: InspectProductionBucket;
  inspectKmsKey?: InspectProductionStorageKmsKey;
}

type StorageDomain = {
  label: string;
  bucket: string;
  kmsKeyId: string;
  prefix: string;
  lifecycleRetentionDays?: number;
};

export async function assertProductionObjectStorageReady(
  options: ProductionObjectStoragePreflightOptions = {},
): Promise<void> {
  if (process.env.NODE_ENV !== "production") return;

  const region = required("AWS_REGION");
  if (process.env.AWS_ENDPOINT_URL_S3?.trim()) {
    throw new Error("AWS_ENDPOINT_URL_S3 is development/test-only and is forbidden in production.");
  }

  const domains = productionStorageDomains();
  const inspectBucket = options.inspectBucket ?? liveBucketInspector(region);
  const inspectKmsKey = options.inspectKmsKey ?? liveKmsInspector(region);

  const keyInspections = new Map<string, ObjectStorageKmsInspection>();
  for (const domain of domains) {
    if (keyInspections.has(domain.kmsKeyId)) continue;
    let inspection: ObjectStorageKmsInspection;
    try {
      inspection = await inspectKmsKey(domain.kmsKeyId);
    } catch (error) {
      throw new Error(`Production object-storage preflight could not describe KMS key '${domain.kmsKeyId}': ${errorMessage(error)}`);
    }
    validateStorageKmsKey(domain.kmsKeyId, inspection, region);
    keyInspections.set(domain.kmsKeyId, inspection);
  }

  const bucketInspections = new Map<string, ObjectStorageBucketInspection>();
  for (const domain of domains) {
    let inspection = bucketInspections.get(domain.bucket);
    if (!inspection) {
      try {
        inspection = await inspectBucket(domain.bucket);
      } catch (error) {
        throw new Error(`Production object-storage preflight could not inspect bucket '${domain.bucket}': ${errorMessage(error)}`);
      }
      validatePrivateBucket(domain.bucket, inspection, region);
      bucketInspections.set(domain.bucket, inspection);
    }

    const validatedKey = keyInspections.get(domain.kmsKeyId);
    if (!validatedKey) throw new Error(`Storage KMS key '${domain.kmsKeyId}' was not validated.`);
    validateDefaultEncryption(domain, inspection, validatedKey);
    if (domain.lifecycleRetentionDays !== undefined) validateLifecycle(domain, inspection);
  }
}

function productionStorageDomains(): StorageDomain[] {
  const documentProvider = (process.env.DOCUMENT_STORAGE_PROVIDER ?? "s3").trim();
  if (documentProvider !== "s3") throw new Error("DOCUMENT_STORAGE_PROVIDER must be 's3' in production.");

  const documentBucket = required("DOCUMENT_S3_BUCKET");
  const documentKmsKeyId = required("DOCUMENT_S3_KMS_KEY_ID");
  const documentPrefix = normalizePrefix(process.env.DOCUMENT_S3_PREFIX ?? "carepoint/clinical");

  const bulkProvider = (process.env.BULK_EXPORT_STORAGE_PROVIDER ?? documentProvider).trim();
  if (bulkProvider !== "s3") throw new Error("BULK_EXPORT_STORAGE_PROVIDER must be 's3' in production.");
  const bulkBucket = process.env.BULK_EXPORT_S3_BUCKET?.trim() || documentBucket;
  const bulkKmsKeyId = process.env.BULK_EXPORT_S3_KMS_KEY_ID?.trim() || documentKmsKeyId;
  const bulkPrefix = normalizePrefix(process.env.BULK_EXPORT_S3_PREFIX ?? "carepoint/bulk-export");
  const retentionSeconds = parsePositiveInteger(process.env.BULK_EXPORT_RETENTION_SECONDS ?? "86400", "BULK_EXPORT_RETENTION_SECONDS");
  const retentionDays = Math.max(1, Math.ceil(retentionSeconds / 86_400));

  return [
    { label: "clinical documents", bucket: documentBucket, kmsKeyId: documentKmsKeyId, prefix: documentPrefix },
    { label: "FHIR bulk export", bucket: bulkBucket, kmsKeyId: bulkKmsKeyId, prefix: bulkPrefix, lifecycleRetentionDays: retentionDays },
  ];
}

function validatePrivateBucket(bucket: string, inspection: ObjectStorageBucketInspection, region: string): void {
  if (inspection.region !== region) {
    throw new Error(`S3 bucket '${bucket}' is in region '${inspection.region}', expected '${region}'.`);
  }

  const block = inspection.publicAccessBlock;
  if (!block || !block.blockPublicAcls || !block.ignorePublicAcls || !block.blockPublicPolicy || !block.restrictPublicBuckets) {
    throw new Error(`S3 bucket '${bucket}' must enable all four S3 Block Public Access controls.`);
  }

  if (!inspection.ownershipModes.includes("BucketOwnerEnforced")) {
    throw new Error(`S3 bucket '${bucket}' must use BucketOwnerEnforced object ownership so ACLs are disabled.`);
  }
}

function validateDefaultEncryption(
  domain: StorageDomain,
  inspection: ObjectStorageBucketInspection,
  validatedKey: ObjectStorageKmsInspection,
): void {
  const encryption = inspection.defaultEncryption;
  if (!encryption || (encryption.algorithm !== "aws:kms" && encryption.algorithm !== "aws:kms:dsse")) {
    throw new Error(`S3 bucket '${domain.bucket}' must use KMS default encryption for ${domain.label}.`);
  }
  const defaultKey = encryption.kmsKeyId?.trim();
  if (!defaultKey) throw new Error(`S3 bucket '${domain.bucket}' default KMS encryption is missing a KMS key for ${domain.label}.`);
  if (!kmsReferenceMatches(defaultKey, domain.kmsKeyId, validatedKey)) {
    throw new Error(`S3 bucket '${domain.bucket}' default encryption key does not match ${domain.label} key '${domain.kmsKeyId}'.`);
  }
}

function validateLifecycle(domain: StorageDomain, inspection: ObjectStorageBucketInspection): void {
  const maxDays = domain.lifecycleRetentionDays;
  if (maxDays === undefined) return;
  const matchingRule = inspection.lifecycleRules.find((rule) => {
    if (rule.status !== "Enabled" || !Number.isInteger(rule.expirationDays) || (rule.expirationDays ?? 0) < 1) return false;
    if ((rule.expirationDays as number) > maxDays) return false;
    return prefixCovers(rule.prefix, domain.prefix);
  });
  if (!matchingRule) {
    throw new Error(`S3 bucket '${domain.bucket}' needs an Enabled lifecycle expiration rule covering prefix '${domain.prefix}' within ${maxDays} day(s).`);
  }
}

function validateStorageKmsKey(keyId: string, inspection: ObjectStorageKmsInspection, region: string): void {
  if (inspection.enabled !== true || inspection.keyState !== "Enabled") {
    throw new Error(`Storage KMS key '${keyId}' must be Enabled.`);
  }
  if (inspection.keyUsage !== "ENCRYPT_DECRYPT" || inspection.keySpec !== "SYMMETRIC_DEFAULT") {
    throw new Error(`Storage KMS key '${keyId}' must use SYMMETRIC_DEFAULT / ENCRYPT_DECRYPT.`);
  }
  if (inspection.keyManager !== "CUSTOMER") {
    throw new Error(`Storage KMS key '${keyId}' must be customer-managed.`);
  }
  const arn = inspection.arn?.trim();
  const arnRegion = arn ? parseKmsArnRegion(arn) : null;
  if (!arn || !inspection.keyId?.trim() || !arnRegion) {
    throw new Error(`Storage KMS key '${keyId}' metadata must include a valid KeyId and KMS ARN.`);
  }
  if (arnRegion !== region) {
    throw new Error(`Storage KMS key '${keyId}' is in region '${arnRegion}', expected '${region}'.`);
  }
}

function liveBucketInspector(region: string): InspectProductionBucket {
  const client = new S3Client({ region });
  return async (bucket: string) => {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
    const [location, access, encryption, ownership, lifecycle] = await Promise.all([
      client.send(new GetBucketLocationCommand({ Bucket: bucket })),
      optionalS3Control(() => client.send(new GetPublicAccessBlockCommand({ Bucket: bucket })), ["NoSuchPublicAccessBlockConfiguration"]),
      optionalS3Control(() => client.send(new GetBucketEncryptionCommand({ Bucket: bucket })), ["ServerSideEncryptionConfigurationNotFoundError"]),
      optionalS3Control(() => client.send(new GetBucketOwnershipControlsCommand({ Bucket: bucket })), ["OwnershipControlsNotFoundError"]),
      optionalS3Control(() => client.send(new GetBucketLifecycleConfigurationCommand({ Bucket: bucket })), ["NoSuchLifecycleConfiguration"]),
    ]);

    const kmsRule = encryption?.ServerSideEncryptionConfiguration?.Rules?.find((rule) => {
      const algorithm = rule.ApplyServerSideEncryptionByDefault?.SSEAlgorithm;
      return algorithm === "aws:kms" || String(algorithm) === "aws:kms:dsse";
    });

    return {
      region: normalizeS3Region(location.LocationConstraint),
      publicAccessBlock: access?.PublicAccessBlockConfiguration
        ? {
            blockPublicAcls: access.PublicAccessBlockConfiguration.BlockPublicAcls,
            ignorePublicAcls: access.PublicAccessBlockConfiguration.IgnorePublicAcls,
            blockPublicPolicy: access.PublicAccessBlockConfiguration.BlockPublicPolicy,
            restrictPublicBuckets: access.PublicAccessBlockConfiguration.RestrictPublicBuckets,
          }
        : undefined,
      defaultEncryption: kmsRule
        ? {
            algorithm: String(kmsRule.ApplyServerSideEncryptionByDefault?.SSEAlgorithm ?? ""),
            kmsKeyId: kmsRule.ApplyServerSideEncryptionByDefault?.KMSMasterKeyID,
          }
        : undefined,
      ownershipModes: ownership?.OwnershipControls?.Rules?.map((rule) => String(rule.ObjectOwnership ?? "")).filter(Boolean) ?? [],
      lifecycleRules: lifecycle?.Rules?.map((rule) => {
        const raw = rule as unknown as {
          Status?: string;
          Prefix?: string;
          Filter?: { Prefix?: string; And?: { Prefix?: string } };
          Expiration?: { Days?: number };
        };
        return {
          status: raw.Status,
          prefix: normalizePrefix(raw.Prefix ?? raw.Filter?.Prefix ?? raw.Filter?.And?.Prefix ?? ""),
          expirationDays: raw.Expiration?.Days,
        };
      }) ?? [],
    };
  };
}

function liveKmsInspector(region: string): InspectProductionStorageKmsKey {
  const client = new KMSClient({ region });
  return async (keyId: string) => {
    const metadata = (await client.send(new DescribeKeyCommand({ KeyId: keyId }))).KeyMetadata;
    return {
      keyId: metadata?.KeyId,
      arn: metadata?.Arn,
      enabled: metadata?.Enabled,
      keyState: metadata?.KeyState,
      keyUsage: metadata?.KeyUsage,
      keySpec: metadata?.KeySpec,
      keyManager: metadata?.KeyManager,
    };
  };
}

async function optionalS3Control<T>(operation: () => Promise<T>, missingNames: string[]): Promise<T | undefined> {
  try {
    return await operation();
  } catch (error) {
    const name = error && typeof error === "object" && "name" in error ? String((error as { name?: unknown }).name ?? "") : "";
    if (missingNames.includes(name)) return undefined;
    throw error;
  }
}

function kmsReferenceMatches(candidate: string, configured: string, inspection: ObjectStorageKmsInspection): boolean {
  const values = [configured, inspection.keyId, inspection.arn].map((value) => value?.trim()).filter((value): value is string => Boolean(value));
  if (values.includes(candidate)) return true;
  const candidateKeyId = kmsKeyIdFromArn(candidate);
  if (candidateKeyId && values.includes(candidateKeyId)) return true;
  const inspectedKeyId = inspection.keyId?.trim();
  return Boolean(inspectedKeyId && kmsKeyIdFromArn(configured) === inspectedKeyId && kmsKeyIdFromArn(candidate) === inspectedKeyId);
}

function prefixCovers(rulePrefix: string, targetPrefix: string): boolean {
  const rule = normalizePrefix(rulePrefix);
  const target = normalizePrefix(targetPrefix);
  return !rule || target === rule || target.startsWith(`${rule}/`);
}

function normalizePrefix(value: string): string {
  return value.trim().replace(/^\/+|\/+$/g, "");
}

function normalizeS3Region(value: unknown): string {
  if (value === undefined || value === null || value === "") return "us-east-1";
  if (value === "EU") return "eu-west-1";
  return String(value);
}

function parseKmsArnRegion(value: string): string | null {
  return /^arn:[^:]+:kms:([^:]+):[0-9]{12}:key\/.+$/.exec(value)?.[1] ?? null;
}

function kmsKeyIdFromArn(value: string): string | null {
  return /^arn:[^:]+:kms:[^:]+:[0-9]{12}:key\/(.+)$/.exec(value)?.[1] ?? null;
}

function parsePositiveInteger(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer.`);
  return parsed;
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for production object-storage preflight.`);
  return value;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}
