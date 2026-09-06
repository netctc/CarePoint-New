import { Injectable, InternalServerErrorException } from "@nestjs/common";
import { PhiEnvelopeEncryption, StaticAesKwKeyProvider, type EncryptedEnvelope } from "@carepoint/security";
import { randomBytes } from "node:crypto";

@Injectable()
export class TelehealthEnvelopeService {
  async createSessionKey(): Promise<{ plaintext: string; envelope: EncryptedEnvelope }> {
    const plaintext = randomBytes(32).toString("base64url");
    const envelope = await this.encryption().encryptJson({ key: plaintext });
    return { plaintext, envelope };
  }

  async decryptSessionKey(envelope: EncryptedEnvelope): Promise<string> {
    const value = await this.encryption().decryptJson<{ key: string }>(envelope);
    if (!value.key) throw new InternalServerErrorException("Encrypted telehealth session key is invalid.");
    return value.key;
  }

  private encryption(): PhiEnvelopeEncryption {
    const provider = process.env.TELEHEALTH_KEY_PROVIDER ?? "local";
    if (process.env.NODE_ENV === "production") {
      throw new InternalServerErrorException("Production telehealth E2EE key encryption requires an external KMS/HSM adapter.");
    }
    if (provider !== "local") throw new InternalServerErrorException(`Telehealth key provider '${provider}' is not wired in this runtime yet.`);
    const encoded = process.env.TELEHEALTH_ENVELOPE_KEY_BASE64;
    const keyId = process.env.TELEHEALTH_ENVELOPE_KEY_ID ?? "local-telehealth-kek-v1";
    if (!encoded) throw new InternalServerErrorException("Telehealth envelope encryption is not configured.");
    const bytes = Uint8Array.from(Buffer.from(encoded, "base64"));
    if (bytes.byteLength !== 32) throw new InternalServerErrorException("TELEHEALTH_ENVELOPE_KEY_BASE64 must decode to exactly 32 bytes.");
    return new PhiEnvelopeEncryption(new StaticAesKwKeyProvider(keyId, bytes));
  }
}
