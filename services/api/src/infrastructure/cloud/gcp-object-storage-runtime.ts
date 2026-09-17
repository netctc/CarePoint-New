import { GCP_KSA_PRIMARY_REGION } from "./production-cloud-provider";
import {
  productionObjectStorageContract,
  type ProductionObjectStorageDomain,
} from "./production-object-storage";

const METADATA_HOST = "metadata.google.internal";
const METADATA_BASE_URL = `http://${METADATA_HOST}/computeMetadata/v1/instance/service-accounts/default`;
const STORAGE_HOST = "storage.googleapis.com";
const AUTH_MODE = "metadata-service";
const REQUEST_TIMEOUT_MS = 30_000;
const TOKEN_REFRESH_SKEW_MS = 60_000;
const MAX_OBJECT_BYTES = 64 * 1024 * 1024;
const MAX_METADATA_BYTES = 8 * 1024;
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

export type GcpObjectStorageDomainLabel = "clinical-documents" | "fhir-bulk-export";

export type GcpObjectStorageFetch = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

export type GcpObjectStorageRuntimeOptions = {
  fetch?: GcpObjectStorageFetch;
  now?: () => number;
};

export type GcpObjectStorageRuntime = {
  putString(
    label: GcpObjectStorageDomainLabel,
    objectKey: string,
    body: string,
    options?: {
      contentType?: string | undefined;
      metadata?: Record<string, string> | undefined;
    },
  ): Promise<void>;
  getString(label: GcpObjectStorageDomainLabel, objectKey: string): Promise<string>;
  delete(label: GcpObjectStorageDomainLabel, objectKey: string): Promise<void>;
  close(): Promise<void>;
};

type CachedToken = {
  value: string;
  expiresAtMs: number;
};

type MetadataTokenResponse = {
  access_token?: unknown;
  expires_in?: unknown;
  token_type?: unknown;
};

/**
 * Live Google Cloud Storage runtime for Release 1 clinical/FHIR artifacts.
 *
 * The implementation uses the Cloud Storage XML API directly so GCP support is
 * additive and introduces no new application dependency. Authentication comes
 * only from the attached runtime service account via the metadata service.
 */
