const DEFAULT_MAX_RESPONSE_BYTES = 65_536;
const MIN_MAX_RESPONSE_BYTES = 4_096;
const MAX_MAX_RESPONSE_BYTES = 1_048_576;

export class ProviderResponsePolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderResponsePolicyError";
  }
}

export function externalProviderMaxResponseBytes(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.EXTERNAL_PROVIDER_MAX_RESPONSE_BYTES?.trim();
  if (!raw) {
    if (env.NODE_ENV === "production") {
      throw new ProviderResponsePolicyError("EXTERNAL_PROVIDER_MAX_RESPONSE_BYTES is required in production.");
    }
    return DEFAULT_MAX_RESPONSE_BYTES;
  }
  if (!/^\d+$/.test(raw)) {
    throw new ProviderResponsePolicyError("EXTERNAL_PROVIDER_MAX_RESPONSE_BYTES must be an integer.");
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < MIN_MAX_RESPONSE_BYTES || value > MAX_MAX_RESPONSE_BYTES) {
    throw new ProviderResponsePolicyError(
      `EXTERNAL_PROVIDER_MAX_RESPONSE_BYTES must be between ${MIN_MAX_RESPONSE_BYTES} and ${MAX_MAX_RESPONSE_BYTES}.`,
    );
  }
  return value;
}

export function assertProductionProviderResponsePolicyReady(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV !== "production") return;
  externalProviderMaxResponseBytes(env);
}

export async function readBoundedProviderJsonObject(
  response: Response,
  env: NodeJS.ProcessEnv = process.env,
): Promise<Record<string, unknown>> {
  const maxBytes = externalProviderMaxResponseBytes(env);
  validateContentType(response.headers.get("content-type"));
  validateDeclaredLength(response.headers.get("content-length"), maxBytes);

  if (!response.body) throw new ProviderResponsePolicyError("Provider response body is missing.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new ProviderResponsePolicyError("Provider response body exceeds the configured size limit.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  if (totalBytes < 1) throw new ProviderResponsePolicyError("Provider response body is empty.");
  const body = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), totalBytes);
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    throw new ProviderResponsePolicyError("Provider response is not valid UTF-8.");
  } finally {
    body.fill(0);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new ProviderResponsePolicyError("Provider response is not valid JSON.");
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new ProviderResponsePolicyError("Provider response JSON must be an object.");
  }
  return payload as Record<string, unknown>;
}

export async function discardProviderResponseBody(response: Response): Promise<void> {
  if (!response.body) return;
  await response.body.cancel().catch(() => undefined);
}

function validateContentType(raw: string | null): void {
  if (!raw?.trim()) throw new ProviderResponsePolicyError("Provider response Content-Type is required.");
  const mediaType = raw.split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType !== "application/json" && !mediaType?.endsWith("+json")) {
    throw new ProviderResponsePolicyError("Provider response Content-Type must be JSON.");
  }
}

function validateDeclaredLength(raw: string | null, maxBytes: number): void {
  if (!raw?.trim()) return;
  if (!/^\d+$/.test(raw.trim())) throw new ProviderResponsePolicyError("Provider response Content-Length is invalid.");
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) throw new ProviderResponsePolicyError("Provider response Content-Length is invalid.");
  if (value > maxBytes) throw new ProviderResponsePolicyError("Provider response Content-Length exceeds the configured size limit.");
}
