import { Injectable } from "@nestjs/common";
import { ExternalSecretResolverService } from "../secrets/external-secret-resolver.service";
import type { SiemAuditEventPayload } from "./siem-event-presenter.service";

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 30_000;

export interface SiemGatewayConfiguration {
  enabled: boolean;
  endpoint: string | null;
  apiKey: string | null;
  timeoutMs: number;
}

export function siemGatewayConfiguration(env: NodeJS.ProcessEnv = process.env): SiemGatewayConfiguration {
  const enabled = booleanEnv(env.SIEM_EXPORT_ENABLED, false, "SIEM_EXPORT_ENABLED");
  const timeoutMs = integerEnv(env.SIEM_EXPORT_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, 1_000, MAX_TIMEOUT_MS, "SIEM_EXPORT_TIMEOUT_MS");
  const rawEndpoint = env.SIEM_EXPORT_URL?.trim() || null;
  const apiKey = env.SIEM_EXPORT_API_KEY?.trim() || null;
  const encryptedApiKeyFile = env.SIEM_EXPORT_API_KEY_KMS_FILE?.trim() || null;

  if (env.NODE_ENV === "production" && !enabled) {
    throw new Error("SIEM_EXPORT_ENABLED=true is required in production for Phase C9 audit forwarding.");
  }
  if (!enabled) return { enabled, endpoint: null, apiKey: null, timeoutMs };
  if (!rawEndpoint) throw new Error("SIEM_EXPORT_URL is required when SIEM export is enabled.");

  const endpoint = validatedEndpoint(rawEndpoint, env.NODE_ENV === "production");
  if (!apiKey && !encryptedApiKeyFile) throw new Error("SIEM export requires an API key source when enabled.");
  if (apiKey && (apiKey.length < 16 || apiKey.length > 4096)) throw new Error("SIEM_EXPORT_API_KEY must be between 16 and 4096 characters.");

  return { enabled, endpoint, apiKey, timeoutMs };
}

@Injectable()
export class SiemGatewayService {
  constructor(private readonly secrets: ExternalSecretResolverService = new ExternalSecretResolverService()) {}

  assertProductionReady(): void {
    void siemGatewayConfiguration();
  }

  async send(payload: SiemAuditEventPayload): Promise<void> {
    const config = siemGatewayConfiguration();
    if (!config.enabled || !config.endpoint) return;
    const apiKey = await this.secrets.resolve("siem-export-api-key");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
    timeout.unref?.();
    try {
      const response = await fetch(config.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "accept": "application/json",
          "authorization": `Bearer ${apiKey}`,
          "idempotency-key": payload.eventRef,
          "x-carepoint-event-ref": payload.eventRef,
        },
        body: JSON.stringify(payload),
        redirect: "error",
        signal: controller.signal,
      });
      if (!response.ok) throw new SiemGatewayHttpError(response.status);
    } finally {
      clearTimeout(timeout);
    }
  }
}

export class SiemGatewayHttpError extends Error {
  constructor(readonly statusCode: number) {
    super(`SIEM gateway returned HTTP ${statusCode}.`);
    this.name = "SiemGatewayHttpError";
  }
}

function validatedEndpoint(value: string, production: boolean): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("SIEM_EXPORT_URL must be a valid URL.");
  }
  if (url.username || url.password) throw new Error("SIEM_EXPORT_URL must not contain embedded credentials.");
  if (url.hash) throw new Error("SIEM_EXPORT_URL must not contain a URL fragment.");
  if (production && url.protocol !== "https:") throw new Error("SIEM_EXPORT_URL must use HTTPS in production.");
  if (!production && url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("SIEM_EXPORT_URL must use HTTP or HTTPS.");
  }
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]") {
    if (production) throw new Error("SIEM_EXPORT_URL must not target loopback in production.");
  }
  return url.toString();
}

function integerEnv(raw: string | undefined, fallback: number, min: number, max: number, name: string): number {
  if (!raw?.trim()) return fallback;
  if (!/^\d+$/.test(raw.trim())) throw new Error(`${name} must be an integer.`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${name} must be between ${min} and ${max}.`);
  return value;
}

function booleanEnv(raw: string | undefined, fallback: boolean, name: string): boolean {
  if (!raw?.trim()) return fallback;
  const normalized = raw.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  throw new Error(`${name} must be true or false.`);
}
