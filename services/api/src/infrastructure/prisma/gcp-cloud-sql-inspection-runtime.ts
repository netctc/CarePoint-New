import { GCP_KSA_PRIMARY_REGION, productionCloudContract } from "../cloud/production-cloud-provider";

const METADATA_HOST = "metadata.google.internal";
const METADATA_BASE_URL = `http://${METADATA_HOST}/computeMetadata/v1/instance/service-accounts/default`;
const SQLADMIN_HOST = "sqladmin.googleapis.com";
const AUTH_MODE = "metadata-service";
const REQUEST_TIMEOUT_MS = 5_000;
const MAX_PROVIDER_RESPONSE_BYTES = 1024 * 1024;
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
  "CAREPOINT_GCP_SQLADMIN_ENDPOINT",
  "GOOGLE_CLOUD_SQL_ENDPOINT",
] as const;

type JsonRecord = Record<string, unknown>;
type CachedAccessToken = { value: string; expiresAtMs: number };
type MetadataTokenResponse = {
  access_token?: unknown;
  expires_in?: unknown;
  token_type?: unknown;
};

export type GcpCloudSqlInspection = {
  projectId: string;
  instanceId: string;
  region: string;
  state: string;
  databaseVersion: string;
  availabilityType: string;
  backupEnabled: boolean;
  pointInTimeRecoveryEnabled: boolean;
  publicIpv4Enabled: boolean;
  privateNetworkConfigured: boolean;
  pscEnabled: boolean;
  sslMode: string;
  requireSsl: boolean;
};

export type InspectGcpCloudSqlInstance = () => Promise<GcpCloudSqlInspection>;

export interface GcpCloudSqlInspectionRuntime {
  inspectInstance: InspectGcpCloudSqlInstance;
  serviceAccountEmail: string;
  close(): Promise<void>;
}

export type GcpCloudSqlFetch = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface CreateGcpCloudSqlInspectionRuntimeOptions {
  fetch?: GcpCloudSqlFetch;
  now?: () => number;
}

