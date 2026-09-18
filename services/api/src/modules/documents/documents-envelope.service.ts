import { Injectable, InternalServerErrorException } from "@nestjs/common";
import { PhiEnvelopeEncryption, StaticAesKwKeyProvider, type EncryptedEnvelope, type KeyEncryptionKeyProvider } from "@carepoint/security";
import { localSyntheticPilotProvidersAllowed } from "../../infrastructure/release/private-pilot-infrastructure-profile";
import { AwsKmsKeyProvider } from "../../infrastructure/security/aws-kms-key-provider";
import { GcpKmsKeyProvider } from "../../infrastructure/security/gcp-kms-key-provider";
import { OciKmsKeyProvider } from "../../infrastructure/security/oci-kms-key-provider";

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
    const cloudProvider = process.env.CAREPOINT_CLOUD_PROVIDER?.trim();
    const productionDefault = cloudProvider === "gcp"
      ? "gcp-cloud-kms"
      : cloudProvider === "oci"
        ? "oci-vault-kms"
        : "aws-kms";
    const provider = process.env.DOCUMENT_KEY_PROVIDER ?? (process.env.NODE_ENV === "production" ? productionDefault : "local");

    if (
      process.env.NODE_ENV === "production"
      && cloudProvider === "oci"
      && provider !== "oci-vault-kms"
    ) {
      throw new InternalServerErrorException("OCI production document encryption requires DOCUMENT_KEY_PROVIDER='oci-vault-kms'.");
    }
    if (
      process.env.NODE_ENV === "production"
      && cloudProvider === "gcp"
      && provider !== "gcp-cloud-kms"
    ) {
      throw new InternalServerErrorException("GCP production document encryption requires DOCUMENT_KEY_PROVIDER='gcp-cloud-kms'.");
    }

    if (provider === "gcp-cloud-kms") {
      const keyId = process.env.CAREPOINT_DOCUMENT_KEY_REF;
      if (!keyId) throw new InternalServerErrorException("CAREPOINT_DOCUMENT_KEY_REF is required for GCP Cloud KMS document encryption.");
      return new GcpKmsKeyProvider(keyId, "carepoint-clinical-document-dek", process.env);
    }
    if (provider === "oci-vault-kms") {
      const keyId = process.env.CAREPOINT_DOCUMENT_KEY_REF;
      if (!keyId) throw new InternalServerErrorException("CAREPOINT_DOCUMENT_KEY_REF is required for OCI Vault KMS document encryption.");
      return new OciKmsKeyProvider(keyId, "carepoint-clinical-document-dek", process.env);
    }
    if (provider === "aws-kms") {
      const keyId = process.env.DOCUMENT_KMS_KEY_ID;
      if (!keyId) throw new InternalServerErrorException("DOCUMENT_KMS_KEY_ID is required for AWS KMS document encryption.");
      return new AwsKmsKeyProvider(keyId, "carepoint-clinical-document-dek", process.env.AWS_REGION, process.env.AWS_ENDPOINT_URL_KMS);
    }
    if (provider !== "local") throw new InternalServerErrorException(`Unsupported document key provider '${provider}'.`);
    if (process.env.NODE_ENV === "production" && !localSyntheticPilotProvidersAllowed(process.env)) {
      throw new InternalServerErrorException("Local document envelope keys are forbidden in production.");
    }
    const encoded = process.env.DOCUMENT_ENVELOPE_KEY_BASE64;
    const keyId = process.env.DOCUMENT_ENVELOPE_KEY_ID ?? "local-document-kek-v1";
    if (!encoded) throw new InternalServerErrorException("Document envelope encryption is not configured.");
    const bytes = Uint8Array.from(Buffer.from(encoded, "base64"));
    if (bytes.byteLength !== 32) throw new InternalServerErrorException("DOCUMENT_ENVELOPE_KEY_BASE64 must decode to exactly 32 bytes.");
    return new StaticAesKwKeyProvider(keyId, bytes);
  }
}
