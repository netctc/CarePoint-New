import { productionKeyManagementContract } from "../cloud/production-key-management";

const INSTANCE_PRINCIPAL_AUTH_MODE = "instance-principal";
const OCI_RSA_SIGNING_ALGORITHM = "SHA_256_RSA_PKCS_PSS";
const OCI_ECDSA_SIGNING_ALGORITHM = "ECDSA_SHA_256";
const OCI_MESSAGE_TYPE = "DIGEST";
const SIGNATURE_ENVELOPE_PREFIX = "OCI1";
const FORBIDDEN_ENDPOINT_ENV_VARS = [
  "CAREPOINT_OCI_KMS_ENDPOINT",
  "CAREPOINT_OCI_VAULT_ENDPOINT",
  "CAREPOINT_OCI_SECRETS_ENDPOINT",
] as const;

export type OciDocumentSigningAlgorithm =
  | "OCI-KMS-RSA-PSS-SHA256"
  | "OCI-KMS-ECDSA-SHA256";

type OciSigningAlgorithm =
  | typeof OCI_RSA_SIGNING_ALGORITHM
  | typeof OCI_ECDSA_SIGNING_ALGORITHM;

type OciAuthenticationProvider = unknown;

type OciVaultResource = {
  id?: string;
  lifecycleState?: string;
  managementEndpoint?: string;
  cryptoEndpoint?: string;
};

type OciKeyResource = {
  id?: string;
  vaultId?: string;
  lifecycleState?: string;
  protectionMode?: string;
  keyShape?: { algorithm?: string };
};

type OciSignedData = {
  keyId?: string;
  keyVersionId?: string;
  signature?: string;
  signingAlgorithm?: string;
};

type OciVerifiedData = {
  isSignatureValid?: boolean;
};

export interface OciSigningVaultClient {
  regionId: string;
  getVault(request: { vaultId: string }): Promise<{ vault?: OciVaultResource }>;
  close(): void;
}

export interface OciSigningManagementClient {
  endpoint: string;
  getKey(request: { keyId: string }): Promise<{ key?: OciKeyResource }>;
  close(): void;
}

export interface OciSigningCryptoClient {
  endpoint: string;
  sign(request: {
    signDataDetails: {
      keyId: string;
      message: string;
      messageType: "DIGEST";
      signingAlgorithm: OciSigningAlgorithm;
    };
  }): Promise<{ signedData?: OciSignedData }>;
  verify(request: {
    verifyDataDetails: {
      keyId: string;
      keyVersionId: string;
      signature: string;
      message: string;
      messageType: "DIGEST";
      signingAlgorithm: OciSigningAlgorithm;
    };
  }): Promise<{ verifiedData?: OciVerifiedData }>;
  close(): void;
}

export interface OciKmsSigningSdkFactory {
  buildInstancePrincipal(): Promise<OciAuthenticationProvider>;
  createVaultDiscoveryClient(provider: OciAuthenticationProvider): OciSigningVaultClient;
  createManagementClient(provider: OciAuthenticationProvider): OciSigningManagementClient;
  createCryptoClient(provider: OciAuthenticationProvider): OciSigningCryptoClient;
}

export type OciKmsSigningProviderOptions = {
  sdkFactory?: OciKmsSigningSdkFactory;
};

type SigningRuntime = {
  provider: OciAuthenticationProvider;
  client: OciSigningCryptoClient;
  signingAlgorithm: OciSigningAlgorithm;
  applicationAlgorithm: OciDocumentSigningAlgorithm;
};

export type OciDocumentSignature = {
  algorithm: OciDocumentSigningAlgorithm;
  keyId: string;
  signature: string;
};

/**
 * OCI Vault KMS asymmetric signing adapter for diagnostic-report attestations.
 *
 * The persisted signature is an opaque envelope containing the OCI key-version
 * OCID plus the provider signature. This keeps signatureKeyId as the stable key
 * OCID while retaining the exact key version required by OCI Verify after key
 * rotation, without a schema migration.
 */
export class OciKmsSigningProvider {
  private runtimePromise?: Promise<SigningRuntime>;

  constructor(
    private readonly keyId: string,
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly options: OciKmsSigningProviderOptions = {},
  ) {
    if (!keyId.trim()) throw new Error("OCI KMS signing key id is required.");
  }

