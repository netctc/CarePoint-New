import {
  DecryptCommand,
  DescribeKeyCommand,
  EncryptCommand,
  KMSClient,
  type DescribeKeyCommandOutput,
} from "@aws-sdk/client-kms";
import type { KeyEncryptionKeyProvider, WrappedDataKey } from "@carepoint/security";
import {
  assertProductionKmsEndpoint,
  kmsKeyMatches,
  validateKmsKeyMetadata,
  type ValidatedKmsKey,
} from "./kms-key-validation";

export interface AwsKmsKeyProviderOptions {
  client?: Pick<KMSClient, "send">;
  expectedAccountId?: string;
  environment?: string;
}

export class AwsKmsKeyProvider implements KeyEncryptionKeyProvider {
  private readonly client: Pick<KMSClient, "send">;
  private validation?: Promise<ValidatedKmsKey>;

  constructor(
    private readonly keyId: string,
    private readonly purpose: string,
    private readonly region?: string,
    private readonly endpoint?: string,
    private readonly options: AwsKmsKeyProviderOptions = {},
  ) {
    if (!keyId.trim()) throw new Error("AWS KMS key id is required.");
    if (!purpose.trim()) throw new Error("AWS KMS encryption purpose is required.");
    assertProductionKmsEndpoint(options.environment ?? process.env.NODE_ENV, endpoint);
    this.client = options.client ?? new KMSClient({
      ...(region ? { region } : {}),
      ...(endpoint ? { endpoint } : {}),
    });
  }

  async validateReady(): Promise<ValidatedKmsKey> {
    if (!this.validation) {
      this.validation = this.client
        .send(new DescribeKeyCommand({ KeyId: this.keyId }))
        .then((result) => validateKmsKeyMetadata((result as DescribeKeyCommandOutput).KeyMetadata, {
          kind: "encryption",
          region: this.region,
          accountId: this.options.expectedAccountId ?? process.env.AWS_KMS_ACCOUNT_ID,
        }));
    }
    return this.validation;
  }

  async wrapDataKey(rawDataKey: Uint8Array): Promise<WrappedDataKey> {
    const key = await this.validateReady();
    const result = await this.client.send(new EncryptCommand({
      KeyId: key.arn,
      Plaintext: rawDataKey,
      EncryptionAlgorithm: "SYMMETRIC_DEFAULT",
      EncryptionContext: { purpose: this.purpose },
    }));
    if (!result.CiphertextBlob) throw new Error("AWS KMS did not return wrapped key material.");
    if (!kmsKeyMatches(result.KeyId, this.keyId, key)) {
      throw new Error("AWS KMS Encrypt returned a different key than the validated envelope key.");
    }
    return {
      keyId: result.KeyId ?? key.arn,
      wrappedKey: Buffer.from(result.CiphertextBlob).toString("base64"),
    };
  }

  async unwrapDataKey(input: WrappedDataKey): Promise<Uint8Array> {
    const key = await this.validateReady();
    if (!kmsKeyMatches(input.keyId, this.keyId, key)) {
      throw new Error("Encrypted envelope references a different AWS KMS key.");
    }
    const result = await this.client.send(new DecryptCommand({
      KeyId: key.arn,
      CiphertextBlob: Buffer.from(input.wrappedKey, "base64"),
      EncryptionAlgorithm: "SYMMETRIC_DEFAULT",
      EncryptionContext: { purpose: this.purpose },
    }));
    if (!result.Plaintext) throw new Error("AWS KMS did not return plaintext data key material.");
    if (!kmsKeyMatches(result.KeyId, this.keyId, key)) {
      throw new Error("AWS KMS Decrypt returned a different key than the validated envelope key.");
    }
    const bytes = Uint8Array.from(result.Plaintext);
    if (bytes.byteLength !== 32) throw new Error("AWS KMS returned an invalid data key length.");
    return bytes;
  }
}
