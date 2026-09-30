import {
  createGcpObjectStorageBucketInspector,
  type GcpObjectStorageBucketInspection,
  type GcpStorageBucketResource,
  type InspectGcpObjectStorageBucket,
} from "./gcp-object-storage-inspector-adapter";
import { GCP_KSA_PRIMARY_REGION, productionCloudContract } from "./production-cloud-provider";
import { productionObjectStorageContract } from "./production-object-storage";

const METADATA_HOST = "metadata.google.internal";
const METADATA_BASE_URL = `http://${METADATA_HOST}/computeMetadata/v1/instance/service-accounts/default`;
const STORAGE_HOST = "storage.googleapis.com";
const AUTH_MODE = "metadata-service";
const REQUEST_TIMEOUT_MS = 5_000;
const MAX_PROVIDER_RESPONSE_BYTES = 1024 * 1024;
const TOKEN_REFRESH_SKEW_MS = 60_000;
const BUCKET_FIELDS = [
  "name",
  "location",
  "iamConfiguration/publicAccessPrevention",
  "iamConfiguration/uniformBucketLevelAccess/enabled",
  "encryption/defaultKmsKeyName",
  "lifecycle",
].join(",");
const FORBIDDEN_CREDENTIAL_ENV_VARS = [
  "GOOGLE_APPLICATION_CREDENTIALS",
  "CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE",
  "GOOGLE_GHA_CREDS_PATH",
  "CAREPOINT_GCP_ACCESS_TOKEN",
  "GCP_ACCESS_TOKEN",
  "GOOGLE_API_KEY",
] as const;
const FORBIDDEN_ENDPOINT_ENV_VARS = [
  "CAREPOINT_GCP_STORAGE_ENDPOINT",
  "STORAGE_EMULATOR_HOST",
  "GOOGLE_CLOUD_STORAGE_ENDPOINT",
] as const;

export type GcpStorageInspectionFetch = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface GcpObjectStorageInspectionRuntime {
  inspectBucket: InspectGcpObjectStorageBucket;
  close(): Promise<void>;
}

export interface GcpObjectStorageInspectionRuntimeOptions {
  fetch?: GcpStorageInspectionFetch;
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

export async function createProductionGcpObjectStorageInspectionRuntime(
  env: NodeJS.ProcessEnv = process.env,
  options: GcpObjectStorageInspectionRuntimeOptions = {},
): Promise<GcpObjectStorageInspectionRuntime | null> {
  if (env.NODE_ENV !== "production" || env.CAREPOINT_CLOUD_PROVIDER?.trim() !== "gcp") return null;

  const cloud = productionCloudContract(env);
  if (!cloud || cloud.provider !== "gcp") {
    throw new Error("GCP Cloud Storage inspection runtime requires the GCP production cloud contract.");
  }
  const contract = productionObjectStorageContract(env);
  if (!contract || contract.provider !== "gcp-cloud-storage") {
    throw new Error("GCP Cloud Storage inspection runtime requires the GCP object-storage contract.");
  }
  if (contract.region !== GCP_KSA_PRIMARY_REGION) {
    throw new Error(`GCP Cloud Storage inspection runtime must remain in '${GCP_KSA_PRIMARY_REGION}'.`);
  }
  assertRuntimeConfiguration(env);

  const projectId = validateProjectId(required(env, "GCP_PROJECT_ID"));
  const expectedServiceAccountEmail = validateServiceAccountEmail(
    required(env, "CAREPOINT_GCP_SERVICE_ACCOUNT_EMAIL"),
    projectId,
  );
  for (const domain of contract.domains) {
    if (!domain.kmsKeyRef.startsWith(`projects/${projectId}/locations/${GCP_KSA_PRIMARY_REGION}/keyRings/`)) {
      throw new Error("GCP Cloud Storage inspection requires CMEK resources in GCP_PROJECT_ID and the approved region.");
    }
  }

  const fetchImpl = options.fetch ?? globalThis.fetch;
  const now = options.now ?? Date.now;
  if (typeof fetchImpl !== "function") {
    throw new Error("GCP Cloud Storage inspection runtime requires a Fetch-compatible runtime.");
  }

  const metadataEmail = await fetchMetadataText(
    `${METADATA_BASE_URL}/email`,
    "GCP runtime service-account identity",
    fetchImpl,
  );
  if (metadataEmail !== expectedServiceAccountEmail) {
    throw new Error("GCP runtime service-account identity does not match CAREPOINT_GCP_SERVICE_ACCOUNT_EMAIL.");
  }

  let cachedToken: CachedAccessToken | null = null;
  let closed = false;

  const accessToken = async (): Promise<string> => {
    if (closed) throw new Error("GCP Cloud Storage inspection runtime is closed.");
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
    const tokenType = typeof token.token_type === "string" ? token.token_type.trim().toLowerCase() : "";
    const expiresIn = Number(token.expires_in);
    if (!value || value.length > 8192 || /[\r\n\0]/.test(value)) {
      throw new Error("GCP metadata server returned an invalid access token.");
    }
    if (tokenType !== "bearer") {
      throw new Error("GCP metadata server returned an unsupported token type.");
    }
    if (!Number.isSafeInteger(expiresIn) || expiresIn < 120 || expiresIn > 7200) {
      throw new Error("GCP metadata server returned an invalid token lifetime.");
    }
    cachedToken = { value, expiresAtMs: currentTime + expiresIn * 1000 };
    return value;
  };

  const client = {
    getBucket: async ({ bucketRef }: { bucketRef: string }): Promise<{ bucket?: GcpStorageBucketResource }> => {
      if (closed) throw new Error("GCP Cloud Storage inspection runtime is closed.");
      const url = bucketInspectionUrl(bucketRef);
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
        throw new Error(`GCP Cloud Storage bucket inspection request failed (${errorName(error)}).`);
      }
      if (!response.ok) {
        throw new Error(`GCP Cloud Storage bucket inspection request failed (HTTP ${response.status}).`);
      }
      return { bucket: await parseBoundedJson<GcpStorageBucketResource>(response, "GCP Cloud Storage bucket inspection") };
    },
  };

