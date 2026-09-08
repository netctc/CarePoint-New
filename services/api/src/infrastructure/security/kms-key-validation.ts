import type { DescribeKeyCommandOutput } from "@aws-sdk/client-kms";

export type KmsKeyKind = "encryption" | "hmac-sha256";

export interface KmsKeyExpectation {
  kind: KmsKeyKind;
  region?: string;
  accountId?: string;
}

export interface ValidatedKmsKey {
  keyId: string;
  arn: string;
  region: string;
  accountId: string;
  keySpec: string;
  keyUsage: string;
  keyManager: string;
}

export function assertProductionKmsEndpoint(environment: string | undefined, endpoint: string | undefined): void {
  if (environment === "production" && endpoint?.trim()) {
    throw new Error("AWS_ENDPOINT_URL_KMS is development/test-only and is forbidden in production.");
  }
}

export function validateKmsKeyMetadata(
  metadata: DescribeKeyCommandOutput["KeyMetadata"],
  expectation: KmsKeyExpectation,
): ValidatedKmsKey {
  if (!metadata) throw new Error("AWS KMS DescribeKey did not return key metadata.");
  if (!metadata.KeyId?.trim() || !metadata.Arn?.trim()) throw new Error("AWS KMS key metadata is missing KeyId or Arn.");
  if (metadata.Enabled !== true || metadata.KeyState !== "Enabled") {
    throw new Error(`AWS KMS key '${metadata.Arn}' must be Enabled (state=${metadata.KeyState ?? "unknown"}).`);
  }
  if (metadata.KeyManager !== "CUSTOMER") {
    throw new Error(`AWS KMS key '${metadata.Arn}' must be customer-managed.`);
  }

  if (expectation.kind === "encryption") {
    if (metadata.KeyUsage !== "ENCRYPT_DECRYPT") {
      throw new Error(`AWS KMS key '${metadata.Arn}' must use ENCRYPT_DECRYPT.`);
    }
    if (metadata.KeySpec !== "SYMMETRIC_DEFAULT") {
      throw new Error(`AWS KMS key '${metadata.Arn}' must use SYMMETRIC_DEFAULT.`);
    }
  } else {
    if (metadata.KeyUsage !== "GENERATE_VERIFY_MAC") {
      throw new Error(`AWS KMS HMAC key '${metadata.Arn}' must use GENERATE_VERIFY_MAC.`);
    }
    if (metadata.KeySpec !== "HMAC_256") {
      throw new Error(`AWS KMS HMAC key '${metadata.Arn}' must use HMAC_256 for HMAC_SHA_256.`);
    }
    if (!metadata.MacAlgorithms?.includes("HMAC_SHA_256")) {
      throw new Error(`AWS KMS HMAC key '${metadata.Arn}' does not support HMAC_SHA_256.`);
    }
  }

  const arn = parseKmsKeyArn(metadata.Arn);
  if (!arn) throw new Error(`AWS KMS returned an invalid key ARN '${metadata.Arn}'.`);
  if (expectation.region?.trim() && arn.region !== expectation.region.trim()) {
    throw new Error(`AWS KMS key region '${arn.region}' does not match configured AWS_REGION '${expectation.region.trim()}'.`);
  }
  if (expectation.accountId?.trim() && arn.accountId !== expectation.accountId.trim()) {
    throw new Error(`AWS KMS key account '${arn.accountId}' does not match configured AWS_KMS_ACCOUNT_ID '${expectation.accountId.trim()}'.`);
  }

  return {
    keyId: metadata.KeyId,
    arn: metadata.Arn,
    region: arn.region,
    accountId: arn.accountId,
    keySpec: metadata.KeySpec,
    keyUsage: metadata.KeyUsage,
    keyManager: metadata.KeyManager,
  };
}

export function kmsKeyMatches(value: string | undefined | null, configuredKeyId: string, validated: ValidatedKmsKey): boolean {
  const candidate = value?.trim();
  if (!candidate) return false;
  return candidate === configuredKeyId.trim() || candidate === validated.keyId || candidate === validated.arn;
}

function parseKmsKeyArn(value: string): { region: string; accountId: string } | null {
  const match = /^arn:[^:]+:kms:([^:]+):([0-9]{12}):key\/.+$/.exec(value.trim());
  return match ? { region: match[1], accountId: match[2] } : null;
}
