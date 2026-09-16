import { GenerateMacCommand, KMSClient, VerifyMacCommand } from "@aws-sdk/client-kms";
import { Injectable, InternalServerErrorException, type OnModuleDestroy } from "@nestjs/common";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { localSyntheticPilotProvidersAllowed } from "../../infrastructure/release/private-pilot-infrastructure-profile";
import { OciKmsSigningProvider } from "../../infrastructure/security/oci-kms-signing-provider";

type DocumentSigningProvider = "local" | "aws-kms-hmac" | "oci-vault-kms";

@Injectable()
export class DocumentsAttestationService implements OnModuleDestroy {
  private kms?: KMSClient;
  private oci?: OciKmsSigningProvider;

  digest(material: string): string { return createHash("sha256").update(material).digest("hex"); }

  async attest(material: string) {
    const payloadDigest = this.digest(material);
    const provider = this.provider();
    if (provider === "oci-vault-kms") {
      try {
        const result = await this.ociSigningProvider().signDigest(payloadDigest);
        return { payloadDigest, ...result, signedAt: new Date() };
      } catch (error) {
        throw new InternalServerErrorException(error instanceof Error ? error.message : "OCI KMS document attestation failed.");
      }
    }
    if (provider === "aws-kms-hmac") {
      const keyId = this.required("DOCUMENT_SIGNING_KMS_KEY_ID");
      const result = await this.kmsClient().send(new GenerateMacCommand({ KeyId: keyId, MacAlgorithm: "HMAC_SHA_256", Message: Buffer.from(payloadDigest, "utf8") }));
      if (!result.Mac) throw new InternalServerErrorException("AWS KMS did not return a diagnostic attestation MAC.");
      return { payloadDigest, algorithm: "AWS-KMS-HMAC-SHA256" as const, keyId: result.KeyId ?? keyId, signature: Buffer.from(result.Mac).toString("base64"), signedAt: new Date() };
    }
    const secret = this.localSecret();
    return { payloadDigest, algorithm: "HMAC-SHA256" as const, keyId: process.env.DOCUMENT_SIGNING_KEY_ID ?? "local-document-signing-v1", signature: createHmac("sha256", secret).update(payloadDigest).digest("base64"), signedAt: new Date() };
  }

  async verify(material: string, signature: string, keyId?: string | null, algorithm?: string | null): Promise<boolean> {
    const provider = this.providerForStoredSignature(algorithm);
    const payloadDigest = this.digest(material);
    if (provider === "oci-vault-kms") {
      const configuredKeyId = this.required("CAREPOINT_DOCUMENT_SIGNING_KEY_REF");
      const effectiveKeyId = keyId || configuredKeyId;
      if (effectiveKeyId !== configuredKeyId) return false;
      try {
        return await this.ociSigningProvider().verifyDigest(payloadDigest, signature, algorithm);
      } catch {
        return false;
      }
    }
    if (provider === "aws-kms-hmac") {
      const effectiveKeyId = keyId || this.required("DOCUMENT_SIGNING_KMS_KEY_ID");
      try {
        const result = await this.kmsClient().send(new VerifyMacCommand({ KeyId: effectiveKeyId, MacAlgorithm: "HMAC_SHA_256", Message: Buffer.from(payloadDigest, "utf8"), Mac: Buffer.from(signature, "base64") }));
        return result.MacValid === true;
      } catch { return false; }
    }
    const expected = createHmac("sha256", this.localSecret()).update(payloadDigest).digest();
    const actual = Buffer.from(signature, "base64");
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }

  async onModuleDestroy(): Promise<void> {
    await this.oci?.close();
  }

  private provider(): DocumentSigningProvider {
    const productionDefault = process.env.CAREPOINT_CLOUD_PROVIDER?.trim() === "oci"
      ? "oci-vault-kms"
      : "aws-kms-hmac";
    const provider = process.env.DOCUMENT_SIGNING_PROVIDER
      ?? (process.env.NODE_ENV === "production" ? productionDefault : "local");
    if (provider !== "local" && provider !== "aws-kms-hmac" && provider !== "oci-vault-kms") {
      throw new InternalServerErrorException(`Unsupported document signing provider '${provider}'.`);
    }
    if (process.env.NODE_ENV === "production" && process.env.CAREPOINT_CLOUD_PROVIDER?.trim() === "oci" && provider !== "oci-vault-kms") {
      throw new InternalServerErrorException("OCI Release 1 production requires OCI Vault KMS document signing.");
    }
    if (process.env.NODE_ENV === "production" && provider === "local" && !localSyntheticPilotProvidersAllowed(process.env)) {
      throw new InternalServerErrorException("Local document signing is forbidden in production.");
    }
    return provider;
  }

  private providerForStoredSignature(algorithm?: string | null): DocumentSigningProvider {
    if (algorithm === "OCI-KMS-RSA-PSS-SHA256" || algorithm === "OCI-KMS-ECDSA-SHA256") return "oci-vault-kms";
    if (algorithm === "AWS-KMS-HMAC-SHA256") return "aws-kms-hmac";
    if (algorithm === "HMAC-SHA256") return "local";
    return this.provider();
  }

  private ociSigningProvider(): OciKmsSigningProvider {
    if (!this.oci) {
      this.oci = new OciKmsSigningProvider(this.required("CAREPOINT_DOCUMENT_SIGNING_KEY_REF"));
    }
    return this.oci;
  }

  private localSecret(): Buffer {
    if (process.env.NODE_ENV === "production" && !localSyntheticPilotProvidersAllowed(process.env)) {
      throw new InternalServerErrorException("Local document signing secrets are forbidden in production.");
    }
    const encoded = process.env.DOCUMENT_SIGNING_SECRET_BASE64;
    if (!encoded) throw new InternalServerErrorException("Document signing secret is not configured.");
    const secret = Buffer.from(encoded, "base64");
    if (secret.byteLength < 32) throw new InternalServerErrorException("DOCUMENT_SIGNING_SECRET_BASE64 must decode to at least 32 bytes.");
    return secret;
  }

  private kmsClient(): KMSClient {
    if (!this.kms) this.kms = new KMSClient({ ...(process.env.AWS_REGION ? { region: process.env.AWS_REGION } : {}), ...(process.env.AWS_ENDPOINT_URL_KMS ? { endpoint: process.env.AWS_ENDPOINT_URL_KMS } : {}) });
    return this.kms;
  }

  private required(name: string): string {
    const value = process.env[name]?.trim();
    if (!value) throw new InternalServerErrorException(`${name} is required.`);
    return value;
  }
}
