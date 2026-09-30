import type { KeyEncryptionKeyProvider, WrappedDataKey } from "@carepoint/security";
import { GCP_KSA_PRIMARY_REGION } from "../cloud/production-cloud-provider";
import { productionKeyManagementContract } from "../cloud/production-key-management";

const METADATA_HOST = "metadata.google.internal";
const METADATA_BASE_URL = `http://${METADATA_HOST}/computeMetadata/v1/instance/service-accounts/default`;
const AUTH_MODE = "metadata-service";
const DATA_KEY_BYTES = 32;
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
  "CAREPOINT_GCP_KMS_ENDPOINT",
  "GOOGLE_CLOUD_KMS_ENDPOINT",
] as const;

export type GcpKmsFetch = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface GcpKmsKeyProviderOptions {
  fetch?: GcpKmsFetch;
  now?: () => number;
}

type CachedToken = {
  value: string;
  expiresAtMs: number;
};

type MetadataTokenResponse = {
  access_token?: unknown;
  expires_in?: unknown;
  token_type?: unknown;
};

type JsonRecord = Record<string, unknown>;

/**
 * GCP Cloud KMS adapter for CarePoint clinical-document data-key envelopes.
 *
 * The adapter is intentionally dependency-free: production authentication is
 * obtained only from the attached Compute Engine metadata service identity and
 * all Cloud KMS calls are bound to the approved regional endpoint.
 */
export class GcpKmsKeyProvider implements KeyEncryptionKeyProvider {
  private readonly fetchImpl: GcpKmsFetch;
  private readonly now: () => number;
  private token: CachedToken | null = null;
  private identityValidated = false;

  constructor(
    private readonly keyId: string,
    private readonly purpose: string,
    private readonly env: NodeJS.ProcessEnv = process.env,
    options: GcpKmsKeyProviderOptions = {},
  ) {
    if (!keyId.trim()) throw new Error("GCP Cloud KMS key id is required.");
    if (!purpose.trim()) throw new Error("GCP Cloud KMS encryption purpose is required.");
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.now = options.now ?? Date.now;
    if (typeof this.fetchImpl !== "function") {
      throw new Error("GCP Cloud KMS key provider requires a Fetch-compatible runtime.");
    }
  }

  async wrapDataKey(rawDataKey: Uint8Array): Promise<WrappedDataKey> {
    if (rawDataKey.byteLength !== DATA_KEY_BYTES) {
      throw new Error(`GCP Cloud KMS data key must be exactly ${DATA_KEY_BYTES} bytes.`);
    }

    await this.assertRuntimeReady();
    const plaintext = Buffer.from(rawDataKey);
    const aad = this.associatedData();
    try {
      const response = await this.authorizedPost(
        `${this.cryptoKeyUrl()}:encrypt`,
        {
          plaintext: plaintext.toString("base64"),
          additionalAuthenticatedData: aad.toString("base64"),
          plaintextCrc32c: String(crc32c(plaintext)),
          additionalAuthenticatedDataCrc32c: String(crc32c(aad)),
        },
        "GCP Cloud KMS encryption",
      );

      if (response.verifiedPlaintextCrc32c !== true) {
        throw new Error("GCP Cloud KMS encryption did not verify the plaintext CRC32C checksum.");
      }
      if (response.verifiedAdditionalAuthenticatedDataCrc32c !== true) {
        throw new Error("GCP Cloud KMS encryption did not verify the AAD CRC32C checksum.");
      }
      validateKeyVersionIdentity(response.name, this.keyId);
      validateProtectionLevel(response.protectionLevel);

      const ciphertext = decodeCanonicalBase64(
        stringValue(response.ciphertext),
        "GCP Cloud KMS ciphertext",
      );
      try {
        verifyCrc32c(ciphertext, response.ciphertextCrc32c, "GCP Cloud KMS ciphertext");
        return {
          keyId: this.keyId,
          wrappedKey: ciphertext.toString("base64"),
        };
      } finally {
        ciphertext.fill(0);
      }
    } finally {
      plaintext.fill(0);
      aad.fill(0);
    }
  }

