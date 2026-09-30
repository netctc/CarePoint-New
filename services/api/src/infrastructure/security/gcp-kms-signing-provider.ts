import {
  constants as cryptoConstants,
  createPublicKey,
  verify as verifySignature,
  type KeyObject,
} from "node:crypto";
import { GCP_KSA_PRIMARY_REGION } from "../cloud/production-cloud-provider";
import { productionKeyManagementContract } from "../cloud/production-key-management";

const METADATA_HOST = "metadata.google.internal";
const METADATA_BASE_URL = `http://${METADATA_HOST}/computeMetadata/v1/instance/service-accounts/default`;
const AUTH_MODE = "metadata-service";
const SIGNATURE_ENVELOPE_PREFIX = "GCP1";
const MAX_PROVIDER_RESPONSE_BYTES = 128 * 1024;
const MAX_PUBLIC_KEY_PEM_BYTES = 16 * 1024;
const REQUEST_TIMEOUT_MS = 5_000;
const TOKEN_REFRESH_SKEW_MS = 60_000;
const RSA_PSS_SHA256_SALT_BYTES = 32;
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

const RSA_PSS_SHA256_ALGORITHMS = new Set([
  "RSA_SIGN_PSS_2048_SHA256",
  "RSA_SIGN_PSS_3072_SHA256",
  "RSA_SIGN_PSS_4096_SHA256",
]);
const ECDSA_P256_SHA256_ALGORITHM = "EC_SIGN_P256_SHA256";

export type GcpDocumentSigningAlgorithm =
  | "GCP-KMS-RSA-PSS-SHA256"
  | "GCP-KMS-ECDSA-P256-SHA256";

export type GcpDocumentSignature = {
  algorithm: GcpDocumentSigningAlgorithm;
  keyId: string;
  signature: string;
};

