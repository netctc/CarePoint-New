import { Injectable, InternalServerErrorException } from "@nestjs/common";
import { PhiEnvelopeEncryption, StaticAesKwKeyProvider, type EncryptedEnvelope, type KeyEncryptionKeyProvider } from "@carepoint/security";
import { AwsKmsKeyProvider } from "../../infrastructure/security/aws-kms-key-provider";

@Injectable()
export class OrdersEnvelopeService {
  private cached?: PhiEnvelopeEncryption;

  async encrypt(value: unknown): Promise<EncryptedEnvelope> {
    return this.encryption().encryptJson(value);
  }

  async decrypt<T>(envelope: EncryptedEnvelope): Promise<T> {
    return this.encryption().decryptJson<T>(envelope);
  }

  private encryption(): PhiEnvelopeEncryption {
    if (!this.cached) this.cached = new PhiEnvelopeEncryption(this.keyProvider());
    return this.cached;
  }

  private keyProvider(): KeyEncryptionKeyProvider {
    const provider = process.env.ORDER_KEY_PROVIDER ?? (process.env.NODE_ENV === "production" ? "aws-kms" : "local");
    if (provider === "aws-kms") {
      const keyId = process.env.ORDER_KMS_KEY_ID;
      if (!keyId) throw new InternalServerErrorException("ORDER_KMS_KEY_ID is required for AWS KMS clinical order encryption.");
      return new AwsKmsKeyProvider(keyId, "carepoint-clinical-order-dek", process.env.AWS_REGION, process.env.AWS_ENDPOINT_URL_KMS);
    }
    if (provider !== "local") throw new InternalServerErrorException(`Unsupported clinical order key provider '${provider}'.`);
    if (process.env.NODE_ENV === "production") throw new InternalServerErrorException("Local clinical order envelope keys are forbidden in production.");
    const encoded = process.env.ORDER_ENVELOPE_KEY_BASE64;
    const keyId = process.env.ORDER_ENVELOPE_KEY_ID ?? "local-orders-kek-v1";
    if (!encoded) throw new InternalServerErrorException("Clinical order envelope encryption is not configured.");
    const bytes = Uint8Array.from(Buffer.from(encoded, "base64"));
    if (bytes.byteLength !== 32) throw new InternalServerErrorException("ORDER_ENVELOPE_KEY_BASE64 must decode to exactly 32 bytes.");
    return new StaticAesKwKeyProvider(keyId, bytes);
  }
}