  async unwrapDataKey(input: WrappedDataKey): Promise<Uint8Array> {
    if (input.keyId.trim() !== this.keyId) {
      throw new Error("GCP Cloud KMS wrapped key references an unexpected key id.");
    }

    const ciphertext = decodeCanonicalBase64(
      input.wrappedKey,
      "GCP Cloud KMS wrapped key material",
    );
    const aad = this.associatedData();
    try {
      await this.assertRuntimeReady();
      const response = await this.authorizedPost(
        `${this.cryptoKeyUrl()}:decrypt`,
        {
          ciphertext: ciphertext.toString("base64"),
          additionalAuthenticatedData: aad.toString("base64"),
          ciphertextCrc32c: String(crc32c(ciphertext)),
          additionalAuthenticatedDataCrc32c: String(crc32c(aad)),
        },
        "GCP Cloud KMS decryption",
      );

      if (response.verifiedCiphertextCrc32c !== true) {
        throw new Error("GCP Cloud KMS decryption did not verify the ciphertext CRC32C checksum.");
      }
      if (response.verifiedAdditionalAuthenticatedDataCrc32c !== true) {
        throw new Error("GCP Cloud KMS decryption did not verify the AAD CRC32C checksum.");
      }
      validateProtectionLevel(response.protectionLevel);

      const plaintext = decodeCanonicalBase64(
        stringValue(response.plaintext),
        "GCP Cloud KMS plaintext data key",
      );
      try {
        verifyCrc32c(plaintext, response.plaintextCrc32c, "GCP Cloud KMS plaintext data key");
        if (plaintext.byteLength !== DATA_KEY_BYTES) {
          throw new Error(
            `GCP Cloud KMS returned an invalid data key length; expected ${DATA_KEY_BYTES} bytes.`,
          );
        }
        return Uint8Array.from(plaintext);
      } finally {
        plaintext.fill(0);
      }
    } finally {
      ciphertext.fill(0);
      aad.fill(0);
    }
  }

  private associatedData(): Buffer {
    return Buffer.from(`purpose=${this.purpose}`, "utf8");
  }

  private cryptoKeyUrl(): string {
    return validateCryptoKeyUrl(
      `https://cloudkms.${GCP_KSA_PRIMARY_REGION}.rep.googleapis.com/v1/${this.keyId}`,
      this.keyId,
    ).toString();
  }

