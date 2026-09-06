import { Injectable, InternalServerErrorException } from "@nestjs/common";
import { PhiEnvelopeEncryption, StaticAesKwKeyProvider, type EncryptedEnvelope } from "@carepoint/security";

@Injectable()
export class OrdersEnvelopeService {
  async encrypt(value: unknown): Promise<EncryptedEnvelope> {
    return this.encryption().encryptJson(value);
  }

  async decrypt<T>(envelope: EncryptedEnvelope): Promise<T> {
    return this.encryption().decryptJson<T>(envelope);
  }

  private encryption(): PhiEnvelopeEncryption {
    const provider = process.env.ORDER_KEY_PROVIDER ?? "local";
    if (process.env.NODE_ENV === "production") {
      throw new InternalServerErrorException("Production clinical order PHI encryption requires an external KMS/HSM adapter.");
    }
    if (provider !== "local") throw new InternalServerErrorException(`Clinical order key provider '${provider}' is not wired in this runtime yet.`);
    const encoded = process.env.ORDER_ENVELOPE_KEY_BASE64;
    const keyId = process.env.ORDER_ENVELOPE_KEY_ID ?? "local-orders-kek-v1";
    if (!encoded) throw new InternalServerErrorException("Clinical order envelope encryption is not configured.");
    const bytes = Uint8Array.from(Buffer.from(encoded, "base64"));
    if (bytes.byteLength !== 32) throw new InternalServerErrorException("ORDER_ENVELOPE_KEY_BASE64 must decode to exactly 32 bytes.");
    return new PhiEnvelopeEncryption(new StaticAesKwKeyProvider(keyId, bytes));
  }
}