  async signDigest(payloadDigestHex: string): Promise<OciDocumentSignature> {
    const message = digestMessage(payloadDigestHex);
    const runtime = await this.runtime();

    let response: { signedData?: OciSignedData };
    try {
      response = await runtime.client.sign({
        signDataDetails: {
          keyId: this.keyId,
          message,
          messageType: OCI_MESSAGE_TYPE,
          signingAlgorithm: runtime.signingAlgorithm,
        },
      });
    } catch (error) {
      throw new Error(`OCI KMS signing failed (${errorName(error)}).`);
    }

    const signed = response.signedData;
    if (!signed) throw new Error("OCI KMS signing returned no signed-data response.");
    validateResponseKey(signed.keyId, this.keyId);
    validateResponseSigningAlgorithm(signed.signingAlgorithm, runtime.signingAlgorithm);
    const keyVersionId = validateKeyVersionId(signed.keyVersionId);
    const signature = validateCanonicalBase64(signed.signature, "OCI KMS signature");

    return {
      algorithm: runtime.applicationAlgorithm,
      keyId: this.keyId,
      signature: encodeSignatureEnvelope(keyVersionId, signature),
    };
  }

  async verifyDigest(
    payloadDigestHex: string,
    persistedSignature: string,
    algorithm: string | null | undefined,
  ): Promise<boolean> {
    const message = digestMessage(payloadDigestHex);
    const storedAlgorithm = applicationAlgorithmToOci(algorithm);
    if (!storedAlgorithm) return false;

    const envelope = decodeSignatureEnvelope(persistedSignature);
    if (!envelope) return false;

    const runtime = await this.runtime();
    if (storedAlgorithm.signingAlgorithm !== runtime.signingAlgorithm) return false;

    let response: { verifiedData?: OciVerifiedData };
    try {
      response = await runtime.client.verify({
        verifyDataDetails: {
          keyId: this.keyId,
          keyVersionId: envelope.keyVersionId,
          signature: envelope.signature,
          message,
          messageType: OCI_MESSAGE_TYPE,
          signingAlgorithm: runtime.signingAlgorithm,
        },
      });
    } catch (error) {
      throw new Error(`OCI KMS signature verification failed (${errorName(error)}).`);
    }

    return response.verifiedData?.isSignatureValid === true;
  }

  async close(): Promise<void> {
    const pending = this.runtimePromise;
    this.runtimePromise = undefined;
    if (!pending) return;
    try {
      const runtime = await pending;
      closeClient(runtime.client);
      closeProvider(runtime.provider);
    } catch {
      // Initialization already performed best-effort cleanup on failure.
    }
  }

  private async runtime(): Promise<SigningRuntime> {
    if (!this.runtimePromise) this.runtimePromise = this.initializeRuntime();
    return this.runtimePromise;
  }

