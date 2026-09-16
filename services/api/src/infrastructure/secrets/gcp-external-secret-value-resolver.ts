import {
  GCP_KSA_PRIMARY_REGION,
} from "../cloud/production-cloud-provider";
import {
  productionExternalSecretStoreContract,
  type ProductionExternalSecretName,
} from "../cloud/production-secret-store";

const METADATA_HOST = "metadata.google.internal";
const METADATA_BASE_URL = `http://${METADATA_HOST}/computeMetadata/v1/instance/service-accounts/default`;
const AUTH_MODE = "metadata-service";
const MAX_PLAINTEXT_SECRET_BYTES = 4096;
const MAX_PROVIDER_RESPONSE_BYTES = 64 * 1024;
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
  "CAREPOINT_GCP_SECRET_MANAGER_ENDPOINT",
  "GOOGLE_SECRET_MANAGER_ENDPOINT",
] as const;

export type GcpSecretValueFetch = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface GcpExternalSecretValueResolverOptions {
  fetch?: GcpSecretValueFetch;
  now?: () => number;
}

type CachedValue = {
  versionIdentity: string;
  value: string;
};

type CachedToken = {
  value: string;
  expiresAtMs: number;
};

type JsonRecord = Record<string, unknown>;

type MetadataTokenResponse = {
  access_token?: unknown;
  expires_in?: unknown;
  token_type?: unknown;
};

export class GcpExternalSecretValueResolver {
  private readonly cache = new Map<ProductionExternalSecretName, CachedValue>();
  private readonly fetchImpl: GcpSecretValueFetch;
  private readonly now: () => number;
  private token: CachedToken | null = null;
  private identityValidated = false;
  private closed = false;

  constructor(
    private readonly env: NodeJS.ProcessEnv = process.env,
    options: GcpExternalSecretValueResolverOptions = {},
  ) {
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.now = options.now ?? Date.now;
    if (typeof this.fetchImpl !== "function") {
      throw new Error("GCP external credential resolver requires a Fetch-compatible runtime.");
    }
  }

