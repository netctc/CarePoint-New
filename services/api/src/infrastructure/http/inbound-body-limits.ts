export interface InboundBodyLimits {
  jsonBytes: number;
  formBytes: number;
}

const DEFAULT_JSON_BODY_LIMIT_BYTES = 1_048_576;
const DEFAULT_FORM_BODY_LIMIT_BYTES = 131_072;
const MIN_JSON_BODY_LIMIT_BYTES = 4_096;
const MAX_JSON_BODY_LIMIT_BYTES = 16_777_216;
const MIN_FORM_BODY_LIMIT_BYTES = 4_096;
const MAX_FORM_BODY_LIMIT_BYTES = 1_048_576;

export function assertProductionInboundBodyLimitsReady(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV !== "production") return;
  if (!env.JSON_BODY_LIMIT_BYTES?.trim()) throw new Error("JSON_BODY_LIMIT_BYTES is required in production.");
  if (!env.FORM_BODY_LIMIT_BYTES?.trim()) throw new Error("FORM_BODY_LIMIT_BYTES is required in production.");
  inboundBodyLimits(env);
}

export function inboundBodyLimits(env: NodeJS.ProcessEnv = process.env): InboundBodyLimits {
  return {
    jsonBytes: boundedBodyLimit(
      env.JSON_BODY_LIMIT_BYTES,
      DEFAULT_JSON_BODY_LIMIT_BYTES,
      MIN_JSON_BODY_LIMIT_BYTES,
      MAX_JSON_BODY_LIMIT_BYTES,
      "JSON_BODY_LIMIT_BYTES",
    ),
    formBytes: boundedBodyLimit(
      env.FORM_BODY_LIMIT_BYTES,
      DEFAULT_FORM_BODY_LIMIT_BYTES,
      MIN_FORM_BODY_LIMIT_BYTES,
      MAX_FORM_BODY_LIMIT_BYTES,
      "FORM_BODY_LIMIT_BYTES",
    ),
  };
}

function boundedBodyLimit(
  configured: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  name: string,
): number {
  const raw = configured?.trim() || String(fallback);
  if (!/^\d+$/.test(raw)) throw new Error(`${name} must be an integer byte count.`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum} bytes.`);
  }
  return value;
}
