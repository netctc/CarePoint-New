import { GenerateMacCommand, KMSClient, VerifyMacCommand } from "@aws-sdk/client-kms";
import { Injectable, InternalServerErrorException } from "@nestjs/common";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export interface ClinicalAttestation {
  payloadDigest: string;
  algorithm: "HMAC-SHA256" | "AWS-KMS-HMAC-SHA256";
  keyId: string;
  signature: string;
  signedAt: Date;
}

type SigningProvider = "local" | "aws-kms-hmac";

@Injectable()
export class OrdersAttestationService {
  private kms?: KMSClient;

  async attest(value: unknown): Promise<ClinicalAttestation> {
    const signedAt = new Date();
    const payloadDigest = this.digest(value);
    const message = this.signatureMessage(payloadDigest, signedAt);
    const provider = this.provider();

    if (provider === "aws-kms-hmac") {
      const keyId = this.required("ORDER_SIGNING_KMS_KEY_ID");
      const result = await this.kmsClient().send(new GenerateMacCommand({
        KeyId: keyId,
        MacAlgorithm: "HMAC_SHA_256",
        Message: Buffer.from(message, "utf8"),
      }));
      if (!result.Mac) throw new InternalServerErrorException("AWS KMS did not return a clinical order attestation MAC.");
      return {
        payloadDigest,
        algorithm: "AWS-KMS-HMAC-SHA256",
        keyId: result.KeyId ?? keyId,
        signature: Buffer.from(result.Mac).toString("base64"),
        signedAt,
      };
    }

    const { secret, keyId } = this.localKey();
    const signature = createHmac("sha256", secret).update(message).digest("base64url");
    return { payloadDigest, algorithm: "HMAC-SHA256", keyId, signature, signedAt };
  }

  async verify(
    value: unknown,
    input: { payloadDigest: string; signature: string; signedAt: Date; keyId?: string | null; algorithm?: string | null },
  ): Promise<boolean> {
    const digest = this.digest(value);
    if (digest !== input.payloadDigest) return false;
    const message = this.signatureMessage(input.payloadDigest, input.signedAt);
    const provider = this.providerForStoredSignature(input.algorithm);

    if (provider === "aws-kms-hmac") {
      const effectiveKeyId = input.keyId?.trim() || this.required("ORDER_SIGNING_KMS_KEY_ID");
      try {
        const result = await this.kmsClient().send(new VerifyMacCommand({
          KeyId: effectiveKeyId,
          MacAlgorithm: "HMAC_SHA_256",
          Message: Buffer.from(message, "utf8"),
          Mac: Buffer.from(input.signature, "base64"),
        }));
        return result.MacValid === true;
      } catch {
        return false;
      }
    }

    const { secret } = this.localKey();
    const expected = createHmac("sha256", secret).update(message).digest("base64url");
    const left = Buffer.from(expected);
    const right = Buffer.from(input.signature);
    return left.length === right.length && timingSafeEqual(left, right);
  }

  digest(value: unknown): string {
    return createHash("sha256").update(JSON.stringify(value)).digest("hex");
  }

  private signatureMessage(payloadDigest: string, signedAt: Date): string {
    return `${payloadDigest}|${signedAt.toISOString()}`;
  }

  private provider(): SigningProvider {
    const provider = process.env.ORDER_SIGNING_PROVIDER ?? (process.env.NODE_ENV === "production" ? "aws-kms-hmac" : "local");
    if (provider !== "local" && provider !== "aws-kms-hmac") {
      throw new InternalServerErrorException(`Unsupported clinical order signing provider '${provider}'.`);
    }
    if (process.env.NODE_ENV === "production" && provider === "local") {
      throw new InternalServerErrorException("Local clinical order signing is forbidden in production.");
    }
    return provider;
  }

  private providerForStoredSignature(algorithm?: string | null): SigningProvider {
    if (algorithm === "AWS-KMS-HMAC-SHA256") return "aws-kms-hmac";
    if (algorithm === "HMAC-SHA256") return "local";
    return this.provider();
  }

  private localKey(): { secret: Buffer; keyId: string } {
    if (process.env.NODE_ENV === "production") {
      throw new InternalServerErrorException("Local clinical order signing secrets are forbidden in production.");
    }
    const encoded = process.env.ORDER_SIGNING_SECRET_BASE64;
    if (!encoded) throw new InternalServerErrorException("Clinical order signing secret is not configured.");
    const secret = Buffer.from(encoded, "base64");
    if (secret.byteLength < 32) throw new InternalServerErrorException("ORDER_SIGNING_SECRET_BASE64 must decode to at least 32 bytes.");
    return { secret, keyId: process.env.ORDER_SIGNING_KEY_ID ?? "local-orders-signing-v1" };
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
