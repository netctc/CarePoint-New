import { Injectable, InternalServerErrorException } from "@nestjs/common";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

@Injectable()
export class DocumentsAttestationService {
  digest(material: string): string { return createHash("sha256").update(material).digest("hex"); }

  attest(material: string) {
    const payloadDigest = this.digest(material);
    const secret = this.secret();
    return {
      payloadDigest,
      algorithm: "HMAC-SHA256" as const,
      keyId: process.env.DOCUMENT_SIGNING_KEY_ID ?? "local-document-signing-v1",
      signature: createHmac("sha256", secret).update(payloadDigest).digest("base64"),
      signedAt: new Date(),
    };
  }

  verify(material: string, signature: string): boolean {
    const expected = createHmac("sha256", this.secret()).update(this.digest(material)).digest();
    const actual = Buffer.from(signature, "base64");
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }

  private secret(): Buffer {
    const provider = process.env.DOCUMENT_SIGNING_PROVIDER ?? "local";
    if (process.env.NODE_ENV === "production") throw new InternalServerErrorException("Production diagnostic attestation requires an external KMS/HSM signing adapter.");
    if (provider !== "local") throw new InternalServerErrorException(`Document signing provider '${provider}' is not wired in this runtime yet.`);
    const encoded = process.env.DOCUMENT_SIGNING_SECRET_BASE64;
    if (!encoded) throw new InternalServerErrorException("Document signing secret is not configured.");
    const secret = Buffer.from(encoded, "base64");
    if (secret.byteLength < 32) throw new InternalServerErrorException("DOCUMENT_SIGNING_SECRET_BASE64 must decode to at least 32 bytes.");
    return secret;
  }
}