export async function createProductionGcpObjectStorageRuntime(
  env: NodeJS.ProcessEnv = process.env,
  options: GcpObjectStorageRuntimeOptions = {},
): Promise<GcpObjectStorageRuntime | null> {
  if (env.NODE_ENV !== "production" || env.CAREPOINT_CLOUD_PROVIDER?.trim() !== "gcp") return null;

  assertGcpStorageRuntimeConfiguration(env);
  const contract = productionObjectStorageContract(env);
  if (!contract || contract.provider !== "gcp-cloud-storage") {
    throw new Error("GCP Cloud Storage runtime requires the GCP production object-storage contract.");
  }
  if (contract.region !== GCP_KSA_PRIMARY_REGION) {
    throw new Error(`GCP Cloud Storage runtime must remain in '${GCP_KSA_PRIMARY_REGION}'.`);
  }

  const projectId = validateProjectId(required(env, "GCP_PROJECT_ID"));
  const expectedEmail = validateServiceAccountEmail(
    required(env, "CAREPOINT_GCP_SERVICE_ACCOUNT_EMAIL"),
    projectId,
  );
  const domains = new Map<GcpObjectStorageDomainLabel, ProductionObjectStorageDomain>();
  for (const domain of contract.domains) domains.set(domain.label, domain);
  for (const label of ["clinical-documents", "fhir-bulk-export"] as const) {
    const domain = domains.get(label);
    if (!domain) throw new Error(`GCP Cloud Storage contract is missing '${label}'.`);
    assertProjectKeyOwnership(projectId, domain.kmsKeyRef);
  }

  const fetchImpl = options.fetch ?? globalThis.fetch;
  const now = options.now ?? Date.now;
  if (typeof fetchImpl !== "function") {
    throw new Error("GCP Cloud Storage runtime requires a Fetch-compatible runtime.");
  }

  let token: CachedToken | null = null;
  let identityValidated = false;
  let closed = false;

  const assertOpen = () => {
    if (closed) throw new Error("GCP Cloud Storage runtime is closed.");
  };

  const assertRuntimeIdentity = async () => {
    if (identityValidated) return;
    const actualEmail = await fetchMetadataText(
      `${METADATA_BASE_URL}/email`,
      "GCP runtime service-account identity",
      fetchImpl,
    );
    if (actualEmail !== expectedEmail) {
      throw new Error(
        "GCP runtime service-account identity does not match CAREPOINT_GCP_SERVICE_ACCOUNT_EMAIL.",
      );
    }
    identityValidated = true;
  };

  const accessToken = async (): Promise<string> => {
    const currentTime = now();
    if (token && token.expiresAtMs - TOKEN_REFRESH_SKEW_MS > currentTime) return token.value;

    const metadata = await fetchMetadataJson<MetadataTokenResponse>(
      `${METADATA_BASE_URL}/token`,
      "GCP runtime access token",
      fetchImpl,
    );
    const value = typeof metadata.access_token === "string" ? metadata.access_token.trim() : "";
    const tokenType = typeof metadata.token_type === "string"
      ? metadata.token_type.trim().toLowerCase()
      : "";
    const expiresIn = Number(metadata.expires_in);
    if (!value || value.length > 8192 || /[\r\n\0]/.test(value)) {
      throw new Error("GCP metadata server returned an invalid access token.");
    }
    if (tokenType !== "bearer") {
      throw new Error("GCP metadata server returned an unsupported token type.");
    }
    if (!Number.isSafeInteger(expiresIn) || expiresIn < 120 || expiresIn > 7200) {
      throw new Error("GCP metadata server returned an invalid token lifetime.");
    }
    token = { value, expiresAtMs: currentTime + expiresIn * 1000 };
    return value;
  };

  const authorizedRequest = async (
    url: URL,
    init: RequestInit,
    label: string,
  ): Promise<Response> => {
    assertOpen();
    await assertRuntimeIdentity();
    validateStorageObjectUrl(url);
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${await accessToken()}`);
    let response: Response;
    try {
      response = await fetchImpl(url, {
        ...init,
        headers,
        redirect: "error",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw new Error(`${label} request failed (${errorName(error)}).`);
    }
    if (!response.ok) {
      throw new Error(`${label} request failed (HTTP ${response.status}).`);
    }
    return response;
  };

  return {
    async putString(label, objectKey, body, putOptions = {}) {
      assertOpen();
      const domain = requiredDomain(domains, label);
      const objectName = objectNameFor(domain, objectKey);
      const bodyBytes = Buffer.from(body, "utf8");
      if (bodyBytes.byteLength > MAX_OBJECT_BYTES) {
        throw new Error(`GCP Cloud Storage object exceeds the ${MAX_OBJECT_BYTES}-byte runtime limit.`);
      }
      const headers = new Headers({
        "Content-Type": validateContentType(putOptions.contentType ?? "application/octet-stream"),
        "Content-Length": String(bodyBytes.byteLength),
        "Cache-Control": "no-store",
        "x-goog-hash": `crc32c=${crc32cBase64(bodyBytes)}`,
        "x-goog-encryption-kms-key-name": domain.kmsKeyRef,
      });
      appendCustomMetadata(headers, putOptions.metadata);
      await authorizedRequest(
        objectUrl(domain.bucketRef, objectName),
        { method: "PUT", headers, body: bodyBytes },
        "GCP Cloud Storage put",
      );
    },

    async getString(label, objectKey) {
      assertOpen();
      const domain = requiredDomain(domains, label);
      const objectName = objectNameFor(domain, objectKey);
      const response = await authorizedRequest(
        objectUrl(domain.bucketRef, objectName),
        { method: "GET", headers: { Accept: "application/octet-stream" } },
        "GCP Cloud Storage get",
      );
      return readBoundedObjectBody(response, "GCP Cloud Storage get");
    },

    async delete(label, objectKey) {
      assertOpen();
      const domain = requiredDomain(domains, label);
      const objectName = objectNameFor(domain, objectKey);
      await authorizedRequest(
        objectUrl(domain.bucketRef, objectName),
        { method: "DELETE" },
        "GCP Cloud Storage delete",
      );
    },

    async close() {
      if (closed) return;
      closed = true;
      token = null;
      identityValidated = false;
    },
  };
}

function assertGcpStorageRuntimeConfiguration(env: NodeJS.ProcessEnv): void {
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

function requiredDomain(
  domains: Map<GcpObjectStorageDomainLabel, ProductionObjectStorageDomain>,
  label: GcpObjectStorageDomainLabel,
): ProductionObjectStorageDomain {
  const domain = domains.get(label);
  if (!domain) throw new Error(`GCP Cloud Storage contract is missing '${label}'.`);
  return domain;
}

function objectNameFor(domain: ProductionObjectStorageDomain, objectKey: string): string {
  assertSafeObjectKey(objectKey);
  return domain.prefix ? `${domain.prefix}/${objectKey}` : objectKey;
}

function assertSafeObjectKey(objectKey: string): void {
  if (!objectKey || objectKey.length > 900 || !/^[A-Za-z0-9/_\-.]+$/.test(objectKey) || objectKey.includes("..")) {
    throw new Error("Unsafe GCP Cloud Storage object key.");
  }
}

function objectUrl(bucketRef: string, objectName: string): URL {
  const encodedObjectName = encodeURIComponent(objectName);
  const url = new URL(`https://${STORAGE_HOST}/${bucketRef}/${encodedObjectName}`);
  validateStorageObjectUrl(url);
  return url;
}

function validateStorageObjectUrl(url: URL): void {
  if (
    url.protocol !== "https:"
    || url.hostname !== STORAGE_HOST
    || (url.port && url.port !== "443")
    || url.username
    || url.password
    || url.search
    || url.hash
  ) {
    throw new Error("GCP Cloud Storage runtime attempted to use an unapproved endpoint.");
  }
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length !== 2 || !segments[0] || !segments[1]) {
    throw new Error("GCP Cloud Storage runtime object URL is invalid.");
  }
}

