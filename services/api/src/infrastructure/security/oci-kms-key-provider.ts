import type { KeyEncryptionKeyProvider, WrappedDataKey } from "@carepoint/security";
import { productionKeyManagementContract } from "../cloud/production-key-management";

const INSTANCE_PRINCIPAL_AUTH_MODE = "instance-principal";
const OCI_AES_256_GCM = "AES_256_GCM";
const DATA_KEY_BYTES = 32;
const FORBIDDEN_ENDPOINT_ENV_VARS = [
  "CAREPOINT_OCI_KMS_ENDPOINT",
  "CAREPOINT_OCI_VAULT_ENDPOINT",
  "CAREPOINT_OCI_SECRETS_ENDPOINT",
] as const;

type OciAuthenticationProvider = unknown;

type OciVaultResource = {
  id?: string;
  lifecycleState?: string;
  cryptoEndpoint?: string;
};

type OciEncryptedData = {
  ciphertext?: string;
  keyId?: string;
  keyVersionId?: string;
  encryptionAlgorithm?: string;
};

type OciDecryptedData = {
  plaintext?: string;
  keyId?: string;
  keyVersionId?: string;
  encryptionAlgorithm?: string;
};

export interface OciKmsVaultClient {
  regionId: string;
  getVault(request: { vaultId: string }): Promise<{ vault?: OciVaultResource }>;
  close(): void;
}

export interface OciKmsCryptoClient {
  endpoint: string;
  encrypt(request: {
    encryptDataDetails: {
      keyId: string;
      plaintext: string;
      associatedData: Record<string, string>;
      encryptionAlgorithm: "AES_256_GCM";
    };
  }): Promise<{ encryptedData?: OciEncryptedData }>;
  decrypt(request: {
    decryptDataDetails: {
      keyId: string;
      ciphertext: string;
      associatedData: Record<string, string>;
      encryptionAlgorithm: "AES_256_GCM";
    };
  }): Promise<{ decryptedData?: OciDecryptedData }>;
  close(): void;
}

export interface OciKmsRuntimeSdkFactory {
  buildInstancePrincipal(): Promise<OciAuthenticationProvider>;
  createVaultDiscoveryClient(provider: OciAuthenticationProvider): OciKmsVaultClient;
  createCryptoClient(provider: OciAuthenticationProvider): OciKmsCryptoClient;
}

export interface OciKmsKeyProviderOptions {
  sdkFactory?: OciKmsRuntimeSdkFactory;
}

type Runtime = {
  provider: OciAuthenticationProvider;
  client: OciKmsCryptoClient;
};

/**
 * OCI Vault KMS adapter for CarePoint envelope-encryption data keys.
 *
 * Runtime initialization is deliberately lazy so non-OCI deployments never load
 * OCI SDK modules. The crypto client is process-lived, matching the existing AWS
 * KMS provider lifecycle used by envelope services.
 */
export class OciKmsKeyProvider implements KeyEncryptionKeyProvider {
  private runtimePromise?: Promise<Runtime>;

  constructor(
    private readonly keyId: string,
    private readonly purpose: string,
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly options: OciKmsKeyProviderOptions = {},
  ) {
    if (!keyId.trim()) throw new Error("OCI KMS key id is required.");
    if (!purpose.trim()) throw new Error("OCI KMS encryption purpose is required.");
  }

  async wrapDataKey(rawDataKey: Uint8Array): Promise<WrappedDataKey> {
    if (rawDataKey.byteLength !== DATA_KEY_BYTES) {
      throw new Error(`OCI KMS data key must be exactly ${DATA_KEY_BYTES} bytes.`);
    }

    const runtime = await this.runtime();
    let result: { encryptedData?: OciEncryptedData };
    try {
      result = await runtime.client.encrypt({
        encryptDataDetails: {
          keyId: this.keyId,
          plaintext: Buffer.from(rawDataKey).toString("base64"),
          associatedData: { purpose: this.purpose },
          encryptionAlgorithm: OCI_AES_256_GCM,
        },
      });
    } catch (error) {
      throw new Error(`OCI KMS encryption failed (${errorName(error)}).`);
    }

    const encrypted = result.encryptedData;
    const ciphertext = encrypted?.ciphertext?.trim();
    if (!encrypted || !ciphertext) {
      throw new Error("OCI KMS encryption returned no wrapped key material.");
    }
    validateResponseKey(encrypted.keyId, this.keyId);
    validateResponseAlgorithm(encrypted.encryptionAlgorithm);

    return {
      keyId: encrypted.keyId?.trim() || this.keyId,
      wrappedKey: ciphertext,
    };
  }

