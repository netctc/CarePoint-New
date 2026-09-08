import { DescribeKeyCommand, KMSClient, type KeyMetadata } from "@aws-sdk/client-kms";

type KeyRequirement = {
  domain: string;
  providerEnv: string;
  expectedProvider: string;
  keyEnv: string;
  keyUsage: "ENCRYPT_DECRYPT" | "GENERATE_VERIFY_MAC";
  keySpec: "SYMMETRIC_DEFAULT" | "HMAC_256";
};

type ParsedKmsArn = { region: string; accountId: string };

export type DescribeProductionKmsKey = (keyId: string) => Promise<KeyMetadata | undefined>;

export interface ProductionKmsPreflightOptions {
  describeKey?: DescribeProductionKmsKey;
}

const REQUIREMENTS: KeyRequirement[] = [
  { domain: "MFA secrets", providerEnv: "MFA_KEY_PROVIDER", expectedProvider: "aws-kms", keyEnv: "MFA_KMS_KEY_ID", keyUsage: "ENCRYPT_DECRYPT", keySpec: "SYMMETRIC_DEFAULT" },
  { domain: "clinical records", providerEnv: "CLINICAL_KEY_PROVIDER", expectedProvider: "aws-kms", keyEnv: "CLINICAL_KMS_KEY_ID", keyUsage: "ENCRYPT_DECRYPT", keySpec: "SYMMETRIC_DEFAULT" },
  { domain: "clinical orders/results", providerEnv: "ORDER_KEY_PROVIDER", expectedProvider: "aws-kms", keyEnv: "ORDER_KMS_KEY_ID", keyUsage: "ENCRYPT_DECRYPT", keySpec: "SYMMETRIC_DEFAULT" },
  { domain: "clinical order attestation", providerEnv: "ORDER_SIGNING_PROVIDER", expectedProvider: "aws-kms-hmac", keyEnv: "ORDER_SIGNING_KMS_KEY_ID", keyUsage: "GENERATE_VERIFY_MAC", keySpec: "HMAC_256" },
  { domain: "clinical documents", providerEnv: "DOCUMENT_KEY_PROVIDER", expectedProvider: "aws-kms", keyEnv: "DOCUMENT_KMS_KEY_ID", keyUsage: "ENCRYPT_DECRYPT", keySpec: "SYMMETRIC_DEFAULT" },
  { domain: "clinical document attestation", providerEnv: "DOCUMENT_SIGNING_PROVIDER", expectedProvider: "aws-kms-hmac", keyEnv: "DOCUMENT_SIGNING_KMS_KEY_ID", keyUsage: "GENERATE_VERIFY_MAC", keySpec: "HMAC_256" },
  { domain: "secure messaging", providerEnv: "MESSAGING_KEY_PROVIDER", expectedProvider: "aws-kms", keyEnv: "MESSAGING_KMS_KEY_ID", keyUsage: "ENCRYPT_DECRYPT", keySpec: "SYMMETRIC_DEFAULT" },
  { domain: "telehealth session keys", providerEnv: "TELEHEALTH_KEY_PROVIDER", expectedProvider: "aws-kms", keyEnv: "TELEHEALTH_KMS_KEY_ID", keyUsage: "ENCRYPT_DECRYPT", keySpec: "SYMMETRIC_DEFAULT" },
];