function appendCustomMetadata(headers: Headers, metadata: Record<string, string> | undefined): void {
  if (!metadata) return;
  let totalBytes = 0;
  for (const [rawKey, rawValue] of Object.entries(metadata)) {
    const key = rawKey.trim().toLowerCase();
    const value = rawValue.trim();
    if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(key)) {
      throw new Error("GCP Cloud Storage custom metadata contains an invalid key.");
    }
    if (!value || value.length > 2048 || /[\r\n\0]/.test(value)) {
      throw new Error("GCP Cloud Storage custom metadata contains an invalid value.");
    }
    const headerName = `x-goog-meta-${key}`;
    totalBytes += Buffer.byteLength(headerName, "utf8") + Buffer.byteLength(value, "utf8");
    if (totalBytes > MAX_METADATA_BYTES) {
      throw new Error("GCP Cloud Storage custom metadata exceeds the 8 KiB limit.");
    }
    headers.set(headerName, value);
  }
}

function validateContentType(value: string): string {
  const contentType = value.trim();
  if (!contentType || contentType.length > 255 || /[\r\n\0]/.test(contentType)) {
    throw new Error("GCP Cloud Storage content type is invalid.");
  }
  return contentType;
}

function crc32cBase64(bytes: Uint8Array): string {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) !== 0 ? 0x82f63b78 : 0);
    }
  }
  const checksum = Buffer.allocUnsafe(4);
  checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 0);
  return checksum.toString("base64");
}

async function fetchMetadataText(
  url: string,
  label: string,
  fetchImpl: GcpObjectStorageFetch,
): Promise<string> {
  validateMetadataUrl(url);
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      headers: { "Metadata-Flavor": "Google" },
      redirect: "error",
      signal: AbortSignal.timeout(5_000),
    });
  } catch (error) {
    throw new Error(`${label} lookup failed (${errorName(error)}).`);
  }
  assertMetadataResponse(response, label);
  const value = (await readBoundedMetadataBody(response, label)).trim();
  if (!value || value.length > 512 || /[\r\n\0]/.test(value)) {
    throw new Error(`${label} returned an invalid value.`);
  }
  return value;
}

async function fetchMetadataJson<T extends Record<string, unknown>>(
  url: string,
  label: string,
  fetchImpl: GcpObjectStorageFetch,
): Promise<T> {
  validateMetadataUrl(url);
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      headers: { "Metadata-Flavor": "Google" },
      redirect: "error",
      signal: AbortSignal.timeout(5_000),
    });
  } catch (error) {
    throw new Error(`${label} lookup failed (${errorName(error)}).`);
  }
  assertMetadataResponse(response, label);
  const raw = await readBoundedMetadataBody(response, label);
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

function assertMetadataResponse(response: Response, label: string): void {
  if (!response.ok) throw new Error(`${label} lookup failed (HTTP ${response.status}).`);
  if (response.headers.get("metadata-flavor")?.trim().toLowerCase() !== "google") {
    throw new Error(`${label} response is missing the Google metadata trust marker.`);
  }
}

async function readBoundedMetadataBody(response: Response, label: string): Promise<string> {
  const body = await readBoundedBytes(response, 64 * 1024, label);
  return body.toString("utf8");
}

async function readBoundedObjectBody(response: Response, label: string): Promise<string> {
  const body = await readBoundedBytes(response, MAX_OBJECT_BYTES, label);
  return body.toString("utf8");
}

async function readBoundedBytes(response: Response, limit: number, label: string): Promise<Buffer> {
  const contentLength = response.headers.get("content-length");
  if (contentLength) {
    const value = Number(contentLength);
    if (!Number.isSafeInteger(value) || value < 0 || value > limit) {
      throw new Error(`${label} response exceeds the permitted size.`);
    }
  }

  const body = response.body;
  if (!body) return Buffer.alloc(0);
  const reader = body.getReader();
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      totalBytes += value.byteLength;
      if (totalBytes > limit) {
        throw new Error(`${label} response exceeds the permitted size.`);
      }
      chunks.push(Buffer.from(value));
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
  return Buffer.concat(chunks, totalBytes);
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
  const expectedSuffix = `@${projectId}.iam.gserviceaccount.com`;
  if (!email.endsWith(expectedSuffix) || email.length > 254 || /[\r\n\0]/.test(email)) {
    throw new Error("CAREPOINT_GCP_SERVICE_ACCOUNT_EMAIL must identify a service account in GCP_PROJECT_ID.");
  }
  const local = email.slice(0, -expectedSuffix.length);
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(local)) {
    throw new Error("CAREPOINT_GCP_SERVICE_ACCOUNT_EMAIL has an invalid service-account id.");
  }
  return email;
}

function assertProjectKeyOwnership(projectId: string, keyRef: string): void {
  if (!keyRef.startsWith(`projects/${projectId}/locations/${GCP_KSA_PRIMARY_REGION}/keyRings/`)) {
    throw new Error("GCP Cloud Storage CMEK must belong to GCP_PROJECT_ID in the approved region.");
  }
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