  async unwrapDataKey(input: WrappedDataKey): Promise<Uint8Array> {
    if (input.keyId.trim() !== this.keyId) {
      throw new Error("OCI KMS wrapped key references an unexpected key id.");
    }
    const ciphertext = input.wrappedKey.trim();
    if (!ciphertext) throw new Error("OCI KMS wrapped key material is required.");

    const runtime = await this.runtime();
    let result: { decryptedData?: OciDecryptedData };
    try {
      result = await runtime.client.decrypt({
        decryptDataDetails: {
          keyId: this.keyId,
          ciphertext,
          associatedData: { purpose: this.purpose },
          encryptionAlgorithm: OCI_AES_256_GCM,
        },
      });
    } catch (error) {
      throw new Error(`OCI KMS decryption failed (${errorName(error)}).`);
    }

    const decrypted = result.decryptedData;
    if (!decrypted) throw new Error("OCI KMS decryption returned no plaintext data key material.");
    validateResponseKey(decrypted.keyId, this.keyId);
    validateResponseAlgorithm(decrypted.encryptionAlgorithm);

    const decoded = decodeCanonicalBase64(decrypted.plaintext);
    try {
      if (decoded.byteLength !== DATA_KEY_BYTES) {
        throw new Error(`OCI KMS returned an invalid data key length; expected ${DATA_KEY_BYTES} bytes.`);
      }
      return Uint8Array.from(decoded);
    } finally {
      decoded.fill(0);
    }
  }

  private async runtime(): Promise<Runtime> {
    if (!this.runtimePromise) this.runtimePromise = this.initializeRuntime();
    return this.runtimePromise;
  }

  private async initializeRuntime(): Promise<Runtime> {
    if (this.env.NODE_ENV !== "production" || this.env.CAREPOINT_CLOUD_PROVIDER?.trim() !== "oci") {
      throw new Error("OCI KMS envelope provider is restricted to OCI production.");
    }
    if (this.env.CAREPOINT_OCI_AUTH_MODE?.trim() !== INSTANCE_PRINCIPAL_AUTH_MODE) {
      throw new Error(
        `CAREPOINT_OCI_AUTH_MODE must be '${INSTANCE_PRINCIPAL_AUTH_MODE}' for OCI Release 1 production.`,
      );
    }
    for (const name of FORBIDDEN_ENDPOINT_ENV_VARS) {
      if (this.env[name]?.trim()) {
        throw new Error(`${name} endpoint overrides are forbidden in OCI Release 1 production.`);
      }
    }

    const contract = productionKeyManagementContract(this.env);
    if (!contract || contract.provider !== "oci-vault-kms") {
      throw new Error("OCI KMS envelope provider requires the OCI Vault/KMS production contract.");
    }
    const domain = contract.domains.find((candidate) => candidate.keyRef === this.keyId);
    if (!domain || domain.usage !== "encrypt-decrypt") {
      throw new Error("OCI KMS envelope key is not an approved encrypt-decrypt production key reference.");
    }

    const sdkFactory = this.options.sdkFactory ?? loadDefaultSdkFactory();
    let provider: OciAuthenticationProvider;
    try {
      provider = await sdkFactory.buildInstancePrincipal();
    } catch (error) {
      throw new Error(`OCI instance-principal authentication initialization failed (${errorName(error)}).`);
    }

    let discovery: OciKmsVaultClient | undefined;
    let crypto: OciKmsCryptoClient | undefined;
    try {
      discovery = sdkFactory.createVaultDiscoveryClient(provider);
      discovery.regionId = contract.region;

      let vault: OciVaultResource | undefined;
      try {
        vault = (await discovery.getVault({ vaultId: contract.vaultRef })).vault;
      } catch (error) {
        throw new Error(`OCI Vault discovery failed (${errorName(error)}).`);
      }
      const cryptoEndpoint = validateVaultResource(vault, contract.vaultRef, contract.region);
      closeClient(discovery);
      discovery = undefined;

      crypto = sdkFactory.createCryptoClient(provider);
      crypto.endpoint = cryptoEndpoint;
      return { provider, client: crypto };
    } catch (error) {
      closeClient(discovery);
      closeClient(crypto);
      closeProvider(provider);
      throw error;
    }
  }
}