  private async assertRuntimeReady(): Promise<void> {
    if (this.identityValidated) return;
    assertGcpRuntimeConfiguration(this.env);

    const contract = productionKeyManagementContract(this.env);
    if (!contract || contract.provider !== "gcp-cloud-kms") {
      throw new Error("GCP Cloud KMS key provider requires the Cloud KMS production contract.");
    }
    if (contract.region !== GCP_KSA_PRIMARY_REGION) {
      throw new Error(`GCP Cloud KMS key provider must remain in '${GCP_KSA_PRIMARY_REGION}'.`);
    }
    const domain = contract.domains.find((candidate) => candidate.keyRef === this.keyId);
    if (!domain || domain.usage !== "encrypt-decrypt") {
      throw new Error(
        "GCP Cloud KMS envelope key is not an approved encrypt-decrypt production key reference.",
      );
    }

    const projectId = required(this.env, "GCP_PROJECT_ID");
    assertProjectOwnership(projectId, this.keyId);
    const expectedEmail = validateServiceAccountEmail(
      required(this.env, "CAREPOINT_GCP_SERVICE_ACCOUNT_EMAIL"),
      projectId,
    );
    const actualEmail = await fetchMetadataText(
      `${METADATA_BASE_URL}/email`,
      "GCP runtime service-account identity",
      this.fetchImpl,
    );
    if (actualEmail !== expectedEmail) {
      throw new Error(
        "GCP runtime service-account identity does not match CAREPOINT_GCP_SERVICE_ACCOUNT_EMAIL.",
      );
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
    this.token = {
      value,
      expiresAtMs: currentTime + expiresIn * 1000,
    };
    return value;
  }

  private async authorizedPost(
    url: string,
    body: JsonRecord,
    label: string,
  ): Promise<JsonRecord> {
    const parsed = validateCryptoKeyActionUrl(url, this.keyId);
    let response: Response;
    try {
      response = await this.fetchImpl(parsed, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${await this.accessToken()}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        redirect: "error",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw new Error(`${label} request failed (${errorName(error)}).`);
    }
    if (!response.ok) {
      throw new Error(`${label} request failed (HTTP ${response.status}).`);
    }
    return parseBoundedJson(response, label);
  }
}

function assertGcpRuntimeConfiguration(env: NodeJS.ProcessEnv): void {
  if (env.NODE_ENV !== "production" || env.CAREPOINT_CLOUD_PROVIDER?.trim() !== "gcp") {
    throw new Error("GCP Cloud KMS key provider is restricted to GCP production.");
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
  fetchImpl: GcpKmsFetch,
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
  fetchImpl: GcpKmsFetch,
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

async function parseBoundedJson<T extends JsonRecord = JsonRecord>(
  response: Response,
  label: string,
): Promise<T> {
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

function validateCryptoKeyUrl(value: string, keyId: string): URL {
  const url = new URL(value);
  const expectedHost = `cloudkms.${GCP_KSA_PRIMARY_REGION}.rep.googleapis.com`;
  if (url.protocol !== "https:" || url.hostname.toLowerCase() !== expectedHost) {
    throw new Error("GCP Cloud KMS key provider attempted to use an unapproved regional endpoint.");
  }
  if (url.username || url.password || (url.port && url.port !== "443") || url.search || url.hash) {
    throw new Error("GCP Cloud KMS endpoint contains forbidden URL components.");
  }
  if (decodeURIComponent(url.pathname) !== `/v1/${keyId}`) {
    throw new Error("GCP Cloud KMS endpoint references an unexpected CryptoKey resource.");
  }
  return url;
}

function validateCryptoKeyActionUrl(value: string, keyId: string): URL {
  const url = new URL(value);
  const expectedHost = `cloudkms.${GCP_KSA_PRIMARY_REGION}.rep.googleapis.com`;
  if (url.protocol !== "https:" || url.hostname.toLowerCase() !== expectedHost) {
    throw new Error("GCP Cloud KMS key provider attempted to use an unapproved regional endpoint.");
  }
  if (url.username || url.password || (url.port && url.port !== "443") || url.search || url.hash) {
    throw new Error("GCP Cloud KMS endpoint contains forbidden URL components.");
  }
  const path = decodeURIComponent(url.pathname);
  if (path !== `/v1/${keyId}:encrypt` && path !== `/v1/${keyId}:decrypt`) {
    throw new Error("GCP Cloud KMS endpoint references an unexpected CryptoKey action.");
  }
  return url;
}

function validateKeyVersionIdentity(value: unknown, keyId: string): void {
  const name = stringValue(value);
  const prefix = `${keyId}/cryptoKeyVersions/`;
  if (!name || !name.startsWith(prefix) || !/^[1-9]\d*$/.test(name.slice(prefix.length))) {
    throw new Error("GCP Cloud KMS encryption returned an unexpected CryptoKeyVersion identity.");
  }
}

function validateProtectionLevel(value: unknown): void {
  if (value === undefined || value === null || value === "") return;
  const normalized = String(value).trim().toUpperCase();
  if (normalized !== "SOFTWARE" && normalized !== "HSM") {
    throw new Error("GCP Cloud KMS response used an unsupported protection level.");
  }
}

function decodeCanonicalBase64(value: string | undefined, label: string): Buffer {
  const raw = value?.trim() ?? "";
  if (!raw || raw.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(raw)) {
    throw new Error(`${label} is not canonical base64.`);
  }
  const decoded = Buffer.from(raw, "base64");
  if (!decoded.byteLength || decoded.toString("base64") !== raw) {
    decoded.fill(0);
    throw new Error(`${label} is not canonical base64.`);
  }
  return decoded;
}

function verifyCrc32c(bytes: Buffer, value: unknown, label: string): void {
  const expected = typeof value === "string" || typeof value === "number"
    ? Number(value)
    : Number.NaN;
  if (!Number.isSafeInteger(expected) || expected < 0 || expected > 0xffffffff) {
    throw new Error(`${label} is missing a valid CRC32C checksum.`);
  }
  if (crc32c(bytes) !== expected) {
    throw new Error(`${label} failed CRC32C integrity validation.`);
  }
}

function crc32c(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) !== 0 ? 0x82f63b78 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function validateServiceAccountEmail(value: string, projectId: string): string {
  const normalizedProject = projectId.trim();
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(normalizedProject)) {
    throw new Error("GCP_PROJECT_ID must be a valid GCP project id.");
  }
  const email = value.trim().toLowerCase();
  const expectedSuffix = `@${normalizedProject}.iam.gserviceaccount.com`;
  if (!email.endsWith(expectedSuffix) || email.length > 254 || /[\r\n\0]/.test(email)) {
    throw new Error("CAREPOINT_GCP_SERVICE_ACCOUNT_EMAIL must identify a service account in GCP_PROJECT_ID.");
  }
  const local = email.slice(0, -expectedSuffix.length);
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(local)) {
    throw new Error("CAREPOINT_GCP_SERVICE_ACCOUNT_EMAIL has an invalid service-account id.");
  }
  return email;
}

function assertProjectOwnership(projectId: string, keyId: string): void {
  const normalized = projectId.trim();
  if (!keyId.startsWith(`projects/${normalized}/locations/${GCP_KSA_PRIMARY_REGION}/keyRings/`)) {
    throw new Error("GCP Cloud KMS key reference must belong to GCP_PROJECT_ID in the approved region.");
  }
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required in GCP production.`);
  return value;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value.trim() || undefined : undefined;
}

function errorName(error: unknown): string {
  if (error instanceof Error && error.name) {
    return error.name.replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 80) || "GcpApiError";
  }
  return "GcpApiError";
}