export async function assertProductionKmsReady(options: ProductionKmsPreflightOptions = {}): Promise<void> {
  if (process.env.NODE_ENV !== "production") return;

  const region = required("AWS_REGION");
  const accountId = process.env.AWS_KMS_ACCOUNT_ID?.trim();
  if (accountId && !/^\d{12}$/.test(accountId)) throw new Error("AWS_KMS_ACCOUNT_ID must contain exactly 12 digits when configured.");
  if (process.env.AWS_ENDPOINT_URL_KMS?.trim()) throw new Error("AWS_ENDPOINT_URL_KMS is development/test-only and is forbidden in production.");

  const describeKey = options.describeKey ?? liveDescribeKey(region);

  for (const requirement of REQUIREMENTS) {
    const configuredProvider = (process.env[requirement.providerEnv] ?? requirement.expectedProvider).trim();
    if (configuredProvider !== requirement.expectedProvider) {
      throw new Error(`${requirement.providerEnv} must be '${requirement.expectedProvider}' in production (${requirement.domain}).`);
    }

    const keyId = required(requirement.keyEnv);
    let metadata: KeyMetadata | undefined;
    try {
      metadata = await describeKey(keyId);
    } catch (error) {
      throw new Error(`Production KMS preflight could not describe ${requirement.keyEnv} for ${requirement.domain}: ${errorMessage(error)}`);
    }

    validateMetadata(requirement, metadata, region, accountId);
  }
}

function validateMetadata(requirement: KeyRequirement, metadata: KeyMetadata | undefined, region: string, accountId?: string): void {
  if (!metadata) throw new Error(`Production KMS preflight returned no metadata for ${requirement.keyEnv} (${requirement.domain}).`);
  if (!metadata.KeyId?.trim() || !metadata.Arn?.trim()) {
    throw new Error(`${requirement.keyEnv} metadata must include KeyId and Arn (${requirement.domain}).`);
  }
  if (metadata.Enabled !== true) throw new Error(`${requirement.keyEnv} is not enabled (${requirement.domain}).`);
  if (metadata.KeyState !== "Enabled") throw new Error(`${requirement.keyEnv} must be in Enabled state, got '${metadata.KeyState ?? "unknown"}' (${requirement.domain}).`);
  if (metadata.KeyManager !== "CUSTOMER") {
    throw new Error(`${requirement.keyEnv} must be a customer-managed KMS key, got '${metadata.KeyManager ?? "unknown"}' (${requirement.domain}).`);
  }
  if (metadata.KeyUsage !== requirement.keyUsage) {
    throw new Error(`${requirement.keyEnv} must use ${requirement.keyUsage}, got '${metadata.KeyUsage ?? "unknown"}' (${requirement.domain}).`);
  }
  if (metadata.KeySpec !== requirement.keySpec) {
    throw new Error(`${requirement.keyEnv} must use ${requirement.keySpec}, got '${metadata.KeySpec ?? "unknown"}' (${requirement.domain}).`);
  }
  if (requirement.keyUsage === "GENERATE_VERIFY_MAC" && !metadata.MacAlgorithms?.includes("HMAC_SHA_256")) {
    throw new Error(`${requirement.keyEnv} must support HMAC_SHA_256 (${requirement.domain}).`);
  }

  const arn = parseKmsKeyArn(metadata.Arn);
  if (!arn) throw new Error(`${requirement.keyEnv} returned an invalid KMS key ARN (${requirement.domain}).`);
  if (arn.region !== region) {
    throw new Error(`${requirement.keyEnv} region '${arn.region}' does not match AWS_REGION '${region}' (${requirement.domain}).`);
  }
  if (accountId && arn.accountId !== accountId) {
    throw new Error(`${requirement.keyEnv} account '${arn.accountId}' does not match AWS_KMS_ACCOUNT_ID '${accountId}' (${requirement.domain}).`);
  }
}

function liveDescribeKey(region: string): DescribeProductionKmsKey {
  const client = new KMSClient({ region });
  return async (keyId: string) => (await client.send(new DescribeKeyCommand({ KeyId: keyId }))).KeyMetadata;
}

function parseKmsKeyArn(value: string): ParsedKmsArn | null {
  const match = /^arn:[^:]+:kms:([^:]+):(\d{12}):key\/.+$/.exec(value.trim());
  if (!match?.[1] || !match[2]) return null;
  return { region: match[1], accountId: match[2] };
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for production KMS preflight.`);
  return value;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}
