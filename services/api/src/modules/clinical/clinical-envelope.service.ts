import { Injectable, InternalServerErrorException } from "@nestjs/common";
import { PhiEnvelopeEncryption, StaticAesKwKeyProvider, type EncryptedEnvelope, type KeyEncryptionKeyProvider } from "@carepoint/security";
import { AwsKmsKeyProvider } from "../../infrastructure/security/aws-kms-key-provider";

@Injectable()
export class ClinicalEnvelopeService {
  private cached?: PhiEnvelopeEncryption;

  async encryptRecord(value: unknown): Promise<EncryptedEnvelope> {
    return this.encryption().encryptJson(value);
  }

  async decryptRecord<T>(envelope: EncryptedEnvelope): Promise<T> {
    return this.encryption().decryptJson<T>(envelope);
  }

  private encryption(): PhiEnvelopeEncryption {
    if (!this.cached) this.cached = new PhiEnvelopeEncryption(this.keyProvider());
    return this.cached;
  }

  private keyProvider(): KeyEncryptionKeyProvider {
    const provider = process.env.CLINICAL_KEY_PROVIDER ?? (process.env.NODE_ENV === "production" ? "aws-kms" : "local");
    if (provider === "aws-kms") {
      const keyId = process.env.CLINICAL_KMS_KEY_ID;
      if (!keyId) throw new InternalServerErrorException("CLINICAL_KMS_KEY_ID is required for AWS KMS clinical PHI encryption.");
      return new AwsKmsKeyProvider(keyId, "carepoint-clinical-record-dek", process.env.AWS_REGION, process.env.AWS_ENDPOINT_URL_KMS);
    }
    if (provider !== "local") throw new InternalServerErrorException(`Unsupported clinical key provider '${provider}'.`);
    if (process.env.NODE_ENV === "production") throw new InternalServerErrorException("Local clinical envelope keys are forbidden in production.");
    const encoded = process.env.CLINICAL_ENVELOPE_KEY_BASE64;
    const keyId = process.env.CLINICAL_ENVELOPE_KEY_ID ?? "local-clinical-kek-v1";
    if (!encoded) throw new InternalServerErrorException("Clinical envelope encryption is not configured.");
    const bytes = Uint8Array.from(Buffer.from(encoded, "base64"));
    if (bytes.byteLength !== 32) throw new InternalServerErrorException("CLINICAL_ENVELOPE_KEY_BASE64 must decode to exactly 32 bytes.");
    return new StaticAesKwKeyProvider(keyId, bytes);
  }
}
