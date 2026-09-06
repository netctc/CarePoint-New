import { Injectable, InternalServerErrorException } from "@nestjs/common";
import { PhiEnvelopeEncryption, StaticAesKwKeyProvider, type EncryptedEnvelope, type KeyEncryptionKeyProvider } from "@carepoint/security";
import { AwsKmsKeyProvider } from "./aws-kms-key-provider";

@Injectable()
export class DocumentsEnvelopeService {
  private cached?: PhiEnvelopeEncryption;

  async encryptMetadata(value: unknown): Promise<EncryptedEnvelope> { return this.encryption().encryptJson(value); }
  async decryptMetadata<T>(envelope: EncryptedEnvelope): Promise<T> { return this.encryption().decryptJson<T>(envelope); }

  async encryptBytes(bytes: Uint8Array): Promise<{ envelope: EncryptedEnvelope; ciphertext: string }> {
    const full = await this.encryption().encryptJson({ base64: Buffer.from(bytes).toString("base64") });
    return { envelope: full, ciphertext: full.ciphertext };
  }

  async decryptBytes(envelope: EncryptedEnvelope): Promise<Uint8Array> {
    const value = await this.encryption().decryptJson<{ base64?: unknown }>(envelope);
    if (typeof value.base64 !== "string") throw new InternalServerErrorException("Stored document payload is invalid.");
    return Uint8Array.from(Buffer.from(value.base64, "base64"));
  }

  private encryption(): PhiEnvelopeEncryption {
    if (!this.cached) this.cached = new PhiEnvelopeEncryption(this.keyProvider());
    return this.cached;
  }

  private keyProvider(): KeyEncryptionKeyProvider {
    const provider = process.env.DOCUMENT_KEY_PROVIDER ?? (process.env.NODE_ENV === "production" ? "aws-kms" : "local");
    if (provider === "aws-kms") {
      const keyId = process.env.DOCUMENT_KMS_KEY_ID;
      if (!keyId) throw new InternalServerErrorException("DOCUMENT_KMS_KEY_ID is required for AWS KMS document encryption.");
      return new AwsKmsKeyProvider(keyId, process.env.AWS_REGION, process.env.AWS_ENDPOINT_URL_KMS);
    }
    if (provider !== "local") throw new InternalServerErrorException(`Unsupported document key provider '${provider}'.`);
    if (process.env.NODE_ENV === "production") throw new InternalServerErrorException("Local document envelope keys are forbidden in production.");
    const encoded = process.env.DOCUMENT_ENVELOPE_KEY_BASE64;
    const keyId = process.env.DOCUMENT_ENVELOPE_KEY_ID ?? "local-document-kek-v1";
    if (!encoded) throw new InternalServerErrorException("Document envelope encryption is not configured.");
    const bytes = Uint8Array.from(Buffer.from(encoded, "base64"));
    if (bytes.byteLength !== 32) throw new InternalServerErrorException("DOCUMENT_ENVELOPE_KEY_BASE64 must decode to exactly 32 bytes.");
    return new StaticAesKwKeyProvider(keyId, bytes);
  }
}
