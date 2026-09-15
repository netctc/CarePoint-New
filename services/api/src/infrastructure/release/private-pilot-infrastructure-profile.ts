import { isIP } from "node:net";
import { isAbsolute, resolve } from "node:path";

export const ISOLATED_SYNTHETIC_PILOT_PROFILE = "isolated-synthetic" as const;
export type PrivatePilotInfrastructureProfile = typeof ISOLATED_SYNTHETIC_PILOT_PROFILE | null;

const PILOT_MARKER = /(pilot|staging|uat)/i;
const LOCAL_ENVELOPE_KEYS = [
  "MFA_ENVELOPE_KEY_BASE64",
  "CLINICAL_ENVELOPE_KEY_BASE64",
  "ORDER_ENVELOPE_KEY_BASE64",
  "DOCUMENT_ENVELOPE_KEY_BASE64",
  "MESSAGING_ENVELOPE_KEY_BASE64",
] as const;
const LOCAL_SIGNING_KEYS = ["ORDER_SIGNING_SECRET_BASE64", "DOCUMENT_SIGNING_SECRET_BASE64"] as const;
const LOCAL_KEY_IDS = [
  "MFA_ENVELOPE_KEY_ID",
  "CLINICAL_ENVELOPE_KEY_ID",
  "ORDER_ENVELOPE_KEY_ID",
  "DOCUMENT_ENVELOPE_KEY_ID",
  "MESSAGING_ENVELOPE_KEY_ID",
  "ORDER_SIGNING_KEY_ID",
  "DOCUMENT_SIGNING_KEY_ID",
] as const;

export function privatePilotInfrastructureProfile(
  env: NodeJS.ProcessEnv = process.env,
): PrivatePilotInfrastructureProfile {
  const raw = env.CAREPOINT_PRIVATE_PILOT_INFRA_PROFILE?.trim();
  if (!raw) return null;
  if (raw !== ISOLATED_SYNTHETIC_PILOT_PROFILE) {
    throw new Error(`CAREPOINT_PRIVATE_PILOT_INFRA_PROFILE must be '${ISOLATED_SYNTHETIC_PILOT_PROFILE}' when configured.`);
  }
  assertIsolatedSyntheticPilotConfiguration(env);
  return ISOLATED_SYNTHETIC_PILOT_PROFILE;
}

export function isolatedSyntheticPrivatePilotActive(env: NodeJS.ProcessEnv = process.env): boolean {
  return privatePilotInfrastructureProfile(env) === ISOLATED_SYNTHETIC_PILOT_PROFILE;
}

export function localSyntheticPilotProvidersAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === "production" && isolatedSyntheticPrivatePilotActive(env);
}

export function assertIsolatedSyntheticPilotConfiguration(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV !== "production") {
    throw new Error("The isolated synthetic pilot profile requires NODE_ENV=production.");
  }
  if (env.CAREPOINT_PRIVATE_PILOT?.trim().toLowerCase() !== "true") {
    throw new Error("The isolated synthetic pilot infrastructure profile requires CAREPOINT_PRIVATE_PILOT=true.");
  }
  requiredExact(env, "CAREPOINT_PRIVATE_PILOT_DATA_MODE", "synthetic-only");
  requiredExact(env, "CAREPOINT_PRIVATE_PILOT_AUDIT_MODE", "database-local");
  requiredExact(env, "CAREPOINT_PRIVATE_PILOT_TELEMETRY_MODE", "structured-local");
  requiredExact(env, "CAREPOINT_PRIVATE_PILOT_SMART_FHIR_ENABLED", "false");
  requiredExact(env, "SIEM_EXPORT_ENABLED", "false");
  requiredExact(env, "SIEM_WORKER_ENABLED", "false");

  for (const [name, expected] of [
    ["MFA_KEY_PROVIDER", "local"],
    ["CLINICAL_KEY_PROVIDER", "local"],
    ["ORDER_KEY_PROVIDER", "local"],
    ["ORDER_SIGNING_PROVIDER", "local"],
    ["DOCUMENT_STORAGE_PROVIDER", "local"],
    ["DOCUMENT_KEY_PROVIDER", "local"],
    ["DOCUMENT_SIGNING_PROVIDER", "local"],
    ["DOCUMENT_SCAN_PROVIDER", "mock"],
    ["DICOMWEB_PROVIDER", "mock"],
    ["MESSAGING_KEY_PROVIDER", "local"],
    ["BULK_EXPORT_STORAGE_PROVIDER", "local"],
  ] as const) {
    requiredExact(env, name, expected);
  }

  assertPilotDatabaseUrl(env.DATABASE_URL);
  assertPilotRedisUrl(env.REDIS_URL);

  for (const name of LOCAL_ENVELOPE_KEYS) assertBase64Bytes(env, name, 32, 32);
  for (const name of LOCAL_SIGNING_KEYS) assertBase64Bytes(env, name, 32, 4096);
  for (const name of LOCAL_KEY_IDS) assertPilotMarker(required(env, name), name);

  assertPrivateLocalPath(required(env, "DOCUMENT_STORAGE_LOCAL_ROOT"), "DOCUMENT_STORAGE_LOCAL_ROOT");
  assertPrivateLocalPath(required(env, "BULK_EXPORT_STORAGE_LOCAL_ROOT"), "BULK_EXPORT_STORAGE_LOCAL_ROOT");
  const namespace = required(env, "CAREPOINT_PRIVATE_PILOT_REDIS_NAMESPACE");
  assertPilotMarker(namespace, "CAREPOINT_PRIVATE_PILOT_REDIS_NAMESPACE");

  const releaseVersion = required(env, "CAREPOINT_RELEASE_VERSION");
  if (!releaseVersion.startsWith("0.9-closed-pilot")) {
    throw new Error("CAREPOINT_RELEASE_VERSION must identify the 0.9 closed pilot under the isolated synthetic profile.");
  }
}

