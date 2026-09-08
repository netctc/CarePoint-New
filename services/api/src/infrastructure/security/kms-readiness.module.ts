import { Injectable, Module, OnApplicationBootstrap } from "@nestjs/common";
import { AwsKmsHmacProvider } from "./aws-kms-hmac-provider";
import { AwsKmsKeyProvider } from "./aws-kms-key-provider";
import { assertProductionKmsEndpoint, type KmsKeyKind } from "./kms-key-validation";

export interface ProductionKmsRequirement {
  label: string;
  kind: KmsKeyKind;
  keyId: string;
}

const ENVELOPE_REQUIREMENTS = [
  ["MFA", "MFA_KEY_PROVIDER", "MFA_KMS_KEY_ID"],
  ["clinical PHI", "CLINICAL_KEY_PROVIDER", "CLINICAL_KMS_KEY_ID"],
  ["clinical orders", "ORDER_KEY_PROVIDER", "ORDER_KMS_KEY_ID"],
  ["clinical documents", "DOCUMENT_KEY_PROVIDER", "DOCUMENT_KMS_KEY_ID"],
  ["secure messaging", "MESSAGING_KEY_PROVIDER", "MESSAGING_KMS_KEY_ID"],
  ["telehealth session keys", "TELEHEALTH_KEY_PROVIDER", "TELEHEALTH_KMS_KEY_ID"],
] as const;

// Order attestation remains on its legacy synchronous local adapter until C1.1.
// Only KMS-backed signing paths that are actually wired in this runtime belong
// in the startup readiness set.
const HMAC_REQUIREMENTS = [
  ["clinical document attestation", "DOCUMENT_SIGNING_PROVIDER", "DOCUMENT_SIGNING_KMS_KEY_ID"],
] as const;

export function productionKmsRequirements(env: NodeJS.ProcessEnv): ProductionKmsRequirement[] {
  if (env.NODE_ENV !== "production") return [];
  assertProductionKmsEndpoint(env.NODE_ENV, env.AWS_ENDPOINT_URL_KMS);
  if (!env.AWS_REGION?.trim()) throw new Error("AWS_REGION is required for production KMS validation.");

  const requirements: ProductionKmsRequirement[] = [];
  for (const [label, providerEnv, keyEnv] of ENVELOPE_REQUIREMENTS) {
    const provider = env[providerEnv]?.trim() || "aws-kms";
    if (provider !== "aws-kms") throw new Error(`${providerEnv} must be 'aws-kms' in production.`);
    requirements.push({ label, kind: "encryption", keyId: required(env, keyEnv) });
  }
  for (const [label, providerEnv, keyEnv] of HMAC_REQUIREMENTS) {
    const provider = env[providerEnv]?.trim() || "aws-kms-hmac";
    if (provider !== "aws-kms-hmac") throw new Error(`${providerEnv} must be 'aws-kms-hmac' in production.`);
    requirements.push({ label, kind: "hmac-sha256", keyId: required(env, keyEnv) });
  }
  return requirements;
}

@Injectable()
export class KmsReadinessService implements OnApplicationBootstrap {
  async onApplicationBootstrap(): Promise<void> {
    const requirements = productionKmsRequirements(process.env);
    if (requirements.length === 0) return;
    const region = process.env.AWS_REGION?.trim();
    const unique = new Map<string, ProductionKmsRequirement>();
    for (const requirement of requirements) unique.set(`${requirement.kind}:${requirement.keyId}`, requirement);

    for (const requirement of unique.values()) {
      if (requirement.kind === "encryption") {
        await new AwsKmsKeyProvider(
          requirement.keyId,
          `carepoint-readiness-${slug(requirement.label)}`,
          region,
          undefined,
        ).validateReady();
      } else {
        await new AwsKmsHmacProvider(requirement.keyId, region).validateReady();
      }
    }
  }
}

@Module({ providers: [KmsReadinessService] })
export class KmsReadinessModule {}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required in production.`);
  return value;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
