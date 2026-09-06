import { DecryptCommand, EncryptCommand, KMSClient } from "@aws-sdk/client-kms";
import type { KeyEncryptionKeyProvider, WrappedDataKey } from "@carepoint/security";

export class AwsKmsKeyProvider implements KeyEncryptionKeyProvider {
  private readonly client: KMSClient;

  constructor(
    private readonly keyId: string,
    region?: string,
    endpoint?: string,
  ) {
    this.client = new KMSClient({
      ...(region ? { region } : {}),
      ...(endpoint ? { endpoint } : {}),
    });
  }

  async wrapDataKey(rawDataKey: Uint8Array): Promise<WrappedDataKey> {
    const result = await this.client.send(new EncryptCommand({
      KeyId: this.keyId,
      Plaintext: rawDataKey,
      EncryptionAlgorithm: "SYMMETRIC_DEFAULT",
      EncryptionContext: { purpose: "carepoint-clinical-document-dek" },
    }));
    if (!result.CiphertextBlob) throw new Error("AWS KMS did not return wrapped key material.");
    return {
      keyId: result.KeyId ?? this.keyId,
      wrappedKey: Buffer.from(result.CiphertextBlob).toString("base64"),
    };
  }

  async unwrapDataKey(input: WrappedDataKey): Promise<Uint8Array> {
    const result = await this.client.send(new DecryptCommand({
      KeyId: input.keyId,
      CiphertextBlob: Buffer.from(input.wrappedKey, "base64"),
      EncryptionAlgorithm: "SYMMETRIC_DEFAULT",
      EncryptionContext: { purpose: "carepoint-clinical-document-dek" },
    }));
    if (!result.Plaintext) throw new Error("AWS KMS did not return plaintext data key material.");
    const bytes = Uint8Array.from(result.Plaintext);
    if (bytes.byteLength !== 32) throw new Error("AWS KMS returned an invalid document data key length.");
    return bytes;
  }
}
