import {
  DescribeKeyCommand,
  GetKeyRotationStatusCommand,
  KMSClient,
  ListAliasesCommand,
} from "@aws-sdk/client-kms";
import { PRODUCTION_KMS_REQUIREMENTS } from "./production-kms-preflight";

const DEFAULT_ALIAS_PREFIX = "alias/carepoint/";
const DEFAULT_MAX_ROTATION_DAYS = 365;
const DEFAULT_HMAC_MAX_KEY_AGE_DAYS = 365;
const DAY_MS = 86_400_000;

export interface ResolvedKmsAlias {
  targetKeyId?: string;
  lastUpdatedDate?: Date;
}

export interface KmsRotationStatus {
  keyRotationEnabled?: boolean;
  rotationPeriodInDays?: number;
}

export interface KmsTargetKeyMetadata {
  creationDate?: Date;
}

export type ResolveProductionKmsAlias = (aliasName: string) => Promise<ResolvedKmsAlias | undefined>;
export type GetProductionKmsRotationStatus = (targetKeyId: string) => Promise<KmsRotationStatus | undefined>;
export type DescribeProductionKmsRotationTarget = (targetKeyId: string) => Promise<KmsTargetKeyMetadata | undefined>;

export interface ProductionKmsRotationPreflightOptions {
  resolveAlias?: ResolveProductionKmsAlias;
  getRotationStatus?: GetProductionKmsRotationStatus;
  describeTargetKey?: DescribeProductionKmsRotationTarget;
  now?: Date;
}

export async function assertProductionKmsRotationReady(options: ProductionKmsRotationPreflightOptions = {}): Promise<void> {
  if (process.env.NODE_ENV !== "production") return;

  const region = required("AWS_REGION");
  if (process.env.AWS_ENDPOINT_URL_KMS?.trim()) {
    throw new Error("AWS_ENDPOINT_URL_KMS is development/test-only and is forbidden in production KMS rotation preflight.");
  }

  const aliasPrefix = rotationAliasPrefix();
  const maxRotationDays = integerEnv(
    "AWS_KMS_MAX_ROTATION_DAYS",
    DEFAULT_MAX_ROTATION_DAYS,
    90,
    365,
  );
  const hmacMaxKeyAgeDays = integerEnv(
    "AWS_KMS_HMAC_MAX_KEY_AGE_DAYS",
    DEFAULT_HMAC_MAX_KEY_AGE_DAYS,
    1,
    365,
  );
  const now = options.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new Error("C8 KMS rotation preflight received an invalid current time.");

  const resolveAlias = options.resolveAlias ?? liveResolveAlias(region);
  const getRotationStatus = options.getRotationStatus ?? liveGetRotationStatus(region);
  const describeTargetKey = options.describeTargetKey ?? liveDescribeTargetKey(region);

  for (const requirement of PRODUCTION_KMS_REQUIREMENTS) {
    const aliasName = required(requirement.keyEnv);
    validateAliasReference(requirement.keyEnv, aliasName, aliasPrefix);

    let resolved: ResolvedKmsAlias | undefined;
    try {
      resolved = await resolveAlias(aliasName);
    } catch (error) {
      throw new Error(`C8 KMS rotation preflight could not resolve ${requirement.keyEnv}: ${errorName(error)}`);
    }
    const targetKeyId = resolved?.targetKeyId?.trim();
    if (!targetKeyId) {
      throw new Error(`${requirement.keyEnv} must resolve to an enabled customer-managed KMS key through '${aliasPrefix}'.`);
    }

    if (requirement.keyUsage === "ENCRYPT_DECRYPT") {
      let status: KmsRotationStatus | undefined;
      try {
        status = await getRotationStatus(targetKeyId);
      } catch (error) {
        throw new Error(`C8 KMS rotation preflight could not read automatic rotation status for ${requirement.keyEnv}: ${errorName(error)}`);
      }
      if (status?.keyRotationEnabled !== true) {
        throw new Error(`${requirement.keyEnv} must have automatic KMS key rotation enabled.`);
      }
      const period = status.rotationPeriodInDays ?? DEFAULT_MAX_ROTATION_DAYS;
      if (!Number.isInteger(period) || period < 90) {
        throw new Error(`${requirement.keyEnv} returned an invalid KMS rotation period.`);
      }
      if (period > maxRotationDays) {
        throw new Error(`${requirement.keyEnv} rotation period exceeds AWS_KMS_MAX_ROTATION_DAYS (${maxRotationDays}).`);
      }
      continue;
    }

    let metadata: KmsTargetKeyMetadata | undefined;
    try {
      metadata = await describeTargetKey(targetKeyId);
    } catch (error) {
      throw new Error(`C8 KMS rotation preflight could not inspect HMAC rollover target for ${requirement.keyEnv}: ${errorName(error)}`);
    }
    const creationDate = metadata?.creationDate;
    if (!creationDate || !Number.isFinite(creationDate.getTime())) {
      throw new Error(`${requirement.keyEnv} HMAC rollover target must expose a valid KMS creation date.`);
    }
    const ageMs = now.getTime() - creationDate.getTime();
    if (ageMs < 0) throw new Error(`${requirement.keyEnv} HMAC rollover target has a creation date in the future.`);
    const ageDays = ageMs / DAY_MS;
    if (ageDays > hmacMaxKeyAgeDays) {
      throw new Error(`${requirement.keyEnv} HMAC rollover target exceeds AWS_KMS_HMAC_MAX_KEY_AGE_DAYS (${hmacMaxKeyAgeDays}).`);
    }
  }
}