export function assertPilotDatabaseUrl(rawValue: string | undefined): void {
  const parsed = parseUrl(rawValue, "DATABASE_URL");
  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
    throw new Error("Isolated synthetic pilot DATABASE_URL must use PostgreSQL.");
  }
  if (!parsed.username || !parsed.password) {
    throw new Error("Isolated synthetic pilot DATABASE_URL must include dedicated authentication credentials.");
  }
  if (!isPrivatePilotHost(parsed.hostname)) {
    throw new Error("Isolated synthetic pilot DATABASE_URL must target loopback/private/internal infrastructure only.");
  }
  const database = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
  assertPilotMarker(database, "DATABASE_URL database name");
  if (!parsed.searchParams.get("connection_limit")) {
    throw new Error("Isolated synthetic pilot DATABASE_URL must set an explicit connection_limit.");
  }
}

export function assertPilotRedisUrl(rawValue: string | undefined): void {
  const parsed = parseUrl(rawValue, "REDIS_URL");
  if (parsed.protocol !== "redis:" && parsed.protocol !== "rediss:") {
    throw new Error("Isolated synthetic pilot REDIS_URL must use redis:// or rediss://.");
  }
  if (!parsed.password) throw new Error("Isolated synthetic pilot REDIS_URL must include authentication credentials.");
  if (!isPrivatePilotHost(parsed.hostname)) {
    throw new Error("Isolated synthetic pilot REDIS_URL must target loopback/private/internal infrastructure only.");
  }
}

export function isPrivatePilotHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!host) return false;
  if (host === "localhost" || host === "::1" || /^127(?:\.|$)/.test(host)) return true;
  const version = isIP(host);
  if (version === 4) {
    const octets = host.split(".").map(Number);
    return octets[0] === 10 || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) || (octets[0] === 192 && octets[1] === 168);
  }
  if (version === 6) return host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:");
  return !host.includes(".") || host.endsWith(".internal") || host.endsWith(".local") || host.endsWith(".lan");
}

function assertPrivateLocalPath(value: string, name: string): void {
  if (!isAbsolute(value)) throw new Error(`${name} must be an absolute path.`);
  const normalized = resolve(value);
  assertPilotMarker(normalized, name);
  if (normalized === "/" || normalized.startsWith("/tmp/carepoint-")) {
    throw new Error(`${name} must use a dedicated restricted pilot path, not a generic temporary root.`);
  }
}

function assertBase64Bytes(
  env: NodeJS.ProcessEnv,
  name: string,
  minimumBytes: number,
  maximumBytes: number,
): void {
  const encoded = required(env, name);
  const decoded = Buffer.from(encoded, "base64");
  if (decoded.toString("base64").replace(/=+$/, "") !== encoded.replace(/\s+/g, "").replace(/=+$/, "")) {
    throw new Error(`${name} must contain canonical base64 key material.`);
  }
  if (decoded.byteLength < minimumBytes || decoded.byteLength > maximumBytes) {
    const expected = minimumBytes === maximumBytes ? `exactly ${minimumBytes}` : `${minimumBytes}-${maximumBytes}`;
    throw new Error(`${name} must decode to ${expected} bytes.`);
  }
}

function requiredExact(env: NodeJS.ProcessEnv, name: string, expected: string): void {
  const actual = required(env, name).toLowerCase();
  if (actual !== expected) throw new Error(`${name} must be '${expected}' for the isolated synthetic pilot.`);
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required for the isolated synthetic pilot infrastructure profile.`);
  return value;
}

function assertPilotMarker(value: string, name: string): void {
  if (!PILOT_MARKER.test(value)) throw new Error(`${name} must contain 'pilot', 'staging', or 'uat'.`);
}

function parseUrl(rawValue: string | undefined, name: string): URL {
  const raw = rawValue?.trim();
  if (!raw) throw new Error(`${name} is required for the isolated synthetic pilot infrastructure profile.`);
  try {
    return new URL(raw);
  } catch {
    throw new Error(`${name} must be a valid URL.`);
  }
}
