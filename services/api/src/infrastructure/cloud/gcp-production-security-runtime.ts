import {
  createGcpExternalCredentialInspector,
  createGcpManagedKeyInspector,
  type GcpCryptoKeyResource,
  type GcpKmsClientPort,
  type GcpRegionalSecretResource,
  type GcpSecretManagerClientPort,
  type GcpSecretVersionResource,
} from "./gcp-security-inspector-adapter";
import {
  GCP_KSA_PRIMARY_REGION,
  productionCloudContract,
} from "./production-cloud-provider";
import {
  productionKeyManagementContract,
  type InspectProductionManagedKey,
} from "./production-key-management";
import {
  productionExternalSecretStoreContract,
  type InspectProductionExternalSecret,
} from "./production-secret-store";

const METADATA_HOST = "metadata.google.internal";
const METADATA_BASE_URL = `http://${METADATA_HOST}/computeMetadata/v1/instance/service-accounts/default`;
const AUTH_MODE = "metadata-service";
const MAX_PROVIDER_RESPONSE_BYTES = 1024 * 1024;
const REQUEST_TIMEOUT_MS = 5_000;
const TOKEN_REFRESH_SKEW_MS = 60_000;
const FORBIDDEN_CREDENTIAL_ENV_VARS = [
  "GOOGLE_APPLICATION_CREDENTIALS",
  "CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE",
  "GOOGLE_GHA_CREDS_PATH",
  "CAREPOINT_GCP_ACCESS_TOKEN",
  "GCP_ACCESS_TOKEN",
  "GOOGLE_API_KEY",
] as const;
const FORBIDDEN_ENDPOINT_ENV_VARS = [
  "CAREPOINT_GCP_KMS_ENDPOINT",
  "CAREPOINT_GCP_SECRET_MANAGER_ENDPOINT",
  "GOOGLE_CLOUD_KMS_ENDPOINT",
  "GOOGLE_SECRET_MANAGER_ENDPOINT",
] as const;

export type GcpFetch = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface GcpProductionSecurityRuntime {
  inspectManagedKey: InspectProductionManagedKey;
  inspectExternalCredential: InspectProductionExternalSecret;
  serviceAccountEmail: string;
  close(): Promise<void>;
}

export interface CreateGcpProductionSecurityRuntimeOptions {
  fetch?: GcpFetch;
  now?: () => number;
}

type CachedAccessToken = {
  value: string;
  expiresAtMs: number;
};

type MetadataTokenResponse = {
  access_token?: unknown;
  expires_in?: unknown;
  token_type?: unknown;
};

type JsonRecord = Record<string, unknown>;

