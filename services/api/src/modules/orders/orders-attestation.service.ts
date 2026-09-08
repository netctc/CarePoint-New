import { Injectable, InternalServerErrorException } from "@nestjs/common";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export interface ClinicalAttestation {
  payloadDigest: string;
  algorithm: "HMAC-SHA256";
  keyId: string;
  signature: string;
  signedAt: Date;
}

@Injectable()
export class OrdersAttestationService {
  attest(value: unknown): ClinicalAttestation {
    const signedAt = new Date();
    const payloadDigest = this.digest(value);
    const { secret, keyId } = this.localKey();
    const signature = createHmac("sha256", secret).update(`${payloadDigest}|${signedAt.toISOString()}`).digest("base64url");
    return { payloadDigest, algorithm: "HMAC-SHA256", keyId, signature, signedAt };
  }

  verify(value: unknown, input: { payloadDigest: string; signature: string; signedAt: Date }): boolean {
    const digest = this.digest(value);
    if (digest !== input.payloadDigest) return false;
    const { secret } = this.localKey();
    const expected = createHmac("sha256", secret).update(`${input.payloadDigest}|${input.signedAt.toISOString()}`).digest("base64url");
    const left = Buffer.from(expected);
    const right = Buffer.from(input.signature);
    return left.length === right.length && timingSafeEqual(left, right);
  }

  digest(value: unknown): string {
    return createHash("sha256").update(JSON.stringify(value)).digest("hex");
  }

  private localKey(): { secret: Buffer; keyId: string } {
    const provider = process.env.ORDER_SIGNING_PROVIDER ?? "local";
    if (process.env.NODE_ENV === "production") {
      throw new InternalServerErrorException("Production clinical order attestation requires an external KMS/HSM signing adapter.");
    }
    if (provider !== "local") throw new InternalServerErrorException(`Clinical order signing provider '${provider}' is not wired in this runtime yet.`);
    const encoded = process.env.ORDER_SIGNING_SECRET_BASE64;
    if (!encoded) throw new InternalServerErrorException("Clinical order signing secret is not configured.");
    const secret = Buffer.from(encoded, "base64");
    if (secret.byteLength < 32) throw new InternalServerErrorException("ORDER_SIGNING_SECRET_BASE64 must decode to at least 32 bytes.");
    return { secret, keyId: process.env.ORDER_SIGNING_KEY_ID ?? "local-orders-signing-v1" };
  }
}