export async function createProductionGcpCloudSqlInspectionRuntime(
  env: NodeJS.ProcessEnv = process.env,
  options: CreateGcpCloudSqlInspectionRuntimeOptions = {},
): Promise<GcpCloudSqlInspectionRuntime | null> {
  if (env.NODE_ENV !== "production" || env.CAREPOINT_CLOUD_PROVIDER?.trim() !== "gcp") return null;

  const cloud = productionCloudContract(env);
  if (!cloud || cloud.provider !== "gcp" || cloud.primaryRegion !== GCP_KSA_PRIMARY_REGION) {
    throw new Error("GCP Cloud SQL inspection runtime requires the approved GCP KSA production cloud contract.");
  }

  if (required(env, "CAREPOINT_GCP_AUTH_MODE") !== AUTH_MODE) {
    throw new Error(`CAREPOINT_GCP_AUTH_MODE must be '${AUTH_MODE}' for GCP Release 1 production.`);
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

  const projectId = validateProjectId(required(env, "GCP_PROJECT_ID"));
  const instanceId = validateInstanceId(required(env, "CAREPOINT_GCP_CLOUD_SQL_INSTANCE"));
  const expectedServiceAccountEmail = validateServiceAccountEmail(
    required(env, "CAREPOINT_GCP_SERVICE_ACCOUNT_EMAIL"),
    projectId,
  );

  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new Error("GCP Cloud SQL inspection runtime requires a Fetch-compatible runtime.");
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
    cachedToken = { value, expiresAtMs: currentTime + expiresIn * 1000 };
    return value;
  };

  const inspectInstance: InspectGcpCloudSqlInstance = async () => {
    const url = new URL(
      `https://${SQLADMIN_HOST}/sql/v1beta4/projects/${encodeURIComponent(projectId)}/instances/${encodeURIComponent(instanceId)}`,
    );
    validateSqlAdminUrl(url, projectId, instanceId);

    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${await accessToken()}`,
          Accept: "application/json",
        },
        redirect: "error",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw new Error(`GCP Cloud SQL inspection request failed (${errorName(error)}).`);
    }
    if (!response.ok) {
      throw new Error(`GCP Cloud SQL inspection request failed (HTTP ${response.status}).`);
    }

    const resource = await parseBoundedJson<JsonRecord>(response, "GCP Cloud SQL inspection");
    return normalizeCloudSqlInspection(resource, projectId, instanceId);
  };

  return {
    inspectInstance,
    serviceAccountEmail: expectedServiceAccountEmail,
    close: async () => {
      cachedToken = null;
    },
  };
}

function normalizeCloudSqlInspection(
  resource: JsonRecord,
  projectId: string,
  instanceId: string,
): GcpCloudSqlInspection {
  const settings = objectRecord(resource.settings);
  const backup = settings ? objectRecord(settings.backupConfiguration) : null;
  const ip = settings ? objectRecord(settings.ipConfiguration) : null;
  const psc = ip ? objectRecord(ip.pscConfig) : null;

  return {
    projectId: stringValue(resource.project),
    instanceId: stringValue(resource.name),
    region: stringValue(resource.region).toLowerCase(),
    state: stringValue(resource.state).toUpperCase(),
    databaseVersion: stringValue(resource.databaseVersion).toUpperCase(),
    availabilityType: settings ? stringValue(settings.availabilityType).toUpperCase() : "",
    backupEnabled: backup?.enabled === true,
    pointInTimeRecoveryEnabled: backup?.pointInTimeRecoveryEnabled === true,
    publicIpv4Enabled: ip?.ipv4Enabled === true,
    privateNetworkConfigured: Boolean(ip && stringValue(ip.privateNetwork)),
    pscEnabled: psc?.pscEnabled === true,
    sslMode: ip ? stringValue(ip.sslMode).toUpperCase() : "",
    requireSsl: ip?.requireSsl === true,
  };
}

async function fetchMetadataText(
  url: string,
  label: string,
  fetchImpl: GcpCloudSqlFetch,
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
  const value = (await readBoundedText(response, label)).trim();
  if (!value || value.length > 512 || /[\r\n\0]/.test(value)) {
    throw new Error(`${label} returned an invalid value.`);
  }
  return value;
}

async function fetchMetadataJson<T extends JsonRecord>(
  url: string,
  label: string,
  fetchImpl: GcpCloudSqlFetch,
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
  if (!response.ok) throw new Error(`${label} lookup failed (HTTP ${response.status}).`);
  if (response.headers.get("metadata-flavor")?.trim().toLowerCase() !== "google") {
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
      // Preserve the original read/provider error.
    }
    throw error;
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), totalBytes).toString("utf8");
}

function validateSqlAdminUrl(url: URL, projectId: string, instanceId: string): void {
  const expectedPath = `/sql/v1beta4/projects/${encodeURIComponent(projectId)}/instances/${encodeURIComponent(instanceId)}`;
  if (url.protocol !== "https:" || url.hostname !== SQLADMIN_HOST || url.pathname !== expectedPath) {
    throw new Error("GCP Cloud SQL inspection runtime attempted to use an unapproved API endpoint.");
  }
  if (url.username || url.password || (url.port && url.port !== "443") || url.search || url.hash) {
    throw new Error("GCP Cloud SQL inspection endpoint contains forbidden URL components.");
  }
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
    throw new Error("GCP metadata runtime attempted to use an unapproved metadata endpoint.");
  }
}

function validateProjectId(value: string): string {
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(value)) {
    throw new Error("GCP_PROJECT_ID must be a valid GCP project id.");
  }
  return value;
}

function validateInstanceId(value: string): string {
  if (!/^[a-z][a-z0-9-]{0,96}[a-z0-9]$/.test(value) || value.length > 98) {
    throw new Error("CAREPOINT_GCP_CLOUD_SQL_INSTANCE must be a valid Cloud SQL instance id.");
  }
  return value;
}

function validateServiceAccountEmail(value: string, projectId: string): string {
  const normalized = value.trim().toLowerCase();
  const suffix = `@${projectId}.iam.gserviceaccount.com`;
  if (!normalized.endsWith(suffix) || !/^[a-z0-9][a-z0-9._-]{4,28}@/.test(normalized)) {
    throw new Error("CAREPOINT_GCP_SERVICE_ACCOUNT_EMAIL must identify a service account in GCP_PROJECT_ID.");
  }
  return normalized;
}

function objectRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required for GCP Cloud SQL production preflight.`);
  return value;
}

function errorName(error: unknown): string {
  if (error instanceof Error && error.name) {
    return error.name.replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 80) || "GcpCloudSqlError";
  }
  return "GcpCloudSqlError";
}
