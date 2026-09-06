export interface WrappedDataKey {
  keyId: string;
  wrappedKey: string;
}

export interface KeyEncryptionKeyProvider {
  wrapDataKey(rawDataKey: Uint8Array): Promise<WrappedDataKey>;
  unwrapDataKey(input: WrappedDataKey): Promise<Uint8Array>;
}

export interface EncryptedEnvelope {
  version: 1;
  algorithm: "AES-256-GCM";
  keyId: string;
  wrappedKey: string;
  iv: string;
  ciphertext: string;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export class PhiEnvelopeEncryption {
  constructor(private readonly keyProvider: KeyEncryptionKeyProvider) {}

  async encryptJson(value: unknown): Promise<EncryptedEnvelope> {
    const rawDataKey = crypto.getRandomValues(new Uint8Array(32));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const dataKey = await crypto.subtle.importKey(
      "raw",
      rawDataKey,
      { name: "AES-GCM" },
      false,
      ["encrypt"],
    );
    const plaintext = encoder.encode(JSON.stringify(value));
    const ciphertextBuffer = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, dataKey, plaintext);
    const wrapped = await this.keyProvider.wrapDataKey(rawDataKey);
    rawDataKey.fill(0);

    return {
      version: 1,
      algorithm: "AES-256-GCM",
      keyId: wrapped.keyId,
      wrappedKey: wrapped.wrappedKey,
      iv: toBase64(iv),
      ciphertext: toBase64(new Uint8Array(ciphertextBuffer)),
    };
  }

  async decryptJson<T>(envelope: EncryptedEnvelope): Promise<T> {
    if (envelope.version !== 1 || envelope.algorithm !== "AES-256-GCM") {
      throw new Error("Unsupported encrypted envelope.");
    }
    const rawDataKey = await this.keyProvider.unwrapDataKey({
      keyId: envelope.keyId,
      wrappedKey: envelope.wrappedKey,
    });
    try {
      const dataKey = await crypto.subtle.importKey(
        "raw",
        rawDataKey,
        { name: "AES-GCM" },
        false,
        ["decrypt"],
      );
      const plaintextBuffer = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: fromBase64(envelope.iv) },
        dataKey,
        fromBase64(envelope.ciphertext),
      );
      return JSON.parse(decoder.decode(plaintextBuffer)) as T;
    } finally {
      rawDataKey.fill(0);
    }
  }
}

/**
 * Test/development-only AES-KW implementation.
 * Production must replace this with a cloud KMS/HSM adapter.
 */
export class StaticAesKwKeyProvider implements KeyEncryptionKeyProvider {
  constructor(
    private readonly keyId: string,
    private readonly keyBytes: Uint8Array,
  ) {
    if (keyBytes.byteLength !== 32) throw new Error("AES-KW test key must be 32 bytes.");
  }

  private async importKey(usages: KeyUsage[]): Promise<CryptoKey> {
    return crypto.subtle.importKey(
      "raw",
      this.keyBytes,
      { name: "AES-KW" },
      false,
      usages,
    );
  }

  async wrapDataKey(rawDataKey: Uint8Array): Promise<WrappedDataKey> {
    const kek = await this.importKey(["wrapKey"]);
    const dek = await crypto.subtle.importKey(
      "raw",
      rawDataKey,
      { name: "AES-GCM" },
      true,
      ["encrypt", "decrypt"],
    );
    const wrapped = await crypto.subtle.wrapKey("raw", dek, kek, "AES-KW");
    return { keyId: this.keyId, wrappedKey: toBase64(new Uint8Array(wrapped)) };
  }

  async unwrapDataKey(input: WrappedDataKey): Promise<Uint8Array> {
    if (input.keyId !== this.keyId) throw new Error("Unknown test key id.");
    const kek = await this.importKey(["unwrapKey"]);
    const dek = await crypto.subtle.unwrapKey(
      "raw",
      fromBase64(input.wrappedKey),
      kek,
      "AES-KW",
      { name: "AES-GCM" },
      true,
      ["encrypt", "decrypt"],
    );
    const raw = await crypto.subtle.exportKey("raw", dek);
    return new Uint8Array(raw);
  }
}