function validateVaultResource(
  resource: OciVaultResource | undefined,
  expectedVaultRef: string,
  region: string,
): string {
  if (!resource) throw new Error("OCI Vault discovery returned no Vault resource.");
  if (resource.id?.trim() !== expectedVaultRef) {
    throw new Error("OCI Vault discovery returned a Vault that does not match CAREPOINT_VAULT_REF.");
  }
  if (resource.lifecycleState?.trim().toUpperCase() !== "ACTIVE") {
    throw new Error("OCI production Vault must be in ACTIVE lifecycle state.");
  }
  return validateCryptoEndpoint(resource.cryptoEndpoint, region);
}

function validateCryptoEndpoint(value: string | undefined, region: string): string {
  const raw = value?.trim();
  if (!raw) throw new Error("OCI production Vault must expose a crypto endpoint.");

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("OCI production Vault crypto endpoint is invalid.");
  }
  const hostname = url.hostname.toLowerCase();
  if (url.protocol !== "https:") {
    throw new Error("OCI production Vault crypto endpoint must use HTTPS.");
  }
  if (url.username || url.password || (url.port && url.port !== "443")) {
    throw new Error("OCI production Vault crypto endpoint contains forbidden authority components.");
  }
  if (!hostname.endsWith(".oraclecloud.com")) {
    throw new Error("OCI production Vault crypto endpoint must use an oraclecloud.com host.");
  }
  if (!hostname.includes(`.${region.toLowerCase()}.`)) {
    throw new Error("OCI production Vault crypto endpoint does not match the configured active region.");
  }
  if ((url.pathname && url.pathname !== "/") || url.search || url.hash) {
    throw new Error("OCI production Vault crypto endpoint must not include a path, query or fragment.");
  }
  return url.origin;
}

function loadDefaultSdkFactory(): OciKmsRuntimeSdkFactory {
  try {
    // Runtime requires are intentional: AWS and non-production paths do not initialize OCI SDK modules.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const common = require("oci-common") as {
      InstancePrincipalsAuthenticationDetailsProvider: {
        builder(): { build(): Promise<OciAuthenticationProvider> };
      };
    };
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const keymanagement = require("oci-keymanagement") as {
      KmsVaultClient: new (args: { authenticationDetailsProvider: OciAuthenticationProvider }) => OciKmsVaultClient;
      KmsCryptoClient: new (args: { authenticationDetailsProvider: OciAuthenticationProvider }) => OciKmsCryptoClient;
    };

    return {
      buildInstancePrincipal: () => common.InstancePrincipalsAuthenticationDetailsProvider.builder().build(),
      createVaultDiscoveryClient: (provider) => new keymanagement.KmsVaultClient({
        authenticationDetailsProvider: provider,
      }),
      createCryptoClient: (provider) => new keymanagement.KmsCryptoClient({
        authenticationDetailsProvider: provider,
      }),
    };
  } catch (error) {
    throw new Error(`OCI SDK modules could not be loaded (${errorName(error)}).`);
  }
}

function validateResponseKey(value: string | undefined, expected: string): void {
  const key = value?.trim();
  if (key && key !== expected) throw new Error("OCI KMS response references an unexpected key id.");
}

function validateResponseAlgorithm(value: string | undefined): void {
  const algorithm = value?.trim();
  if (algorithm && algorithm !== OCI_AES_256_GCM) {
    throw new Error("OCI KMS response used an unexpected encryption algorithm.");
  }
}

function decodeCanonicalBase64(value: string | undefined): Buffer {
  const raw = value?.trim() ?? "";
  if (!raw || raw.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(raw)) {
    throw new Error("OCI KMS plaintext data key is not canonical base64.");
  }
  const decoded = Buffer.from(raw, "base64");
  if (!decoded.byteLength || decoded.toString("base64") !== raw) {
    decoded.fill(0);
    throw new Error("OCI KMS plaintext data key is not canonical base64.");
  }
  return decoded;
}

function closeClient(client: { close(): void } | undefined): void {
  if (!client) return;
  try {
    client.close();
  } catch {
    // Best-effort cleanup only.
  }
}

function closeProvider(provider: OciAuthenticationProvider): void {
  const candidate = provider as { closeProvider?: () => void } | null;
  if (!candidate?.closeProvider) return;
  try {
    candidate.closeProvider();
  } catch {
    // Best-effort cleanup only.
  }
}

function errorName(error: unknown): string {
  if (error instanceof Error && error.name) {
    return error.name.replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 80) || "OciSdkError";
  }
  return "OciSdkError";
}