export type GcpKmsSigningFetch = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface GcpKmsSigningProviderOptions {
  fetch?: GcpKmsSigningFetch;
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

type SigningVersion = {
  ref: string;
  providerAlgorithm: string;
  applicationAlgorithm: GcpDocumentSigningAlgorithm;
};

/**
 * GCP Cloud KMS asymmetric-signing adapter for diagnostic-report attestations.
 *
 * GCP asymmetric CryptoKeys do not have a primary version, therefore Release 1
 * requires an explicit non-secret CAREPOINT_DOCUMENT_SIGNING_KEY_VERSION_REF.
 * The exact CryptoKeyVersion used to sign is persisted in an opaque signature
 * envelope so verification remains version-stable across manual key rotation.
 */
export class GcpKmsSigningProvider {
  private readonly fetchImpl: GcpKmsSigningFetch;
  private readonly now: () => number;
  private token: CachedToken | null = null;
  private identityValidated = false;
  private closed = false;

  constructor(
    private readonly keyId: string,
    private readonly env: NodeJS.ProcessEnv = process.env,
    options: GcpKmsSigningProviderOptions = {},
  ) {
    if (!keyId.trim()) throw new Error("GCP Cloud KMS signing key id is required.");
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.now = options.now ?? Date.now;
    if (typeof this.fetchImpl !== "function") {
      throw new Error("GCP Cloud KMS signing provider requires a Fetch-compatible runtime.");
    }
  }

  async signDigest(payloadDigestHex: string): Promise<GcpDocumentSignature> {
    this.assertOpen();
    const digest = decodeSha256Digest(payloadDigestHex);
    try {
      await this.assertRuntimeReady();
      const version = await this.configuredSigningVersion();
      const response = await this.authorizedJson(
        `${this.versionUrl(version.ref)}:asymmetricSign`,
        "POST",
        {
          digest: { sha256: digest.toString("base64") },
          digestCrc32c: String(crc32c(digest)),
        },
        "GCP Cloud KMS signing",
      );

      if (response.verifiedDigestCrc32c !== true) {
        throw new Error("GCP Cloud KMS signing did not verify the digest CRC32C checksum.");
      }
      if (stringValue(response.name) !== version.ref) {
        throw new Error("GCP Cloud KMS signing response references an unexpected CryptoKeyVersion.");
      }
      validateProtectionLevel(response.protectionLevel);

      const signatureBytes = decodeCanonicalBase64(
        stringValue(response.signature),
        "GCP Cloud KMS signature",
      );
      try {
        verifyCrc32c(signatureBytes, response.signatureCrc32c, "GCP Cloud KMS signature");
        return {
          algorithm: version.applicationAlgorithm,
          keyId: this.keyId,
          signature: encodeSignatureEnvelope(version.ref, signatureBytes.toString("base64")),
        };
      } finally {
        signatureBytes.fill(0);
      }
    } finally {
      digest.fill(0);
    }
  }

  async verifyMaterial(
    material: string,
    persistedSignature: string,
    algorithm: string | null | undefined,
  ): Promise<boolean> {
    this.assertOpen();
    const expectedApplicationAlgorithm = parseApplicationAlgorithm(algorithm);
    if (!expectedApplicationAlgorithm) return false;

    const envelope = decodeSignatureEnvelope(persistedSignature, this.keyId);
    if (!envelope) return false;

    await this.assertRuntimeReady();
    const publicKeyResponse = await this.authorizedJson(
      `${this.versionUrl(envelope.versionRef)}/publicKey`,
      "GET",
      undefined,
      "GCP Cloud KMS public-key retrieval",
    );

    if (stringValue(publicKeyResponse.name) !== envelope.versionRef) {
      throw new Error("GCP Cloud KMS public-key response references an unexpected CryptoKeyVersion.");
    }
    validateProtectionLevel(publicKeyResponse.protectionLevel);
    const providerAlgorithm = stringValue(publicKeyResponse.algorithm) ?? "";
    const actualApplicationAlgorithm = applicationAlgorithm(providerAlgorithm);
    if (!actualApplicationAlgorithm || actualApplicationAlgorithm !== expectedApplicationAlgorithm) {
      return false;
    }

    const pem = validatePublicKeyPem(publicKeyResponse.pem);
    verifyPemCrc32c(pem, publicKeyResponse.pemCrc32c);
    const key = parsePublicKey(pem, actualApplicationAlgorithm);
    const signature = decodeCanonicalBase64(envelope.signature, "GCP Cloud KMS signature");
    const materialBytes = Buffer.from(material, "utf8");
    try {
      if (actualApplicationAlgorithm === "GCP-KMS-RSA-PSS-SHA256") {
        return verifySignature(
          "sha256",
          materialBytes,
          {
            key,
            padding: cryptoConstants.RSA_PKCS1_PSS_PADDING,
            saltLength: RSA_PSS_SHA256_SALT_BYTES,
          },
          signature,
        );
      }
      return verifySignature(
        "sha256",
        materialBytes,
        { key, dsaEncoding: "der" },
        signature,
      );
    } catch {
      return false;
    } finally {
      signature.fill(0);
      materialBytes.fill(0);
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.token = null;
    this.identityValidated = false;
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("GCP Cloud KMS signing provider is closed.");
  }

  private async assertRuntimeReady(): Promise<void> {
    if (this.identityValidated) return;
    assertGcpRuntimeConfiguration(this.env);

    const contract = productionKeyManagementContract(this.env);
    if (!contract || contract.provider !== "gcp-cloud-kms") {
      throw new Error("GCP Cloud KMS signing provider requires the Cloud KMS production contract.");
    }
    if (contract.region !== GCP_KSA_PRIMARY_REGION) {
      throw new Error(`GCP Cloud KMS signing provider must remain in '${GCP_KSA_PRIMARY_REGION}'.`);
    }
    const domain = contract.domains.find((candidate) => candidate.label === "clinical-document-attestation");
    if (!domain || domain.keyRef !== this.keyId || domain.usage !== "sign-verify") {
      throw new Error(
        "GCP Cloud KMS signing key is not the approved clinical-document sign-verify key reference.",
      );
    }

    const projectId = required(this.env, "GCP_PROJECT_ID");
    assertProjectOwnership(projectId, this.keyId);
    validateVersionRef(
      required(this.env, "CAREPOINT_DOCUMENT_SIGNING_KEY_VERSION_REF"),
      this.keyId,
    );

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

  private async configuredSigningVersion(): Promise<SigningVersion> {
    const configuredVersionRef = validateVersionRef(
      required(this.env, "CAREPOINT_DOCUMENT_SIGNING_KEY_VERSION_REF"),
      this.keyId,
    );

    const key = await this.authorizedJson(
      this.keyUrl(),
      "GET",
      undefined,
      "GCP Cloud KMS signing-key inspection",
    );
    if (stringValue(key.name) !== this.keyId) {
      throw new Error("GCP Cloud KMS signing-key inspection returned an unexpected CryptoKey.");
    }
    if (stringValue(key.purpose)?.toUpperCase() !== "ASYMMETRIC_SIGN") {
      throw new Error("GCP Cloud KMS document signing key must use ASYMMETRIC_SIGN purpose.");
    }

    const version = await this.authorizedJson(
      this.versionUrl(configuredVersionRef),
      "GET",
      undefined,
      "GCP Cloud KMS signing-version inspection",
    );
    if (stringValue(version.name) !== configuredVersionRef) {
      throw new Error("GCP Cloud KMS signing-version inspection returned an unexpected CryptoKeyVersion.");
    }
    if (stringValue(version.state)?.toUpperCase() !== "ENABLED") {
      throw new Error("GCP Cloud KMS configured signing CryptoKeyVersion must be ENABLED.");
    }
    validateProtectionLevel(version.protectionLevel);
    const providerAlgorithm = stringValue(version.algorithm) ?? "";
    const appAlgorithm = applicationAlgorithm(providerAlgorithm);
    if (!appAlgorithm) {
      throw new Error("GCP Cloud KMS signing CryptoKeyVersion uses an unsupported signing algorithm.");
    }
    return {
      ref: configuredVersionRef,
      providerAlgorithm,
      applicationAlgorithm: appAlgorithm,
    };
  }

  private keyUrl(): string {
    return validateKmsUrl(
      `https://cloudkms.${GCP_KSA_PRIMARY_REGION}.rep.googleapis.com/v1/${this.keyId}`,
      `/v1/${this.keyId}`,
    ).toString();
  }

  private versionUrl(versionRef: string): string {
    validateVersionRef(versionRef, this.keyId);
    return validateKmsUrl(
      `https://cloudkms.${GCP_KSA_PRIMARY_REGION}.rep.googleapis.com/v1/${versionRef}`,
      `/v1/${versionRef}`,
    ).toString();
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

  private async authorizedJson(
    url: string,
    method: "GET" | "POST",
    body: JsonRecord | undefined,
    label: string,
  ): Promise<JsonRecord> {
    const parsed = validateAuthorizedActionUrl(url, this.keyId);
    let response: Response;
    try {
      response = await this.fetchImpl(parsed, {
        method,
        headers: {
          Authorization: `Bearer ${await this.accessToken()}`,
          Accept: "application/json",
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
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
    throw new Error("GCP Cloud KMS signing provider is restricted to GCP production.");
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
  fetchImpl: GcpKmsSigningFetch,
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
  fetchImpl: GcpKmsSigningFetch,
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

function validateKmsUrl(value: string, expectedPath: string): URL {
  const url = new URL(value);
  const expectedHost = `cloudkms.${GCP_KSA_PRIMARY_REGION}.rep.googleapis.com`;
  if (url.protocol !== "https:" || url.hostname.toLowerCase() !== expectedHost) {
    throw new Error("GCP Cloud KMS signing provider attempted to use an unapproved regional endpoint.");
  }
  if (url.username || url.password || (url.port && url.port !== "443") || url.search || url.hash) {
    throw new Error("GCP Cloud KMS signing endpoint contains forbidden URL components.");
  }
  if (decodeURIComponent(url.pathname) !== expectedPath) {
    throw new Error("GCP Cloud KMS signing endpoint references an unexpected resource.");
  }
  return url;
}

function validateAuthorizedActionUrl(value: string, keyId: string): URL {
  const url = new URL(value);
  const expectedHost = `cloudkms.${GCP_KSA_PRIMARY_REGION}.rep.googleapis.com`;
  if (url.protocol !== "https:" || url.hostname.toLowerCase() !== expectedHost) {
    throw new Error("GCP Cloud KMS signing provider attempted to use an unapproved regional endpoint.");
  }
  if (url.username || url.password || (url.port && url.port !== "443") || url.search || url.hash) {
    throw new Error("GCP Cloud KMS signing endpoint contains forbidden URL components.");
  }

  const path = decodeURIComponent(url.pathname);
  const keyPath = `/v1/${keyId}`;
  const versionPrefix = `${keyPath}/cryptoKeyVersions/`;
  if (path === keyPath) return url;
  if (!path.startsWith(versionPrefix)) {
    throw new Error("GCP Cloud KMS signing endpoint references a CryptoKey outside the configured signing key.");
  }
  const suffix = path.slice(versionPrefix.length);
  if (
    !/^[1-9]\d*$/.test(suffix)
    && !/^[1-9]\d*:asymmetricSign$/.test(suffix)
    && !/^[1-9]\d*\/publicKey$/.test(suffix)
  ) {
    throw new Error("GCP Cloud KMS signing endpoint references an unsupported CryptoKeyVersion action.");
  }
  return url;
}

function validateVersionRef(value: string, keyId: string): string {
  const ref = value.trim();
  const prefix = `${keyId}/cryptoKeyVersions/`;
  if (!ref.startsWith(prefix) || !/^[1-9]\d*$/.test(ref.slice(prefix.length))) {
    throw new Error(
      "CAREPOINT_DOCUMENT_SIGNING_KEY_VERSION_REF must be a numeric CryptoKeyVersion under CAREPOINT_DOCUMENT_SIGNING_KEY_REF.",
    );
  }
  return ref;
}

function decodeSha256Digest(value: string): Buffer {
  const digest = value.trim();
  if (!/^[a-fA-F0-9]{64}$/.test(digest)) {
    throw new Error("Document attestation payload digest must be a SHA-256 hexadecimal digest.");
  }
  return Buffer.from(digest, "hex");
}

function applicationAlgorithm(providerAlgorithm: string): GcpDocumentSigningAlgorithm | null {
  const normalized = providerAlgorithm.trim().toUpperCase();
  if (RSA_PSS_SHA256_ALGORITHMS.has(normalized)) return "GCP-KMS-RSA-PSS-SHA256";
  if (normalized === ECDSA_P256_SHA256_ALGORITHM) return "GCP-KMS-ECDSA-P256-SHA256";
  return null;
}

function parseApplicationAlgorithm(value: string | null | undefined): GcpDocumentSigningAlgorithm | null {
  if (value === "GCP-KMS-RSA-PSS-SHA256" || value === "GCP-KMS-ECDSA-P256-SHA256") {
    return value;
  }
  return null;
}

function encodeSignatureEnvelope(versionRef: string, signature: string): string {
  return `${SIGNATURE_ENVELOPE_PREFIX}|${versionRef}|${signature}`;
}

function decodeSignatureEnvelope(
  value: string,
  keyId: string,
): { versionRef: string; signature: string } | null {
  const parts = value.split("|");
  if (parts.length !== 3 || parts[0] !== SIGNATURE_ENVELOPE_PREFIX) return null;
  try {
    return {
      versionRef: validateVersionRef(parts[1] ?? "", keyId),
      signature: validateCanonicalBase64String(parts[2], "GCP Cloud KMS signature"),
    };
  } catch {
    return null;
  }
}

function validateCanonicalBase64String(value: string | undefined, label: string): string {
  const bytes = decodeCanonicalBase64(value, label);
  try {
    return bytes.toString("base64");
  } finally {
    bytes.fill(0);
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

function validateProtectionLevel(value: unknown): void {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (normalized !== "SOFTWARE" && normalized !== "HSM") {
    throw new Error("GCP Cloud KMS signing resource must use SOFTWARE or HSM protection.");
  }
}

function verifyCrc32c(bytes: Uint8Array, value: unknown, label: string): void {
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

function verifyPemCrc32c(pem: string, value: unknown): void {
  const bytes = Buffer.from(pem, "utf8");
  try {
    verifyCrc32c(bytes, value, "GCP Cloud KMS public key PEM");
  } finally {
    bytes.fill(0);
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

function validatePublicKeyPem(value: unknown): string {
  if (typeof value !== "string") throw new Error("GCP Cloud KMS public key PEM is missing.");
  const bytes = Buffer.byteLength(value, "utf8");
  if (
    bytes < 64
    || bytes > MAX_PUBLIC_KEY_PEM_BYTES
    || !value.startsWith("-----BEGIN PUBLIC KEY-----")
    || !value.trimEnd().endsWith("-----END PUBLIC KEY-----")
    || value.includes("\0")
  ) {
    throw new Error("GCP Cloud KMS public key PEM is invalid.");
  }
  return value;
}

function parsePublicKey(pem: string, algorithm: GcpDocumentSigningAlgorithm): KeyObject {
  let key: KeyObject;
  try {
    key = createPublicKey(pem);
  } catch {
    throw new Error("GCP Cloud KMS returned an invalid public key.");
  }
  const type = key.asymmetricKeyType;
  if (algorithm === "GCP-KMS-RSA-PSS-SHA256") {
    if (type !== "rsa" && type !== "rsa-pss") {
      throw new Error("GCP Cloud KMS public key type does not match RSA-PSS signing algorithm.");
    }
    return key;
  }
  if (type !== "ec") {
    throw new Error("GCP Cloud KMS public key type does not match ECDSA signing algorithm.");
  }
  const curve = key.asymmetricKeyDetails?.namedCurve;
  if (curve && curve !== "prime256v1" && curve !== "secp256r1" && curve !== "P-256") {
    throw new Error("GCP Cloud KMS ECDSA public key is not P-256.");
  }
  return key;
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
    throw new Error("GCP Cloud KMS signing key reference must belong to GCP_PROJECT_ID in the approved region.");
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