export async function createProductionGcpSecurityRuntime(
  env: NodeJS.ProcessEnv = process.env,
  options: CreateGcpProductionSecurityRuntimeOptions = {},
): Promise<GcpProductionSecurityRuntime | null> {
  if (env.NODE_ENV !== "production") return null;
  if (env.CAREPOINT_CLOUD_PROVIDER?.trim() !== "gcp") return null;

  const cloud = productionCloudContract(env);
  if (!cloud || cloud.provider !== "gcp") {
    throw new Error("GCP production security runtime requires the GCP production cloud contract.");
  }

  const authMode = required(env, "CAREPOINT_GCP_AUTH_MODE");
  if (authMode !== AUTH_MODE) {
    throw new Error(
      `CAREPOINT_GCP_AUTH_MODE must be '${AUTH_MODE}' for GCP Release 1 production.`,
    );
  }

  for (const name of FORBIDDEN_CREDENTIAL_ENV_VARS) {
    if (env[name]?.trim()) {
      throw new Error(`${name} static credential configuration is forbidden in GCP Release 1 production.`);
    }
  }
  for (const name of FORBIDDEN_ENDPOINT_ENV_VARS) {
    if (env[name]?.trim()) {
      throw new Error(`${name} endpoint overrides are forbidden in GCP Release 1 production.`);
    }
  }

  const projectId = validateProjectId(required(env, "GCP_PROJECT_ID"), "GCP_PROJECT_ID");
  const expectedServiceAccountEmail = validateServiceAccountEmail(
    required(env, "CAREPOINT_GCP_SERVICE_ACCOUNT_EMAIL"),
    projectId,
  );

  const keyContract = productionKeyManagementContract(env);
  if (!keyContract || keyContract.provider !== "gcp-cloud-kms") {
    throw new Error("GCP production security runtime requires the Cloud KMS key-management contract.");
  }
  const secretContract = productionExternalSecretStoreContract(env);
  if (!secretContract || secretContract.provider !== "gcp-secret-manager") {
    throw new Error("GCP production security runtime requires the regional Secret Manager contract.");
  }
  if (keyContract.region !== GCP_KSA_PRIMARY_REGION || secretContract.region !== GCP_KSA_PRIMARY_REGION) {
    throw new Error(`GCP production security runtime must remain in '${GCP_KSA_PRIMARY_REGION}'.`);
  }
  if (secretContract.region !== keyContract.region || secretContract.vaultRef !== keyContract.vaultRef) {
    throw new Error("GCP production key-management and external-secret contracts must share one regional Key Ring.");
  }
  assertProjectOwnership(projectId, keyContract.vaultRef, "CAREPOINT_VAULT_REF");
  for (const domain of keyContract.domains) {
    assertProjectOwnership(projectId, domain.keyRef, domain.label);
  }
  for (const secret of secretContract.secrets) {
    assertProjectOwnership(projectId, secret.secretRef, secret.name);
  }

  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new Error("GCP production security runtime requires a Fetch-compatible runtime.");
  }
  const now = options.now ?? Date.now;

  const metadataEmail = await fetchMetadataText(
    `${METADATA_BASE_URL}/email`,
    "GCP runtime service-account identity",
    fetchImpl,
  );
  if (metadataEmail !== expectedServiceAccountEmail) {
    throw new Error("GCP runtime service-account identity does not match CAREPOINT_GCP_SERVICE_ACCOUNT_EMAIL.");
  }

  let cachedToken: CachedAccessToken | null = null;

  const accessToken = async (): Promise<string> => {
    const currentTime = now();
    if (cachedToken && cachedToken.expiresAtMs - TOKEN_REFRESH_SKEW_MS > currentTime) {
      return cachedToken.value;
    }

    const token = await fetchMetadataJson<MetadataTokenResponse>(
      `${METADATA_BASE_URL}/token`,
      "GCP runtime access token",
      fetchImpl,
    );
    const value = typeof token.access_token === "string" ? token.access_token.trim() : "";
    const type = typeof token.token_type === "string" ? token.token_type.trim().toLowerCase() : "";
    const expiresIn = Number(token.expires_in);
    if (!value || value.length > 8192 || /[\r\n\0]/.test(value)) {
      throw new Error("GCP metadata server returned an invalid access token.");
    }
    if (type !== "bearer") {
      throw new Error("GCP metadata server returned an unsupported token type.");
    }
    if (!Number.isSafeInteger(expiresIn) || expiresIn < 120 || expiresIn > 7200) {
      throw new Error("GCP metadata server returned an invalid token lifetime.");
    }

    cachedToken = {
      value,
      expiresAtMs: currentTime + expiresIn * 1000,
    };
    return value;
  };

  const authorizedJson = async <T extends JsonRecord>(
    url: string,
    label: string,
  ): Promise<T> => {
    const parsed = validateRegionalApiUrl(url, GCP_KSA_PRIMARY_REGION);
    let response: Response;
    try {
      response = await fetchImpl(parsed, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${await accessToken()}`,
          Accept: "application/json",
        },
        redirect: "error",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw new Error(`${label} request failed (${errorName(error)}).`);
    }

    if (!response.ok) {
      throw new Error(`${label} request failed (HTTP ${response.status}).`);
    }
    return parseBoundedJson<T>(response, label);
  };

  const kmsClient: GcpKmsClientPort = {
    getCryptoKey: async ({ name }) => {
      const resource = await authorizedJson<JsonRecord>(
        `https://cloudkms.${GCP_KSA_PRIMARY_REGION}.rep.googleapis.com/v1/${name}`,
        "GCP Cloud KMS CryptoKey inspection",
      );
      return { cryptoKey: normalizeCryptoKey(resource) };
    },
  };

  const secretClient: GcpSecretManagerClientPort = {
    getSecret: async ({ name }) => {
      const resource = await authorizedJson<JsonRecord>(
        `https://secretmanager.${GCP_KSA_PRIMARY_REGION}.rep.googleapis.com/v1/${name}`,
        "GCP Secret Manager secret inspection",
      );
      return { secret: normalizeRegionalSecret(resource) };
    },
    getSecretVersion: async ({ name }) => {
      const resource = await authorizedJson<JsonRecord>(
        `https://secretmanager.${GCP_KSA_PRIMARY_REGION}.rep.googleapis.com/v1/${name}`,
        "GCP Secret Manager version inspection",
      );
      return { secretVersion: normalizeSecretVersion(resource) };
    },
  };

  return {
    inspectManagedKey: createGcpManagedKeyInspector({
      region: GCP_KSA_PRIMARY_REGION,
      client: kmsClient,
    }),
    inspectExternalCredential: createGcpExternalCredentialInspector({
      region: GCP_KSA_PRIMARY_REGION,
      client: secretClient,
    }),
    serviceAccountEmail: expectedServiceAccountEmail,
    close: async () => {
      cachedToken = null;
    },
  };
}

