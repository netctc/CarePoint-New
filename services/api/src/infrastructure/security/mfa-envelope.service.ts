import { Injectable, InternalServerErrorException } from "@nestjs/common";
import { PhiEnvelopeEncryption, StaticAesKwKeyProvider, type EncryptedEnvelope } from "@carepoint/security";

@Injectable()
export class MfaEnvelopeService {
  private encryption(): PhiEnvelopeEncryption {
    const provider = process.env.MFA_KEY_PROVIDER ?? "local";
    if (process.env.NODE_ENV === "production") {
      throw new InternalServerErrorException("Production MFA encryption requires the external KMS/HSM adapter planned for the deployment environment.");
    }
    if (provider !== "local") {
      throw new InternalServerErrorException(`MFA key provider '${provider}' is not wired in this runtime yet.`);
    }

    const encoded = process.env.MFA_ENVELOPE_KEY_BASE64;
    const keyId = process.env.MFA_ENVELOPE_KEY_ID ?? "local-mfa-kek-v1";
    if (!encoded) throw new InternalServerErrorException("MFA envelope encryption is not configured.");

    const bytes = Uint8Array.from(Buffer.from(encoded, "base64"));
    if (bytes.byteLength !== 32) throw new InternalServerErrorException("MFA_ENVELOPE_KEY_BASE64 must decode to exactly 32 bytes.");
    return new PhiEnvelopeEncryption(new StaticAesKwKeyProvider(keyId, bytes));
  }

  async encryptSecret(secret: string): Promise<EncryptedEnvelope> {
    return this.encryption().encryptJson({ secret });
  }

  async decryptSecret(envelope: EncryptedEnvelope): Promise<string> {
    const value = await this.encryption().decryptJson<{ secret: string }>(envelope);
    if (!value.secret) throw new InternalServerErrorException("Encrypted MFA secret is invalid.");
    return value.secret;
  }
}
