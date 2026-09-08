import {
  DescribeKeyCommand,
  GenerateMacCommand,
  KMSClient,
  VerifyMacCommand,
  type DescribeKeyCommandOutput,
} from "@aws-sdk/client-kms";
import {
  assertProductionKmsEndpoint,
  kmsKeyMatches,
  validateKmsKeyMetadata,
  type ValidatedKmsKey,
} from "./kms-key-validation";

export interface AwsKmsHmacProviderOptions {
  client?: Pick<KMSClient, "send">;
  expectedAccountId?: string;
  environment?: string;
}

export class AwsKmsHmacProvider {
  private readonly client: Pick<KMSClient, "send">;
  private validation?: Promise<ValidatedKmsKey>;

  constructor(
    private readonly keyId: string,
    private readonly region?: string,
    private readonly endpoint?: string,
    private readonly options: AwsKmsHmacProviderOptions = {},
  ) {
    if (!keyId.trim()) throw new Error("AWS KMS HMAC key id is required.");
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
          kind: "hmac-sha256",
          region: this.region,
          accountId: this.options.expectedAccountId ?? process.env.AWS_KMS_ACCOUNT_ID,
        }));
    }
    return this.validation;
  }

  async generate(message: Uint8Array): Promise<{ keyId: string; mac: Uint8Array }> {
    const key = await this.validateReady();
    const result = await this.client.send(new GenerateMacCommand({
      KeyId: key.arn,
      MacAlgorithm: "HMAC_SHA_256",
      Message: message,
    }));
    if (!result.Mac) throw new Error("AWS KMS did not return HMAC material.");
    if (!kmsKeyMatches(result.KeyId, this.keyId, key)) {
      throw new Error("AWS KMS GenerateMac returned a different key than the validated HMAC key.");
    }
    return { keyId: result.KeyId ?? key.arn, mac: Uint8Array.from(result.Mac) };
  }

  async verify(message: Uint8Array, mac: Uint8Array, storedKeyId?: string | null): Promise<boolean> {
    const key = await this.validateReady();
    if (storedKeyId && !kmsKeyMatches(storedKeyId, this.keyId, key)) return false;
    try {
      const result = await this.client.send(new VerifyMacCommand({
        KeyId: key.arn,
        MacAlgorithm: "HMAC_SHA_256",
        Message: message,
        Mac: mac,
      }));
      return result.MacValid === true;
    } catch {
      return false;
    }
  }
}