  return {
    inspectBucket: createGcpObjectStorageBucketInspector({
      region: GCP_KSA_PRIMARY_REGION,
      client,
    }),
    close: async () => {
      closed = true;
      cachedToken = null;
    },
  };
}

function assertRuntimeConfiguration(env: NodeJS.ProcessEnv): void {
  if (env.CAREPOINT_GCP_AUTH_MODE?.trim() !== AUTH_MODE) {
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
}

function bucketInspectionUrl(bucketRef: string): URL {
  if (bucketRef.length < 3 || bucketRef.length > 63 || !/^[a-z0-9][a-z0-9._-]*[a-z0-9]$/.test(bucketRef)) {
    throw new Error("GCP Cloud Storage bucket inspection received an invalid bucket reference.");
  }
  const url = new URL(`https://${STORAGE_HOST}/storage/v1/b/${encodeURIComponent(bucketRef)}`);
  url.searchParams.set("fields", BUCKET_FIELDS);
  validateBucketInspectionUrl(url, bucketRef);
  return url;
}

function validateBucketInspectionUrl(url: URL, bucketRef: string): void {
  if (
    url.protocol !== "https:"
    || url.hostname !== STORAGE_HOST
    || (url.port && url.port !== "443")
    || url.username
    || url.password
    || url.hash
    || decodeURIComponent(url.pathname) !== `/storage/v1/b/${bucketRef}`
    || url.searchParams.size !== 1
    || url.searchParams.get("fields") !== BUCKET_FIELDS
  ) {
    throw new Error("GCP Cloud Storage inspection runtime attempted to use an unapproved API endpoint.");
  }
}

async function fetchMetadataText(
  url: string,
  label: string,
  fetchImpl: GcpStorageInspectionFetch,
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

async function fetchMetadataJson<T extends Record<string, unknown>>(
  url: string,
  label: string,
  fetchImpl: GcpStorageInspectionFetch,
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

async function parseBoundedJson<T extends Record<string, unknown>>(response: Response, label: string): Promise<T> {
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
  const length = response.headers.get("content-length");
  if (length) {
    const parsed = Number(length);
    if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > MAX_PROVIDER_RESPONSE_BYTES) {
      throw new Error(`${label} response exceeds the permitted size.`);
    }
  }
  const body = response.body;
  if (!body) return "";
  const reader = body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      if (!next.value) continue;
      total += next.value.byteLength;
      if (total > MAX_PROVIDER_RESPONSE_BYTES) {
        throw new Error(`${label} response exceeds the permitted size.`);
      }
      chunks.push(Buffer.from(next.value));
    }
  } catch (error) {
    try { await reader.cancel(); } catch { /* preserve original error */ }
    throw error;
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total).toString("utf8");
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

function validateProjectId(value: string): string {
  const projectId = value.trim();
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId)) {
    throw new Error("GCP_PROJECT_ID must be a valid GCP project id.");
  }
  return projectId;
}

function validateServiceAccountEmail(value: string, projectId: string): string {
  const email = value.trim().toLowerCase();
  const suffix = `@${projectId}.iam.gserviceaccount.com`;
  if (!email.endsWith(suffix) || email.length > 254 || /[\r\n\0]/.test(email)) {
    throw new Error("CAREPOINT_GCP_SERVICE_ACCOUNT_EMAIL must identify a service account in GCP_PROJECT_ID.");
  }
  const local = email.slice(0, -suffix.length);
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(local)) {
    throw new Error("CAREPOINT_GCP_SERVICE_ACCOUNT_EMAIL has an invalid service-account id.");
  }
  return email;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required in GCP production.`);
  return value;
}

function errorName(error: unknown): string {
  if (error instanceof Error && error.name) {
    return error.name.replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 80) || "GcpStorageError";
  }
  return "GcpStorageError";
}

export type { GcpObjectStorageBucketInspection };
