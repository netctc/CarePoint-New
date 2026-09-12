import { Injectable, InternalServerErrorException } from "@nestjs/common";
import { PhiEnvelopeEncryption, StaticAesKwKeyProvider, type EncryptedEnvelope, type KeyEncryptionKeyProvider } from "@carepoint/security";
import { AwsKmsKeyProvider } from "./aws-kms-key-provider";

@Injectable()
export class MfaEnvelopeService {
  private cached?: PhiEnvelopeEncryption;

  private encryption(): PhiEnvelopeEncryption {
    if (!this.cached) this.cached = new PhiEnvelopeEncryption(this.keyProvider());
    return this.cached;
  }

  private keyProvider(): KeyEncryptionKeyProvider {
    const provider = process.env.MFA_KEY_PROVIDER ?? (process.env.NODE_ENV === "production" ? "aws-kms" : "local");
    if (provider === "aws-kms") {
      const keyId = process.env.MFA_KMS_KEY_ID;
      if (!keyId) throw new InternalServerErrorException("MFA_KMS_KEY_ID is required for AWS KMS MFA encryption.");
      return new AwsKmsKeyProvider(keyId, "carepoint-mfa-secret-dek", process.env.AWS_REGION, process.env.AWS_ENDPOINT_URL_KMS);
    }
    if (provider !== "local") throw new InternalServerErrorException(`Unsupported MFA key provider '${provider}'.`);
    if (process.env.NODE_ENV === "production") throw new InternalServerErrorException("Local MFA envelope keys are forbidden in production.");

    const encoded = process.env.MFA_ENVELOPE_KEY_BASE64;
    const keyId = process.env.MFA_ENVELOPE_KEY_ID ?? "local-mfa-kek-v1";
    if (!encoded) throw new InternalServerErrorException("MFA envelope encryption is not configured.");

    const bytes = Uint8Array.from(Buffer.from(encoded, "base64"));
    if (bytes.byteLength !== 32) throw new InternalServerErrorException("MFA_ENVELOPE_KEY_BASE64 must decode to exactly 32 bytes.");
    return new StaticAesKwKeyProvider(keyId, bytes);
  }

  async encryptSecret(secret: string): Promise<EncryptedEnvelope> {
    return this.encryption().encryptJson({ secret });
  }

  async decryptSecret(envelope: EncryptedEnvelope): Promise<string> {
    const value = await this.encryption().decryptJson<{ secret: string }>(envelope);
    if (!value.secret) throw new InternalServerErrorException("Encrypted MFA secret is invalid.");
    return value.secret;
  }
}
