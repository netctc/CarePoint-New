import {
  createOciExternalCredentialInspector,
  createOciManagedKeyInspector,
  type OciExternalCredentialInspectorOptions,
  type OciKeyManagementClientPort,
  type OciKeyResource,
  type OciSecretBundleResource,
  type OciSecretResource,
  type OciSecretsClientPort,
} from "./oci-security-inspector-adapter";
import {
  productionKeyManagementContract,
  type InspectProductionManagedKey,
} from "./production-key-management";
import {
  productionExternalSecretStoreContract,
  type InspectProductionExternalSecret,
} from "./production-secret-store";

const INSTANCE_PRINCIPAL_AUTH_MODE = "instance-principal";
const FORBIDDEN_ENDPOINT_ENV_VARS = [
  "CAREPOINT_OCI_KMS_ENDPOINT",
  "CAREPOINT_OCI_VAULT_ENDPOINT",
  "CAREPOINT_OCI_SECRETS_ENDPOINT",
] as const;

type OciAuthenticationProvider = unknown;

type OciVaultResource = {
  id?: string;
  lifecycleState?: string;
  managementEndpoint?: string;
};

export interface OciVaultDiscoveryClient {
  regionId: string;
  getVault(request: { vaultId: string }): Promise<{ vault?: OciVaultResource }>;
  close(): void;
}

export interface OciKmsManagementClient {
  endpoint: string;
  getKey(request: { keyId: string }): Promise<{ key?: OciKeyResource }>;
  close(): void;
}

export interface OciVaultSecretsMetadataClient {
  regionId: string;
  getSecret(request: { secretId: string }): Promise<{ secret?: OciSecretResource }>;
  close(): void;
}

export interface OciSecretsBundleClient {
  regionId: string;
  getSecretBundle(request: {
    secretId: string;
    stage: "CURRENT";
  }): Promise<{ secretBundle?: OciSecretBundleResource }>;
  close(): void;
}

export interface OciProductionSecuritySdkFactory {
  buildInstancePrincipal(): Promise<OciAuthenticationProvider>;
  createVaultDiscoveryClient(provider: OciAuthenticationProvider): OciVaultDiscoveryClient;
  createKmsManagementClient(provider: OciAuthenticationProvider): OciKmsManagementClient;
  createVaultSecretsMetadataClient(provider: OciAuthenticationProvider): OciVaultSecretsMetadataClient;
  createSecretsBundleClient(provider: OciAuthenticationProvider): OciSecretsBundleClient;
}

export interface OciProductionSecurityRuntime {
  inspectManagedKey: InspectProductionManagedKey;
  inspectExternalCredential: InspectProductionExternalSecret;
  close(): Promise<void>;
}

export interface CreateOciProductionSecurityRuntimeOptions {
  sdkFactory?: OciProductionSecuritySdkFactory;
}

