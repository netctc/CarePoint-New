import { Injectable, InternalServerErrorException } from "@nestjs/common";
import { PhiEnvelopeEncryption, StaticAesKwKeyProvider, type EncryptedEnvelope } from "@carepoint/security";

@Injectable()
export class MessagingEnvelopeService {
  async encrypt(value: unknown): Promise<EncryptedEnvelope> {
    return this.encryption().encryptJson(value);
  }

  async decrypt<T>(envelope: EncryptedEnvelope): Promise<T> {
    return this.encryption().decryptJson<T>(envelope);
  }

  private encryption(): PhiEnvelopeEncryption {
    const provider = process.env.MESSAGING_KEY_PROVIDER ?? "local";
    if (process.env.NODE_ENV === "production") {
      throw new InternalServerErrorException("Production secure messaging encryption requires an external KMS/HSM adapter.");
    }
    if (provider !== "local") throw new InternalServerErrorException(`Messaging key provider '${provider}' is not wired in this runtime yet.`);
    const encoded = process.env.MESSAGING_ENVELOPE_KEY_BASE64;
    const keyId = process.env.MESSAGING_ENVELOPE_KEY_ID ?? "local-messaging-kek-v1";
    if (!encoded) throw new InternalServerErrorException("Secure messaging envelope encryption is not configured.");
    const bytes = Uint8Array.from(Buffer.from(encoded, "base64"));
    if (bytes.byteLength !== 32) throw new InternalServerErrorException("MESSAGING_ENVELOPE_KEY_BASE64 must decode to exactly 32 bytes.");
    return new PhiEnvelopeEncryption(new StaticAesKwKeyProvider(keyId, bytes));
  }
}