  async resolve(name: ProductionExternalSecretName): Promise<string> {
    if (this.closed) throw new Error("GCP external credential resolver is closed.");

    const contract = productionExternalSecretStoreContract(this.env);
    if (!contract || contract.provider !== "gcp-secret-manager") {
      throw new Error("GCP external credential resolver requires the regional Secret Manager production contract.");
    }
    const domain = contract.secrets.find((candidate) => candidate.name === name);
    if (!domain) throw new Error(`Unsupported external credential '${name}'.`);
    if (domain.region !== GCP_KSA_PRIMARY_REGION) {
      throw new Error(`GCP external credential resolver must remain in '${GCP_KSA_PRIMARY_REGION}'.`);
    }

    await this.assertRuntimeIdentity();
    const token = await this.accessToken();
    const accessUrl = validateSecretAccessUrl(
      `https://secretmanager.${GCP_KSA_PRIMARY_REGION}.rep.googleapis.com/v1/${domain.secretRef}/versions/latest:access`,
    );

    let response: Response;
    try {
      response = await this.fetchImpl(accessUrl, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
        redirect: "error",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw new Error(`GCP external credential retrieval failed (${errorName(error)}).`);
    }
    if (!response.ok) {
      throw new Error(`GCP external credential retrieval failed (HTTP ${response.status}).`);
    }

    const payload = await parseBoundedJson(response, "GCP external credential retrieval");
    const versionIdentity = validateVersionIdentity(payload.name, domain.secretRef);
    const cached = this.cache.get(name);
    if (cached?.versionIdentity === versionIdentity) return cached.value;

    const payloadRecord = objectRecord(payload.payload);
    if (!payloadRecord) {
      throw new Error("GCP external credential retrieval returned no payload.");
    }
    const encoded = stringValue(payloadRecord.data);
    if (!encoded) {
      throw new Error("GCP external credential payload is missing base64 data.");
    }
    const plaintextBytes = decodeCanonicalBase64(encoded);
    try {
      verifyCrc32c(plaintextBytes, payloadRecord.dataCrc32c);
      if (plaintextBytes.byteLength < 1 || plaintextBytes.byteLength > MAX_PLAINTEXT_SECRET_BYTES) {
        throw new Error("GCP external credential plaintext has an invalid size.");
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
    this.token = null;
  }

  private async assertRuntimeIdentity(): Promise<void> {
    if (this.identityValidated) return;
    assertGcpRuntimeConfiguration(this.env);
    const expectedEmail = validateServiceAccountEmail(
      required(this.env, "CAREPOINT_GCP_SERVICE_ACCOUNT_EMAIL"),
      required(this.env, "GCP_PROJECT_ID"),
    );
    const actualEmail = await fetchMetadataText(
      `${METADATA_BASE_URL}/email`,
      "GCP runtime service-account identity",
      this.fetchImpl,
    );
    if (actualEmail !== expectedEmail) {
      throw new Error("GCP runtime service-account identity does not match CAREPOINT_GCP_SERVICE_ACCOUNT_EMAIL.");
    }
    this.identityValidated = true;
  }

  private async accessToken(): Promise<string> {
    const currentTime = this.now();
    if (this.token && this.token.expiresAtMs - TOKEN_REFRESH_SKEW_MS > currentTime) {
      return this.token.value;
    }

    const metadata = await fetchMetadataJson<MetadataTokenResponse>(
      `${METADATA_BASE_URL}/token`,
      "GCP runtime access token",
      this.fetchImpl,
    );
    const value = typeof metadata.access_token === "string" ? metadata.access_token.trim() : "";
    const tokenType = typeof metadata.token_type === "string" ? metadata.token_type.trim().toLowerCase() : "";
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
    this.token = {
      value,
      expiresAtMs: currentTime + expiresIn * 1000,
    };
    return value;
  }
}

function assertGcpRuntimeConfiguration(env: NodeJS.ProcessEnv): void {
  if (env.NODE_ENV !== "production" || env.CAREPOINT_CLOUD_PROVIDER?.trim() !== "gcp") {
    throw new Error("GCP external credential resolver is restricted to GCP production.");
  }
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

async function fetchMetadataText(
  url: string,
  label: string,
  fetchImpl: GcpSecretValueFetch,
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
  fetchImpl: GcpSecretValueFetch,
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
    const value = Number(contentLength);
    if (!Number.isSafeInteger(value) || value < 0 || value > MAX_PROVIDER_RESPONSE_BYTES) {
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

function validateVersionIdentity(value: unknown, secretRef: string): string {
  const name = stringValue(value);
  if (!name || !name.startsWith(`${secretRef}/versions/`)) {
    throw new Error("GCP external credential retrieval returned an unexpected resource.");
  }
  const version = name.slice(`${secretRef}/versions/`.length);
  if (!/^[1-9]\d*$/.test(version)) {
    throw new Error("GCP external credential retrieval returned an invalid version identity.");
  }
  return `version:${version}`;
}

function decodeCanonicalBase64(value: string): Buffer {
  const raw = value.trim();
  if (!raw || raw.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(raw)) {
    throw new Error("GCP external credential content is not canonical base64.");
  }
  const decoded = Buffer.from(raw, "base64");
  if (!decoded.byteLength || decoded.toString("base64") !== raw) {
    decoded.fill(0);
    throw new Error("GCP external credential content is not canonical base64.");
  }
  return decoded;
}

function verifyCrc32c(bytes: Buffer, value: unknown): void {
  const expected = typeof value === "string" || typeof value === "number"
    ? Number(value)
    : Number.NaN;
  if (!Number.isSafeInteger(expected) || expected < 0 || expected > 0xffffffff) {
    throw new Error("GCP external credential payload is missing a valid CRC32C checksum.");
  }
  const actual = crc32c(bytes);
  if (actual !== expected) {
    throw new Error("GCP external credential payload failed CRC32C integrity validation.");
  }
}

function crc32c(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) !== 0 ? 0x82f63b78 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function decodeUtf8(value: Buffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(value);
  } catch {
    throw new Error("GCP external credential plaintext must be valid UTF-8.");
  }
}

function validatePlaintext(value: string): void {
  if (!value || Buffer.byteLength(value, "utf8") > MAX_PLAINTEXT_SECRET_BYTES || /[\r\n\0]/.test(value)) {
    throw new Error("GCP external credential plaintext is invalid.");
  }
}

function validateSecretAccessUrl(value: string): URL {
  const url = new URL(value);
  const host = `secretmanager.${GCP_KSA_PRIMARY_REGION}.rep.googleapis.com`;
  if (url.protocol !== "https:" || url.hostname.toLowerCase() !== host) {
    throw new Error("GCP external credential resolver attempted to use an unapproved Secret Manager endpoint.");
  }
  if (url.username || url.password || (url.port && url.port !== "443") || url.search || url.hash) {
    throw new Error("GCP Secret Manager endpoint contains forbidden URL components.");
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

function validateServiceAccountEmail(value: string, projectId: string): string {
  const normalizedProject = projectId.trim();
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(normalizedProject)) {
    throw new Error("GCP_PROJECT_ID must be a valid GCP project id.");
  }
  const email = value.trim().toLowerCase();
  const match = /^([a-z][a-z0-9-]{4,28}[a-z0-9])@([a-z][a-z0-9-]{4,28}[a-z0-9])\.iam\.gserviceaccount\.com$/.exec(email);
  if (!match?.[2]) {
    throw new Error("CAREPOINT_GCP_SERVICE_ACCOUNT_EMAIL must be a GCP service-account email.");
  }
  if (match[2] !== normalizedProject) {
    throw new Error("CAREPOINT_GCP_SERVICE_ACCOUNT_EMAIL must belong to GCP_PROJECT_ID.");
  }
  return email;
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