function rotationAliasPrefix(): string {
  const value = process.env.AWS_KMS_ALIAS_PREFIX?.trim() || DEFAULT_ALIAS_PREFIX;
  if (!value.startsWith("alias/") || !value.endsWith("/") || value.startsWith("alias/aws/")) {
    throw new Error("AWS_KMS_ALIAS_PREFIX must be a customer-managed KMS alias prefix ending in '/'.");
  }
  if (!/^alias\/[A-Za-z0-9/_-]+\/$/.test(value)) {
    throw new Error("AWS_KMS_ALIAS_PREFIX contains unsupported KMS alias characters.");
  }
  return value;
}

function validateAliasReference(envName: string, value: string, prefix: string): void {
  if (!/^alias\/[A-Za-z0-9/_-]+$/.test(value)) {
    throw new Error(`${envName} must use a KMS alias, not a raw key id or ARN.`);
  }
  if (!value.startsWith(prefix)) {
    throw new Error(`${envName} must use the configured AWS_KMS_ALIAS_PREFIX '${prefix}'.`);
  }
  if (value.startsWith("alias/aws/")) {
    throw new Error(`${envName} must use a customer-managed KMS alias.`);
  }
}

function liveResolveAlias(region: string): ResolveProductionKmsAlias {
  const client = new KMSClient({ region });
  return async (aliasName: string) => {
    let marker: string | undefined;
    do {
      const result = await client.send(new ListAliasesCommand({
        Limit: 100,
        ...(marker ? { Marker: marker } : {}),
      }));
      const match = result.Aliases?.find((item) => item.AliasName === aliasName);
      if (match) {
        return {
          ...(match.TargetKeyId ? { targetKeyId: match.TargetKeyId } : {}),
          ...(match.LastUpdatedDate ? { lastUpdatedDate: match.LastUpdatedDate } : {}),
        };
      }
      marker = result.Truncated === true ? result.NextMarker : undefined;
    } while (marker);
    return undefined;
  };
}

function liveGetRotationStatus(region: string): GetProductionKmsRotationStatus {
  const client = new KMSClient({ region });
  return async (targetKeyId: string) => {
    const result = await client.send(new GetKeyRotationStatusCommand({ KeyId: targetKeyId }));
    return {
      ...(typeof result.KeyRotationEnabled === "boolean" ? { keyRotationEnabled: result.KeyRotationEnabled } : {}),
      ...(typeof result.RotationPeriodInDays === "number" ? { rotationPeriodInDays: result.RotationPeriodInDays } : {}),
    };
  };
}

function liveDescribeTargetKey(region: string): DescribeProductionKmsRotationTarget {
  const client = new KMSClient({ region });
  return async (targetKeyId: string) => {
    const metadata = (await client.send(new DescribeKeyCommand({ KeyId: targetKeyId }))).KeyMetadata;
    if (!metadata) return undefined;
    return {
      ...(metadata.CreationDate ? { creationDate: metadata.CreationDate } : {}),
    };
  };
}

function integerEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  if (!/^\d+$/.test(raw)) throw new Error(`${name} must be an integer.`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be between ${min} and ${max}.`);
  }
  return value;
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for production KMS rotation preflight.`);
  return value;
}

function errorName(error: unknown): string {
  if (error instanceof Error && error.name) return error.name.replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 80) || "KmsError";
  return "KmsError";
}
