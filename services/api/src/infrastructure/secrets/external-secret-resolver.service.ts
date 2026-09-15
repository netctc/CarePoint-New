import { Injectable } from "@nestjs/common";
import { DecryptCommand, KMSClient } from "@aws-sdk/client-kms";
import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import { isAbsolute } from "node:path";

export const EXTERNAL_SECRET_NAMES = [
  "payment-gateway-api-key",
  "insurance-gateway-api-key",
  "claims-gateway-api-key",
  "notification-gateway-api-key",
  "siem-export-api-key",
  "livekit-api-key",
  "livekit-api-secret",
] as const;

export type ExternalSecretName = (typeof EXTERNAL_SECRET_NAMES)[number];

type ExternalSecretDefinition = {
  name: ExternalSecretName;
  fileEnv: string;
  legacyEnv: string;
};

export const EXTERNAL_SECRET_DEFINITIONS: readonly ExternalSecretDefinition[] = [
  { name: "payment-gateway-api-key", fileEnv: "PAYMENT_GATEWAY_API_KEY_KMS_FILE", legacyEnv: "PAYMENT_GATEWAY_API_KEY" },
  { name: "insurance-gateway-api-key", fileEnv: "INSURANCE_GATEWAY_API_KEY_KMS_FILE", legacyEnv: "INSURANCE_GATEWAY_API_KEY" },
  { name: "claims-gateway-api-key", fileEnv: "CLAIMS_GATEWAY_API_KEY_KMS_FILE", legacyEnv: "CLAIMS_GATEWAY_API_KEY" },
  { name: "notification-gateway-api-key", fileEnv: "NOTIFICATION_GATEWAY_API_KEY_KMS_FILE", legacyEnv: "NOTIFICATION_GATEWAY_API_KEY" },
  { name: "siem-export-api-key", fileEnv: "SIEM_EXPORT_API_KEY_KMS_FILE", legacyEnv: "SIEM_EXPORT_API_KEY" },
  { name: "livekit-api-key", fileEnv: "LIVEKIT_API_KEY_KMS_FILE", legacyEnv: "LIVEKIT_API_KEY" },
  { name: "livekit-api-secret", fileEnv: "LIVEKIT_API_SECRET_KMS_FILE", legacyEnv: "LIVEKIT_API_SECRET" },
] as const;

const MAX_CIPHERTEXT_FILE_BYTES = 16 * 1024;
const MAX_PLAINTEXT_SECRET_BYTES = 4096;
const ENCRYPTION_CONTEXT_PURPOSE = "carepoint-external-secret";

type CachedSecret = { ciphertextDigest: string; value: string };

function definition(name: ExternalSecretName): ExternalSecretDefinition {
  const value = EXTERNAL_SECRET_DEFINITIONS.find((candidate) => candidate.name === name);
  if (!value) throw new Error(`Unsupported external secret '${name}'.`);
  return value;
}

export function createExternalSecretsKmsClient(env: NodeJS.ProcessEnv = process.env): KMSClient {
  const endpoint = env.EXTERNAL_SECRET_KMS_ENDPOINT?.trim();
  if (env.NODE_ENV === "production" && endpoint) {
    throw new Error("EXTERNAL_SECRET_KMS_ENDPOINT is forbidden in production.");
  }
  const region = env.EXTERNAL_SECRET_KMS_REGION?.trim() || env.AWS_REGION?.trim() || env.AWS_DEFAULT_REGION?.trim();
  return new KMSClient({
    ...(region ? { region } : {}),
    ...(endpoint ? { endpoint } : {}),
  });
}

export async function resolveExternalSecret(
  name: ExternalSecretName,
  env: NodeJS.ProcessEnv,
  client: KMSClient,
  cache: Map<ExternalSecretName, CachedSecret>,
): Promise<string> {
  const config = definition(name);
  const legacy = env[config.legacyEnv]?.trim();
  const encryptedFile = env[config.fileEnv]?.trim();
  const keyId = env.EXTERNAL_SECRET_KMS_KEY_ID?.trim();

  if (env.NODE_ENV === "production") {
    if (legacy) throw new Error(`${config.legacyEnv} plaintext environment configuration is forbidden in production.`);
    if (!encryptedFile) throw new Error(`${config.fileEnv} is required in production.`);
    if (!keyId) throw new Error("EXTERNAL_SECRET_KMS_KEY_ID is required in production.");
  } else if (!encryptedFile) {
    if (!legacy) throw new Error(`${config.legacyEnv} or ${config.fileEnv} is required.`);
    validatePlaintextSecret(legacy);
    return legacy;
  }

  if (!encryptedFile) throw new Error(`${config.fileEnv} is required.`);
  if (!isAbsolute(encryptedFile)) throw new Error(`${config.fileEnv} must be an absolute path.`);

  const handle = await open(encryptedFile, "r");
  let raw: string;
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile()) throw new Error(`${config.fileEnv} must point to a regular file.`);
    if ((metadata.mode & 0o022) !== 0) throw new Error(`${config.fileEnv} must not be group/world writable.`);
    if (metadata.size < 1 || metadata.size > MAX_CIPHERTEXT_FILE_BYTES) {
      throw new Error(`${config.fileEnv} has an invalid size.`);
    }
    raw = (await handle.readFile("utf8")).trim();
  } finally {
    await handle.close();
  }

  const ciphertext = decodeCanonicalBase64(raw, config.fileEnv);
  const ciphertextDigest = createHash("sha256").update(ciphertext).digest("hex");
  const cached = cache.get(name);
  if (cached?.ciphertextDigest === ciphertextDigest) return cached.value;

  const result = await client.send(new DecryptCommand({
    ...(keyId ? { KeyId: keyId } : {}),
    CiphertextBlob: ciphertext,
    EncryptionAlgorithm: "SYMMETRIC_DEFAULT",
    EncryptionContext: {
      purpose: ENCRYPTION_CONTEXT_PURPOSE,
      secret: name,
    },
  }));
  if (!result.Plaintext) throw new Error(`AWS KMS did not return plaintext for external secret '${name}'.`);

  const plaintextBytes = Buffer.from(result.Plaintext);
  try {
    if (plaintextBytes.byteLength < 1 || plaintextBytes.byteLength > MAX_PLAINTEXT_SECRET_BYTES) {
      throw new Error(`External secret '${name}' has an invalid plaintext size.`);
    }
    const value = plaintextBytes.toString("utf8");
    validatePlaintextSecret(value);
    cache.set(name, { ciphertextDigest, value });
    return value;
  } finally {
    plaintextBytes.fill(0);
  }
}

function decodeCanonicalBase64(value: string, label: string): Buffer {
  if (!value || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new Error(`${label} must contain canonical base64 KMS ciphertext.`);
  }
  const decoded = Buffer.from(value, "base64");
  if (!decoded.byteLength || decoded.toString("base64") !== value) {
    throw new Error(`${label} must contain canonical base64 KMS ciphertext.`);
  }
  return decoded;
}

function validatePlaintextSecret(value: string): void {
  if (!value || Buffer.byteLength(value, "utf8") > MAX_PLAINTEXT_SECRET_BYTES || /[\r\n\0]/.test(value)) {
    throw new Error("External secret plaintext is invalid.");
  }
}

@Injectable()
export class ExternalSecretResolverService {
  private readonly client = createExternalSecretsKmsClient();
  private readonly cache = new Map<ExternalSecretName, CachedSecret>();

  async resolve(name: ExternalSecretName): Promise<string> {
    return resolveExternalSecret(name, process.env, this.client, this.cache);
  }
}
