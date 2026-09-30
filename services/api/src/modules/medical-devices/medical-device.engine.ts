import {
  createHash,
  createPublicKey,
  generateKeyPairSync,
  verify,
} from "node:crypto";

export const DEVICE_REQUEST_SKEW_MS = 5 * 60 * 1000;
export const DEVICE_MEASUREMENT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const DEVICE_MEASUREMENT_FUTURE_MS = 5 * 60 * 1000;

export type DeviceMeasurementInput = {
  code: string;
  value: number;
  unitCode: string;
  observedAt: string;
  glucoseContext: string | null;
};

export function normalizeDeviceMeasurement(raw: Record<string, unknown>, now = new Date()): DeviceMeasurementInput {
  const code = token(raw.code, "code", 80);
  const unitCode = token(raw.unitCode, "unitCode", 40);
  if (typeof raw.value !== "number" || !Number.isFinite(raw.value)) throw new Error("value must be a finite number.");
  if (typeof raw.observedAt !== "string") throw new Error("observedAt is required.");
  const observedAt = new Date(raw.observedAt);
  if (!Number.isFinite(observedAt.getTime())) throw new Error("observedAt must be a valid ISO date-time.");
  if (observedAt.getTime() > now.getTime() + DEVICE_MEASUREMENT_FUTURE_MS) throw new Error("observedAt is too far in the future.");
  if (observedAt.getTime() < now.getTime() - DEVICE_MEASUREMENT_MAX_AGE_MS) throw new Error("observedAt is too old for device ingestion.");
  const glucoseContext = raw.glucoseContext == null || raw.glucoseContext === ""
    ? null
    : token(raw.glucoseContext, "glucoseContext", 40);
  return { code, value: raw.value, unitCode, observedAt: observedAt.toISOString(), glucoseContext };
}

export function assertSignedEventTimestamp(value: string, now = new Date()): string {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error("Device event timestamp is invalid.");
  if (Math.abs(now.getTime() - parsed.getTime()) > DEVICE_REQUEST_SKEW_MS) {
    throw new Error("Device event timestamp is outside the replay-protection window.");
  }
  return parsed.toISOString();
}

export function signatureMessage(subject: string, timestamp: string, eventId: string, body: unknown): string {
  return [subject, timestamp, eventId, stableJson(body)].join("\n");
}

export function verifyEd25519(publicKeyPem: string, message: string, signatureBase64: string): boolean {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(signatureBase64) || signatureBase64.length % 4 !== 0) return false;
  try {
    const key = createPublicKey(publicKeyPem);
    if (key.asymmetricKeyType !== "ed25519") return false;
    const signature = Buffer.from(signatureBase64, "base64");
    return signature.length === 64 && verify(null, Buffer.from(message, "utf8"), key, signature);
  } catch {
    return false;
  }
}

export function normalizeEd25519PublicKey(publicKeyPem: string): { pem: string; fingerprint: string } {
  try {
    const key = createPublicKey(publicKeyPem.trim());
    if (key.asymmetricKeyType !== "ed25519") throw new Error("Webhook/device key must be Ed25519.");
    const pem = key.export({ format: "pem", type: "spki" }).toString();
    return { pem, fingerprint: publicKeyFingerprint(pem) };
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : "Invalid Ed25519 public key.");
  }
}

export function generateDeviceCredential(): { publicKeyPem: string; privateKeyPem: string; fingerprint: string } {
  const pair = generateKeyPairSync("ed25519");
  const publicKeyPem = pair.publicKey.export({ format: "pem", type: "spki" }).toString();
  const privateKeyPem = pair.privateKey.export({ format: "pem", type: "pkcs8" }).toString();
  return { publicKeyPem, privateKeyPem, fingerprint: publicKeyFingerprint(publicKeyPem) };
}

export function publicKeyFingerprint(publicKeyPem: string): string {
  const key = createPublicKey(publicKeyPem);
  const der = key.export({ format: "der", type: "spki" });
  return createHash("sha256").update(der).digest("hex");
}

export function payloadDigest(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

export function normalizeEventId(value: unknown): string {
  if (typeof value !== "string") throw new Error("externalEventId is required.");
  const normalized = value.trim();
  if (!/^[A-Za-z0-9_.:-]{8,180}$/.test(normalized)) throw new Error("externalEventId is invalid.");
  return normalized;
}

export function normalizeDeviceType(value: unknown): string {
  const normalized = token(value, "deviceType", 64);
  if (!new Set(["BLOOD_PRESSURE","PULSE_OXIMETER","GLUCOSE_METER","WEARABLE","OTHER"]).has(normalized)) {
    throw new Error("deviceType is unsupported.");
  }
  return normalized;
}

export function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(stableJson).join(",") + "]";
  const object = value as Record<string, unknown>;
  return "{" + Object.keys(object).sort().map((key) => JSON.stringify(key) + ":" + stableJson(object[key])).join(",") + "}";
}

function token(value: unknown, field: string, max: number): string {
  if (typeof value !== "string") throw new Error(`${field} is required.`);
  const normalized = value.trim().toUpperCase();
  if (!normalized || normalized.length > max || !/^[A-Z][A-Z0-9_.:-]*$/.test(normalized)) {
    throw new Error(`${field} is invalid.`);
  }
  return normalized;
}
