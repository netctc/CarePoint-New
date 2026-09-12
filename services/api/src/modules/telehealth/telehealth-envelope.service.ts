import { Injectable, InternalServerErrorException } from "@nestjs/common";
import { PhiEnvelopeEncryption, StaticAesKwKeyProvider, type EncryptedEnvelope, type KeyEncryptionKeyProvider } from "@carepoint/security";
import { randomBytes } from "node:crypto";
import { AwsKmsKeyProvider } from "../../infrastructure/security/aws-kms-key-provider";

@Injectable()
export class TelehealthEnvelopeService {
  private cached?: PhiEnvelopeEncryption;

  async createSessionKey(): Promise<{ plaintext: string; envelope: EncryptedEnvelope }> {
    const plaintext = randomBytes(32).toString("base64url");
    const envelope = await this.encryption().encryptJson({ key: plaintext });
    return { plaintext, envelope };
  }

  async decryptSessionKey(envelope: EncryptedEnvelope): Promise<string> {
    const value = await this.encryption().decryptJson<{ key: string }>(envelope);
    if (!value.key) throw new InternalServerErrorException("Encrypted telehealth session key is invalid.");
    return value.key;
  }

  private encryption(): PhiEnvelopeEncryption {
    if (!this.cached) this.cached = new PhiEnvelopeEncryption(this.keyProvider());
    return this.cached;
  }

  private keyProvider(): KeyEncryptionKeyProvider {
    const provider = process.env.TELEHEALTH_KEY_PROVIDER ?? (process.env.NODE_ENV === "production" ? "aws-kms" : "local");
    if (provider === "aws-kms") {
      const keyId = process.env.TELEHEALTH_KMS_KEY_ID;
      if (!keyId) throw new InternalServerErrorException("TELEHEALTH_KMS_KEY_ID is required for AWS KMS telehealth key encryption.");
      return new AwsKmsKeyProvider(keyId, "carepoint-telehealth-session-key-dek", process.env.AWS_REGION, process.env.AWS_ENDPOINT_URL_KMS);
    }
    if (provider !== "local") throw new InternalServerErrorException(`Unsupported telehealth key provider '${provider}'.`);
    if (process.env.NODE_ENV === "production") throw new InternalServerErrorException("Local telehealth envelope keys are forbidden in production.");
    const encoded = process.env.TELEHEALTH_ENVELOPE_KEY_BASE64;
    const keyId = process.env.TELEHEALTH_ENVELOPE_KEY_ID ?? "local-telehealth-kek-v1";
    if (!encoded) throw new InternalServerErrorException("Telehealth envelope encryption is not configured.");
    const bytes = Uint8Array.from(Buffer.from(encoded, "base64"));
    if (bytes.byteLength !== 32) throw new InternalServerErrorException("TELEHEALTH_ENVELOPE_KEY_BASE64 must decode to exactly 32 bytes.");
    return new StaticAesKwKeyProvider(keyId, bytes);
  }
}