async function fetchMetadataText(
  url: string,
  label: string,
  fetchImpl: GcpFetch,
): Promise<string> {
  validateMetadataUrl(url);
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      headers: { "Metadata-Flavor": "Google" },
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new Error(`${label} lookup failed (${errorName(error)}).`);
  }
  assertMetadataResponse(response, label);
  const text = (await readBoundedText(response, label)).trim();
  if (!text || text.length > 512 || /[\r\n\0]/.test(text)) {
    throw new Error(`${label} returned an invalid value.`);
  }
  return text;
}

async function fetchMetadataJson<T extends JsonRecord>(
  url: string,
  label: string,
  fetchImpl: GcpFetch,
): Promise<T> {
  validateMetadataUrl(url);
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      headers: { "Metadata-Flavor": "Google" },
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new Error(`${label} lookup failed (${errorName(error)}).`);
  }
  assertMetadataResponse(response, label);
  return parseBoundedJson<T>(response, label);
}

function assertMetadataResponse(response: Response, label: string): void {
  if (!response.ok) {
    throw new Error(`${label} lookup failed (HTTP ${response.status}).`);
  }
  const flavor = response.headers.get("metadata-flavor")?.trim().toLowerCase();
  if (flavor !== "google") {
    throw new Error(`${label} response is missing the Google metadata trust marker.`);
  }
}

async function parseBoundedJson<T extends JsonRecord>(response: Response, label: string): Promise<T> {
  const raw = await readBoundedText(response, label);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${label} returned invalid JSON.`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} returned an invalid JSON object.`);
  }
  return parsed as T;
}

async function readBoundedText(response: Response, label: string): Promise<string> {
  const contentLength = response.headers.get("content-length");
  if (contentLength) {
    const parsedLength = Number(contentLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 0 || parsedLength > MAX_PROVIDER_RESPONSE_BYTES) {
      throw new Error(`${label} response exceeds the permitted size.`);
    }
  }

  const body = response.body;
  if (!body) return "";

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_PROVIDER_RESPONSE_BYTES) {
        throw new Error(`${label} response exceeds the permitted size.`);
      }
      chunks.push(value);
    }
  } catch (error) {
    try {
      await reader.cancel();
    } catch {
      // Preserve the original provider/read error.
    }
    throw error;
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), totalBytes).toString("utf8");
}

