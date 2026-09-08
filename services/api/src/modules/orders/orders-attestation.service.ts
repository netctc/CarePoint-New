import { Injectable, InternalServerErrorException } from "@nestjs/common";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { AwsKmsHmacProvider } from "../../infrastructure/security/aws-kms-hmac-provider";

export interface ClinicalAttestation {
  payloadDigest: string;
  algorithm: "HMAC-SHA256" | "AWS-KMS-HMAC-SHA256";
  keyId: string;
  signature: string;
  signedAt: Date;
}

@Injectable()
export class OrdersAttestationService {
  private kmsHmac?: AwsKmsHmacProvider;

  async attest(value: unknown): Promise<ClinicalAttestation> {
    const signedAt = new Date();
    const payloadDigest = this.digest(value);
    const message = Buffer.from(`${payloadDigest}|${signedAt.toISOString()}`, "utf8");
    if (this.provider() === "aws-kms-hmac") {
      const result = await this.kmsProvider().generate(message);
      return {
        payloadDigest,
        algorithm: "AWS-KMS-HMAC-SHA256",
        keyId: result.keyId,
        signature: Buffer.from(result.mac).toString("base64"),
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
    const message = Buffer.from(`${input.payloadDigest}|${input.signedAt.toISOString()}`, "utf8");
    if (this.providerForStoredSignature(input.algorithm) === "aws-kms-hmac") {
      return this.kmsProvider().verify(message, Buffer.from(input.signature, "base64"), input.keyId);
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

  private provider(): "local" | "aws-kms-hmac" {
    const provider = process.env.ORDER_SIGNING_PROVIDER ?? (process.env.NODE_ENV === "production" ? "aws-kms-hmac" : "local");
    if (provider !== "local" && provider !== "aws-kms-hmac") {
      throw new InternalServerErrorException(`Unsupported clinical order signing provider '${provider}'.`);
    }
    if (process.env.NODE_ENV === "production" && provider === "local") {
      throw new InternalServerErrorException("Local clinical order attestation is forbidden in production.");
    }
    return provider;
  }

  private providerForStoredSignature(algorithm?: string | null): "local" | "aws-kms-hmac" {
    if (algorithm === "AWS-KMS-HMAC-SHA256") return "aws-kms-hmac";
    if (algorithm === "HMAC-SHA256") return "local";
    return this.provider();
  }

  private localKey(): { secret: Buffer; keyId: string } {
    if (process.env.NODE_ENV === "production") {
      throw new InternalServerErrorException("Local clinical order attestation secrets are forbidden in production.");
    }
    const encoded = process.env.ORDER_SIGNING_SECRET_BASE64;
    if (!encoded) throw new InternalServerErrorException("Clinical order signing secret is not configured.");
    const secret = Buffer.from(encoded, "base64");
    if (secret.byteLength < 32) throw new InternalServerErrorException("ORDER_SIGNING_SECRET_BASE64 must decode to at least 32 bytes.");
    return { secret, keyId: process.env.ORDER_SIGNING_KEY_ID ?? "local-orders-signing-v1" };
  }

  private kmsProvider(): AwsKmsHmacProvider {
    if (!this.kmsHmac) {
      const keyId = process.env.ORDER_SIGNING_KMS_KEY_ID?.trim();
      if (!keyId) throw new InternalServerErrorException("ORDER_SIGNING_KMS_KEY_ID is required for AWS KMS clinical order attestation.");
      this.kmsHmac = new AwsKmsHmacProvider(
        keyId,
        process.env.AWS_REGION,
        process.env.AWS_ENDPOINT_URL_KMS,
      );
    }
    return this.kmsHmac;
  }
}
