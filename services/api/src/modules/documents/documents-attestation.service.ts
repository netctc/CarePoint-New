import { GenerateMacCommand, KMSClient, VerifyMacCommand } from "@aws-sdk/client-kms";
import { Injectable, InternalServerErrorException } from "@nestjs/common";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

@Injectable()
export class DocumentsAttestationService {
  private kms?: KMSClient;

  digest(material: string): string { return createHash("sha256").update(material).digest("hex"); }

  async attest(material: string) {
    const payloadDigest = this.digest(material);
    const provider = this.provider();
    if (provider === "aws-kms-hmac") {
      const keyId = this.required("DOCUMENT_SIGNING_KMS_KEY_ID");
      const result = await this.kmsClient().send(new GenerateMacCommand({
        KeyId: keyId,
        MacAlgorithm: "HMAC_SHA_256",
        Message: Buffer.from(payloadDigest, "utf8"),
      }));
      if (!result.Mac) throw new InternalServerErrorException("AWS KMS did not return a diagnostic attestation MAC.");
      return {
        payloadDigest,
        algorithm: "AWS-KMS-HMAC-SHA256" as const,
        keyId: result.KeyId ?? keyId,
        signature: Buffer.from(result.Mac).toString("base64"),
        signedAt: new Date(),
      };
    }
    const secret = this.localSecret();
    return {
      payloadDigest,
      algorithm: "HMAC-SHA256" as const,
      keyId: process.env.DOCUMENT_SIGNING_KEY_ID ?? "local-document-signing-v1",
      signature: createHmac("sha256", secret).update(payloadDigest).digest("base64"),
      signedAt: new Date(),
    };
  }

  async verify(material: string, signature: string, keyId?: string | null, algorithm?: string | null): Promise<boolean> {
    const provider = this.providerForStoredSignature(algorithm);
    const payloadDigest = this.digest(material);
    if (provider === "aws-kms-hmac") {
      const effectiveKeyId = keyId || this.required("DOCUMENT_SIGNING_KMS_KEY_ID");
      try {
        const result = await this.kmsClient().send(new VerifyMacCommand({
          KeyId: effectiveKeyId,
          MacAlgorithm: "HMAC_SHA_256",
          Message: Buffer.from(payloadDigest, "utf8"),
          Mac: Buffer.from(signature, "base64"),
        }));
        return result.MacValid === true;
      } catch {
        return false;
      }
    }
    const expected = createHmac("sha256", this.localSecret()).update(payloadDigest).digest();
    const actual = Buffer.from(signature, "base64");
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }

  private provider(): "local" | "aws-kms-hmac" {
    const provider = process.env.DOCUMENT_SIGNING_PROVIDER ?? (process.env.NODE_ENV === "production" ? "aws-kms-hmac" : "local");
    if (provider !== "local" && provider !== "aws-kms-hmac") throw new InternalServerErrorException(`Unsupported document signing provider '${provider}'.`);
    if (process.env.NODE_ENV === "production" && provider === "local") throw new InternalServerErrorException("Local document signing is forbidden in production.");
    return provider;
  }

  private providerForStoredSignature(algorithm?: string | null): "local" | "aws-kms-hmac" {
    if (algorithm === "AWS-KMS-HMAC-SHA256") return "aws-kms-hmac";
    if (algorithm === "HMAC-SHA256") return "local";
    return this.provider();
  }

  private localSecret(): Buffer {
    if (process.env.NODE_ENV === "production") throw new InternalServerErrorException("Local document signing secrets are forbidden in production.");
    const encoded = process.env.DOCUMENT_SIGNING_SECRET_BASE64;
    if (!encoded) throw new InternalServerErrorException("Document signing secret is not configured.");
    const secret = Buffer.from(encoded, "base64");
    if (secret.byteLength < 32) throw new InternalServerErrorException("DOCUMENT_SIGNING_SECRET_BASE64 must decode to at least 32 bytes.");
    return secret;
  }

  private kmsClient(): KMSClient {
    if (!this.kms) {
      this.kms = new KMSClient({
        ...(process.env.AWS_REGION ? { region: process.env.AWS_REGION } : {}),
        ...(process.env.AWS_ENDPOINT_URL_KMS ? { endpoint: process.env.AWS_ENDPOINT_URL_KMS } : {}),
      });
    }
    return this.kms;
  }

  private required(name: string): string {
    const value = process.env[name]?.trim();
    if (!value) throw new InternalServerErrorException(`${name} is required.`);
    return value;
  }
}