export async function createProductionOciSecurityRuntime(
  env: NodeJS.ProcessEnv = process.env,
  options: CreateOciProductionSecurityRuntimeOptions = {},
): Promise<OciProductionSecurityRuntime | null> {
  if (env.NODE_ENV !== "production") return null;
  if (env.CAREPOINT_CLOUD_PROVIDER?.trim() !== "oci") return null;

  const authMode = required(env, "CAREPOINT_OCI_AUTH_MODE");
  if (authMode !== INSTANCE_PRINCIPAL_AUTH_MODE) {
    throw new Error(
      `CAREPOINT_OCI_AUTH_MODE must be '${INSTANCE_PRINCIPAL_AUTH_MODE}' for OCI Release 1 production.`,
    );
  }
  for (const name of FORBIDDEN_ENDPOINT_ENV_VARS) {
    if (env[name]?.trim()) {
      throw new Error(`${name} endpoint overrides are forbidden in OCI Release 1 production.`);
    }
  }

  const keyContract = productionKeyManagementContract(env);
  if (!keyContract || keyContract.provider !== "oci-vault-kms") {
    throw new Error("OCI production security runtime requires the OCI Vault/KMS key-management contract.");
  }
  const secretContract = productionExternalSecretStoreContract(env);
  if (!secretContract || secretContract.provider !== "oci-vault-secrets") {
    throw new Error("OCI production security runtime requires the OCI Vault Secrets contract.");
  }
  if (secretContract.vaultRef !== keyContract.vaultRef) {
    throw new Error("OCI production key-management and external-secret contracts must use the same Vault.");
  }
  if (secretContract.region !== keyContract.region) {
    throw new Error("OCI production key-management and external-secret contracts must use the same active region.");
  }

  const sdkFactory = options.sdkFactory ?? loadDefaultSdkFactory();
  let provider: OciAuthenticationProvider;
  try {
    provider = await sdkFactory.buildInstancePrincipal();
  } catch (error) {
    throw new Error(`OCI instance-principal authentication initialization failed (${errorName(error)}).`);
  }

  const clients: Array<{ close(): void }> = [];
  try {
    const vaultDiscovery = sdkFactory.createVaultDiscoveryClient(provider);
    clients.push(vaultDiscovery);
    vaultDiscovery.regionId = keyContract.region;

    let vaultResource: OciVaultResource | undefined;
    try {
      vaultResource = (await vaultDiscovery.getVault({ vaultId: keyContract.vaultRef })).vault;
    } catch (error) {
      throw new Error(`OCI Vault discovery failed (${errorName(error)}).`);
    }
    const managementEndpoint = validateVaultResource(
      vaultResource,
      keyContract.vaultRef,
      keyContract.region,
    );

    const kmsManagement = sdkFactory.createKmsManagementClient(provider);
    clients.push(kmsManagement);
    kmsManagement.endpoint = managementEndpoint;

    const vaultSecrets = sdkFactory.createVaultSecretsMetadataClient(provider);
    clients.push(vaultSecrets);
    vaultSecrets.regionId = keyContract.region;

    const secretBundles = sdkFactory.createSecretsBundleClient(provider);
    clients.push(secretBundles);
    secretBundles.regionId = keyContract.region;

    const keyPort: OciKeyManagementClientPort = {
      getKey: async ({ keyId }) => kmsManagement.getKey({ keyId }),
    };
    const secretsPort: OciSecretsClientPort = {
      getSecret: async ({ secretId }) => vaultSecrets.getSecret({ secretId }),
      getSecretBundle: async ({ secretId, stage }) => secretBundles.getSecretBundle({
        secretId,
        stage,
      }),
    };

    return {
      inspectManagedKey: createOciManagedKeyInspector({
        region: keyContract.region,
        client: keyPort,
      }),
      inspectExternalCredential: createOciExternalCredentialInspector({
        region: keyContract.region,
        client: secretsPort,
      } satisfies OciExternalCredentialInspectorOptions),
      close: async () => {
        closeClients(clients);
        closeProvider(provider);
      },
    };
  } catch (error) {
    closeClients(clients);
    closeProvider(provider);
    throw error;
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
  return validateManagementEndpoint(resource.managementEndpoint, region);
}

function validateManagementEndpoint(value: string | undefined, region: string): string {
  const raw = value?.trim();
  if (!raw) throw new Error("OCI production Vault must expose a management endpoint.");

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("OCI production Vault management endpoint is invalid.");
  }
  const hostname = url.hostname.toLowerCase();
  if (url.protocol !== "https:") {
    throw new Error("OCI production Vault management endpoint must use HTTPS.");
  }
  if (url.username || url.password || (url.port && url.port !== "443")) {
    throw new Error("OCI production Vault management endpoint contains forbidden authority components.");
  }
  if (!hostname.endsWith(".oraclecloud.com")) {
    throw new Error("OCI production Vault management endpoint must use an oraclecloud.com host.");
  }
  if (!hostname.includes(`.${region.toLowerCase()}.`)) {
    throw new Error("OCI production Vault management endpoint does not match the configured active region.");
  }
  if ((url.pathname && url.pathname !== "/") || url.search || url.hash) {
    throw new Error("OCI production Vault management endpoint must not include a path, query or fragment.");
  }
  return url.origin;
}

function loadDefaultSdkFactory(): OciProductionSecuritySdkFactory {
  try {
    // Runtime requires are intentional: non-OCI deployments never initialize OCI SDK clients.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const common = require("oci-common") as {
      InstancePrincipalsAuthenticationDetailsProvider: {
        builder(): { build(): Promise<OciAuthenticationProvider> };
      };
    };
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const keymanagement = require("oci-keymanagement") as {
      KmsVaultClient: new (args: { authenticationDetailsProvider: OciAuthenticationProvider }) => OciVaultDiscoveryClient;
      KmsManagementClient: new (args: { authenticationDetailsProvider: OciAuthenticationProvider }) => OciKmsManagementClient;
    };
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const vault = require("oci-vault") as {
      VaultsClient: new (args: { authenticationDetailsProvider: OciAuthenticationProvider }) => OciVaultSecretsMetadataClient;
    };
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const secrets = require("oci-secrets") as {
      SecretsClient: new (args: { authenticationDetailsProvider: OciAuthenticationProvider }) => OciSecretsBundleClient;
    };

    return {
      buildInstancePrincipal: () => common.InstancePrincipalsAuthenticationDetailsProvider.builder().build(),
      createVaultDiscoveryClient: (provider) => new keymanagement.KmsVaultClient({
        authenticationDetailsProvider: provider,
      }),
      createKmsManagementClient: (provider) => new keymanagement.KmsManagementClient({
        authenticationDetailsProvider: provider,
      }),
      createVaultSecretsMetadataClient: (provider) => new vault.VaultsClient({
        authenticationDetailsProvider: provider,
      }),
      createSecretsBundleClient: (provider) => new secrets.SecretsClient({
        authenticationDetailsProvider: provider,
      }),
    };
  } catch (error) {
    throw new Error(`OCI SDK modules could not be loaded (${errorName(error)}).`);
  }
}

function closeClients(clients: readonly { close(): void }[]): void {
  for (const client of [...clients].reverse()) {
    try {
      client.close();
    } catch {
      // Startup failure handling must not mask the original fail-closed reason.
    }
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

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required in OCI Release 1 production.`);
  return value;
}

function errorName(error: unknown): string {
  if (error instanceof Error && error.name) {
    return error.name.replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 80) || "OciSdkError";
  }
  return "OciSdkError";
}