  private async initializeRuntime(): Promise<SigningRuntime> {
    if (this.env.NODE_ENV !== "production" || this.env.CAREPOINT_CLOUD_PROVIDER?.trim() !== "oci") {
      throw new Error("OCI KMS signing provider is restricted to OCI production.");
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
      throw new Error("OCI KMS signing provider requires the OCI Vault/KMS production contract.");
    }
    const domain = contract.domains.find((candidate) => candidate.label === "clinical-document-attestation");
    if (!domain || domain.keyRef !== this.keyId || domain.usage !== "sign-verify") {
      throw new Error("OCI KMS signing key is not the approved clinical-document sign-verify key reference.");
    }

    const sdkFactory = this.options.sdkFactory ?? loadDefaultSdkFactory();
    let provider: OciAuthenticationProvider;
    try {
      provider = await sdkFactory.buildInstancePrincipal();
    } catch (error) {
      throw new Error(`OCI instance-principal authentication initialization failed (${errorName(error)}).`);
    }

    let discovery: OciSigningVaultClient | undefined;
    let management: OciSigningManagementClient | undefined;
    let crypto: OciSigningCryptoClient | undefined;
    try {
      discovery = sdkFactory.createVaultDiscoveryClient(provider);
      discovery.regionId = contract.region;

      let vault: OciVaultResource | undefined;
      try {
        vault = (await discovery.getVault({ vaultId: contract.vaultRef })).vault;
      } catch (error) {
        throw new Error(`OCI Vault discovery failed (${errorName(error)}).`);
      }
      const endpoints = validateVaultResource(vault, contract.vaultRef, contract.region);
      closeClient(discovery);
      discovery = undefined;

      management = sdkFactory.createManagementClient(provider);
      management.endpoint = endpoints.management;
      let key: OciKeyResource | undefined;
      try {
        key = (await management.getKey({ keyId: this.keyId })).key;
      } catch (error) {
        throw new Error(`OCI signing-key inspection failed (${errorName(error)}).`);
      }
      const algorithm = validateSigningKey(key, this.keyId, contract.vaultRef);
      closeClient(management);
      management = undefined;

      crypto = sdkFactory.createCryptoClient(provider);
      crypto.endpoint = endpoints.crypto;
      return {
        provider,
        client: crypto,
        signingAlgorithm: algorithm.signingAlgorithm,
        applicationAlgorithm: algorithm.applicationAlgorithm,
      };
    } catch (error) {
      closeClient(discovery);
      closeClient(management);
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
): { management: string; crypto: string } {
  if (!resource) throw new Error("OCI Vault discovery returned no Vault resource.");
  if (resource.id?.trim() !== expectedVaultRef) {
    throw new Error("OCI Vault discovery returned a Vault that does not match CAREPOINT_VAULT_REF.");
  }
  if (resource.lifecycleState?.trim().toUpperCase() !== "ACTIVE") {
    throw new Error("OCI production Vault must be in ACTIVE lifecycle state.");
  }
  return {
    management: validateVaultEndpoint(resource.managementEndpoint, region, "management"),
    crypto: validateVaultEndpoint(resource.cryptoEndpoint, region, "crypto"),
  };
}

function validateVaultEndpoint(value: string | undefined, region: string, kind: string): string {
  const raw = value?.trim();
  if (!raw) throw new Error(`OCI production Vault must expose a ${kind} endpoint.`);

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`OCI production Vault ${kind} endpoint is invalid.`);
  }
  const hostname = url.hostname.toLowerCase();
  if (url.protocol !== "https:") {
    throw new Error(`OCI production Vault ${kind} endpoint must use HTTPS.`);
  }
  if (url.username || url.password || (url.port && url.port !== "443")) {
    throw new Error(`OCI production Vault ${kind} endpoint contains forbidden authority components.`);
  }
  if (!hostname.endsWith(".oraclecloud.com")) {
    throw new Error(`OCI production Vault ${kind} endpoint must use an oraclecloud.com host.`);
  }
  if (!hostname.includes(`.${region.toLowerCase()}.`)) {
    throw new Error(`OCI production Vault ${kind} endpoint does not match the configured active region.`);
  }
  if ((url.pathname && url.pathname !== "/") || url.search || url.hash) {
    throw new Error(`OCI production Vault ${kind} endpoint must not include a path, query or fragment.`);
  }
  return url.origin;
}

function validateSigningKey(
  key: OciKeyResource | undefined,
  expectedKeyId: string,
  expectedVaultRef: string,
): { signingAlgorithm: OciSigningAlgorithm; applicationAlgorithm: OciDocumentSigningAlgorithm } {
  if (!key) throw new Error("OCI Key Management returned no signing key resource.");
  if (key.id?.trim() !== expectedKeyId) throw new Error("OCI signing-key inspection returned an unexpected key id.");
  if (key.vaultId?.trim() !== expectedVaultRef) throw new Error("OCI signing key does not belong to CAREPOINT_VAULT_REF.");
  if (key.lifecycleState?.trim().toUpperCase() !== "ENABLED") {
    throw new Error("OCI production signing key must be in ENABLED lifecycle state.");
  }
  const protectionMode = key.protectionMode?.trim().toUpperCase();
  if (protectionMode !== "HSM" && protectionMode !== "SOFTWARE") {
    throw new Error("OCI production signing key must be customer-managed in HSM or SOFTWARE protection mode.");
  }
  const shape = key.keyShape?.algorithm?.trim().toUpperCase();
  if (shape === "RSA") {
    return {
      signingAlgorithm: OCI_RSA_SIGNING_ALGORITHM,
      applicationAlgorithm: "OCI-KMS-RSA-PSS-SHA256",
    };
  }
  if (shape === "ECDSA") {
    return {
      signingAlgorithm: OCI_ECDSA_SIGNING_ALGORITHM,
      applicationAlgorithm: "OCI-KMS-ECDSA-SHA256",
    };
  }
  throw new Error("OCI production signing key must use an RSA or ECDSA asymmetric key shape.");
}