function normalizeCryptoKey(resource: JsonRecord): GcpCryptoKeyResource {
  const name = stringValue(resource.name);
  const purpose = stringValue(resource.purpose);
  const primary = objectRecord(resource.primary);
  const primaryState = primary ? stringValue(primary.state) : undefined;
  const protectionLevel = primary ? stringValue(primary.protectionLevel) : undefined;
  const normalizedPrimary = primary
    ? {
        ...(primaryState ? { state: primaryState } : {}),
        ...(protectionLevel ? { protectionLevel } : {}),
      }
    : undefined;
  const rotationSeconds = parseDurationSeconds(resource.rotationPeriod);

  return {
    ...(name ? { name } : {}),
    ...(purpose ? { purpose } : {}),
    ...(normalizedPrimary ? { primary: normalizedPrimary } : {}),
    ...(rotationSeconds ? { rotationPeriod: { seconds: rotationSeconds } } : {}),
  };
}

function normalizeRegionalSecret(resource: JsonRecord): GcpRegionalSecretResource {
  const name = stringValue(resource.name);
  const encryption = objectRecord(resource.customerManagedEncryption);
  const kmsKeyName = encryption ? stringValue(encryption.kmsKeyName) : undefined;

  return {
    ...(name ? { name } : {}),
    ...(kmsKeyName ? { customerManagedEncryption: { kmsKeyName } } : {}),
  };
}

function normalizeSecretVersion(resource: JsonRecord): GcpSecretVersionResource {
  const name = stringValue(resource.name);
  const state = stringValue(resource.state);
  return {
    ...(name ? { name } : {}),
    ...(state ? { state } : {}),
  };
}

function parseDurationSeconds(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const match = /^(\d+)s$/.exec(value.trim());
  if (!match?.[1]) return undefined;
  const seconds = Number(match[1]);
  return Number.isSafeInteger(seconds) && seconds > 0 ? String(seconds) : undefined;
}

function validateRegionalApiUrl(value: string, region: string): URL {
  const url = new URL(value);
  const allowedHosts = new Set([
    `cloudkms.${region}.rep.googleapis.com`,
    `secretmanager.${region}.rep.googleapis.com`,
  ]);
  if (url.protocol !== "https:" || !allowedHosts.has(url.hostname.toLowerCase())) {
    throw new Error("GCP production security runtime attempted to use an unapproved API endpoint.");
  }
  if (url.username || url.password || (url.port && url.port !== "443") || url.search || url.hash) {
    throw new Error("GCP production security runtime API endpoint contains forbidden URL components.");
  }
  return url;
}

function validateMetadataUrl(value: string): void {
  const url = new URL(value);
  if (
    url.protocol !== "http:"
    || url.hostname !== METADATA_HOST
    || url.port
    || url.username
    || url.password
    || url.search
    || url.hash
    || !url.pathname.startsWith("/computeMetadata/v1/instance/service-accounts/default/")
  ) {
    throw new Error("GCP metadata-service URL is invalid.");
  }
}

function validateProjectId(value: string, name: string): string {
  const trimmed = value.trim();
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(trimmed)) {
    throw new Error(`${name} must be a valid GCP project id.`);
  }
  return trimmed;
}

function validateServiceAccountEmail(value: string, projectId: string): string {
  const trimmed = value.trim().toLowerCase();
  const match = /^([a-z][a-z0-9-]{4,28}[a-z0-9])@([a-z][a-z0-9-]{4,28}[a-z0-9])\.iam\.gserviceaccount\.com$/.exec(trimmed);
  if (!match?.[2]) {
    throw new Error("CAREPOINT_GCP_SERVICE_ACCOUNT_EMAIL must be a GCP service-account email.");
  }
  if (match[2] !== projectId) {
    throw new Error("CAREPOINT_GCP_SERVICE_ACCOUNT_EMAIL must belong to GCP_PROJECT_ID.");
  }
  return trimmed;
}

function assertProjectOwnership(projectId: string, resourceRef: string, label: string): void {
  if (!resourceRef.startsWith(`projects/${projectId}/`)) {
    throw new Error(`GCP resource '${label}' must belong to GCP_PROJECT_ID.`);
  }
}

function objectRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required in GCP Release 1 production.`);
  return value;
}

function errorName(error: unknown): string {
  if (error instanceof Error && error.name) {
    return error.name.replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 80) || "GcpRuntimeError";
  }
  return "GcpRuntimeError";
}
