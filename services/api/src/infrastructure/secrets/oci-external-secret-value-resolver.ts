import {
  productionExternalSecretStoreContract,
  type ProductionExternalSecretName,
} from "../cloud/production-secret-store";

const INSTANCE_PRINCIPAL_AUTH_MODE = "instance-principal";
const MAX_PLAINTEXT_SECRET_BYTES = 4096;
const FORBIDDEN_ENDPOINT_ENV_VARS = [
  "CAREPOINT_OCI_KMS_ENDPOINT",
  "CAREPOINT_OCI_VAULT_ENDPOINT",
  "CAREPOINT_OCI_SECRETS_ENDPOINT",
] as const;

type OciAuthenticationProvider = unknown;

type OciSecretBundleContentResource = {
  contentType?: string;
  content?: string;
};

type OciSecretBundleValueResource = {
  secretId?: string;
  versionName?: string;
  versionNumber?: number;
  secretBundleContent?: OciSecretBundleContentResource;
};

export interface OciSecretValueClient {
  regionId: string;
  getSecretBundle(request: {
    secretId: string;
    stage: "CURRENT";
  }): Promise<{ secretBundle?: OciSecretBundleValueResource }>;
  close(): void;
}

export interface OciSecretValueSdkFactory {
  buildInstancePrincipal(): Promise<OciAuthenticationProvider>;
  createSecretsClient(provider: OciAuthenticationProvider): OciSecretValueClient;
}

export interface OciExternalSecretValueResolverOptions {
  sdkFactory?: OciSecretValueSdkFactory;
}

type Runtime = {
  provider: OciAuthenticationProvider;
  client: OciSecretValueClient;
};

type CachedValue = {
  versionIdentity: string;
  value: string;
};

export class OciExternalSecretValueResolver {
  private readonly cache = new Map<ProductionExternalSecretName, CachedValue>();
  private runtimePromise?: Promise<Runtime>;
  private closed = false;

  constructor(
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly options: OciExternalSecretValueResolverOptions = {},
  ) {}

  async resolve(name: ProductionExternalSecretName): Promise<string> {
    if (this.closed) throw new Error("OCI external credential resolver is closed.");

    const contract = productionExternalSecretStoreContract(this.env);
    if (!contract || contract.provider !== "oci-vault-secrets") {
      throw new Error("OCI external credential resolver requires the OCI Vault Secrets production contract.");
    }
    const domain = contract.secrets.find((candidate) => candidate.name === name);
    if (!domain) throw new Error(`Unsupported external credential '${name}'.`);

    const runtime = await this.runtime(contract.region);
    let bundle: OciSecretBundleValueResource | undefined;
    try {
      bundle = (await runtime.client.getSecretBundle({
        secretId: domain.secretRef,
        stage: "CURRENT",
      })).secretBundle;
    } catch (error) {
      throw new Error(`OCI external credential retrieval failed (${errorName(error)}).`);
    }

    if (!bundle || bundle.secretId?.trim() !== domain.secretRef) {
      throw new Error("OCI external credential retrieval returned an unexpected resource.");
    }
    const versionIdentity = currentVersionIdentity(bundle);
    const cached = this.cache.get(name);
    if (cached?.versionIdentity === versionIdentity) return cached.value;

    const content = bundle.secretBundleContent;
    if (content?.contentType?.trim().toUpperCase() !== "BASE64") {
      throw new Error("OCI external credential content must use BASE64 encoding.");
    }
    const plaintextBytes = decodeCanonicalBase64(content.content);
    try {
      if (plaintextBytes.byteLength < 1 || plaintextBytes.byteLength > MAX_PLAINTEXT_SECRET_BYTES) {
        throw new Error("OCI external credential plaintext has an invalid size.");
      }
      const value = decodeUtf8(plaintextBytes);
      validatePlaintext(value);
      this.cache.set(name, { versionIdentity, value });
      return value;
    } finally {
      plaintextBytes.fill(0);
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.cache.clear();
    if (!this.runtimePromise) return;

    let runtime: Runtime | undefined;
    try {
      runtime = await this.runtimePromise;
    } catch {
      return;
    }
    try {
      runtime.client.close();
    } catch {
      // Best-effort cleanup only.
    }
    closeProvider(runtime.provider);
  }

  private async runtime(region: string): Promise<Runtime> {
    if (!this.runtimePromise) {
      this.runtimePromise = this.initializeRuntime(region);
    }
    return this.runtimePromise;
  }

  private async initializeRuntime(region: string): Promise<Runtime> {
    if (this.env.NODE_ENV !== "production" || this.env.CAREPOINT_CLOUD_PROVIDER?.trim() !== "oci") {
      throw new Error("OCI external credential resolver is restricted to OCI production.");
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

    const sdkFactory = this.options.sdkFactory ?? loadDefaultSdkFactory();
    let provider: OciAuthenticationProvider;
    try {
      provider = await sdkFactory.buildInstancePrincipal();
    } catch (error) {
      throw new Error(`OCI instance-principal authentication initialization failed (${errorName(error)}).`);
    }

    try {
      const client = sdkFactory.createSecretsClient(provider);
      client.regionId = region;
      return { provider, client };
    } catch (error) {
      closeProvider(provider);
      throw new Error(`OCI Secrets client initialization failed (${errorName(error)}).`);
    }
  }
}

function loadDefaultSdkFactory(): OciSecretValueSdkFactory {
  try {
    // Runtime requires are intentional: AWS and non-production paths do not initialize OCI SDK modules.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const common = require("oci-common") as {
      InstancePrincipalsAuthenticationDetailsProvider: {
        builder(): { build(): Promise<OciAuthenticationProvider> };
      };
    };
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const secrets = require("oci-secrets") as {
      SecretsClient: new (args: { authenticationDetailsProvider: OciAuthenticationProvider }) => OciSecretValueClient;
    };
    return {
      buildInstancePrincipal: () => common.InstancePrincipalsAuthenticationDetailsProvider.builder().build(),
      createSecretsClient: (provider) => new secrets.SecretsClient({
        authenticationDetailsProvider: provider,
      }),
    };
  } catch (error) {
    throw new Error(`OCI SDK modules could not be loaded (${errorName(error)}).`);
  }
}

function currentVersionIdentity(bundle: OciSecretBundleValueResource): string {
  if (typeof bundle.versionNumber === "number" && Number.isInteger(bundle.versionNumber) && bundle.versionNumber > 0) {
    return `number:${bundle.versionNumber}`;
  }
  const versionName = bundle.versionName?.trim();
  if (versionName) return `name:${versionName}`;
  throw new Error("OCI external credential CURRENT bundle has no version identity.");
}

function decodeCanonicalBase64(value: string | undefined): Buffer {
  const raw = value?.trim() ?? "";
  if (!raw || raw.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(raw)) {
    throw new Error("OCI external credential content is not canonical base64.");
  }
  const decoded = Buffer.from(raw, "base64");
  if (!decoded.byteLength || decoded.toString("base64") !== raw) {
    decoded.fill(0);
    throw new Error("OCI external credential content is not canonical base64.");
  }
  return decoded;
}

function decodeUtf8(value: Buffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(value);
  } catch {
    throw new Error("OCI external credential plaintext must be valid UTF-8.");
  }
}

function validatePlaintext(value: string): void {
  if (!value || Buffer.byteLength(value, "utf8") > MAX_PLAINTEXT_SECRET_BYTES || /[\r\n\0]/.test(value)) {
    throw new Error("OCI external credential plaintext is invalid.");
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