function digestMessage(payloadDigestHex: string): string {
  const digest = payloadDigestHex.trim();
  if (!/^[a-fA-F0-9]{64}$/.test(digest)) {
    throw new Error("Document attestation payload digest must be a SHA-256 hexadecimal digest.");
  }
  return Buffer.from(digest, "hex").toString("base64");
}

function encodeSignatureEnvelope(keyVersionId: string, signature: string): string {
  return `${SIGNATURE_ENVELOPE_PREFIX}|${keyVersionId}|${signature}`;
}

function decodeSignatureEnvelope(value: string): { keyVersionId: string; signature: string } | null {
  const parts = value.split("|");
  if (parts.length !== 3 || parts[0] !== SIGNATURE_ENVELOPE_PREFIX) return null;
  try {
    return {
      keyVersionId: validateKeyVersionId(parts[1]),
      signature: validateCanonicalBase64(parts[2], "OCI KMS signature"),
    };
  } catch {
    return null;
  }
}

function validateKeyVersionId(value: string | undefined): string {
  const ref = value?.trim() ?? "";
  if (!ref.startsWith("ocid1.keyversion.") || ref.length <= "ocid1.keyversion.".length + 8 || /\s/.test(ref)) {
    throw new Error("OCI KMS signing response returned an invalid key-version OCID.");
  }
  return ref;
}

function validateCanonicalBase64(value: string | undefined, label: string): string {
  const raw = value?.trim() ?? "";
  if (!raw || raw.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(raw)) {
    throw new Error(`${label} is not canonical base64.`);
  }
  const decoded = Buffer.from(raw, "base64");
  if (!decoded.byteLength || decoded.toString("base64") !== raw) {
    throw new Error(`${label} is not canonical base64.`);
  }
  return raw;
}

function validateResponseKey(value: string | undefined, expected: string): void {
  if (value?.trim() !== expected) throw new Error("OCI KMS signing response references an unexpected key id.");
}

function validateResponseSigningAlgorithm(value: string | undefined, expected: OciSigningAlgorithm): void {
  if (value?.trim() !== expected) throw new Error("OCI KMS signing response used an unexpected signing algorithm.");
}

function applicationAlgorithmToOci(
  value: string | null | undefined,
): { signingAlgorithm: OciSigningAlgorithm } | null {
  if (value === "OCI-KMS-RSA-PSS-SHA256") return { signingAlgorithm: OCI_RSA_SIGNING_ALGORITHM };
  if (value === "OCI-KMS-ECDSA-SHA256") return { signingAlgorithm: OCI_ECDSA_SIGNING_ALGORITHM };
  return null;
}

function loadDefaultSdkFactory(): OciKmsSigningSdkFactory {
  try {
    // Runtime requires are intentional: non-OCI paths do not initialize OCI SDK modules.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const common = require("oci-common") as {
      InstancePrincipalsAuthenticationDetailsProvider: {
        builder(): { build(): Promise<OciAuthenticationProvider> };
      };
    };
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const keymanagement = require("oci-keymanagement") as {
      KmsVaultClient: new (args: { authenticationDetailsProvider: OciAuthenticationProvider }) => OciSigningVaultClient;
      KmsManagementClient: new (args: { authenticationDetailsProvider: OciAuthenticationProvider }) => OciSigningManagementClient;
      KmsCryptoClient: new (args: { authenticationDetailsProvider: OciAuthenticationProvider }) => OciSigningCryptoClient;
    };

    return {
      buildInstancePrincipal: () => common.InstancePrincipalsAuthenticationDetailsProvider.builder().build(),
      createVaultDiscoveryClient: (provider) => new keymanagement.KmsVaultClient({ authenticationDetailsProvider: provider }),
      createManagementClient: (provider) => new keymanagement.KmsManagementClient({ authenticationDetailsProvider: provider }),
      createCryptoClient: (provider) => new keymanagement.KmsCryptoClient({ authenticationDetailsProvider: provider }),
    };
  } catch (error) {
    throw new Error(`OCI SDK modules could not be loaded (${errorName(error)}).`);
  }
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
