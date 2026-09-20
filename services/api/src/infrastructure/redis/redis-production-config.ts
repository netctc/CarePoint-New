import { readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import type { RedisOptions } from "ioredis";
import { isolatedSyntheticPrivatePilotActive } from "../release/private-pilot-infrastructure-profile";

export interface RedisRuntimeConnection {
  url: string;
  options: RedisOptions;
}

export function redisRuntimeConnection(env: NodeJS.ProcessEnv = process.env): RedisRuntimeConnection | null {
  const raw = env.REDIS_URL?.trim();
  if (!raw) {
    if (env.NODE_ENV === "production") throw new Error("REDIS_URL is required in production.");
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("REDIS_URL must be a valid Redis URL.");
  }

  if (parsed.protocol !== "redis:" && parsed.protocol !== "rediss:") {
    throw new Error("REDIS_URL must use the redis:// or rediss:// scheme.");
  }

  const isolatedSyntheticPilot = env.NODE_ENV === "production" && isolatedSyntheticPrivatePilotActive(env);
  if (env.NODE_ENV === "production") {
    if (isolatedSyntheticPilot) {
      if (!parsed.password) throw new Error("Isolated synthetic pilot REDIS_URL must include authentication credentials.");
    } else {
      if (parsed.protocol !== "rediss:") throw new Error("Production REDIS_URL must use rediss:// TLS.");
      if (!parsed.password) throw new Error("Production REDIS_URL must include Redis authentication credentials.");
      if (isLocalHost(parsed.hostname)) throw new Error("Production REDIS_URL must not target a local loopback host.");
      if (env.REDIS_TLS_REJECT_UNAUTHORIZED?.trim().toLowerCase() === "false") {
        throw new Error("Disabling Redis TLS certificate verification is forbidden in production.");
      }
    }
  }

  const options: RedisOptions = {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: positiveInteger(env.REDIS_CONNECT_TIMEOUT_MS ?? "3000", "REDIS_CONNECT_TIMEOUT_MS"),
    enableReadyCheck: true,
    connectionName: "carepoint-api",
  };

  if (
    env.NODE_ENV === "production"
    && !isolatedSyntheticPilot
    && env.CAREPOINT_CLOUD_PROVIDER?.trim().toLowerCase() === "gcp"
  ) {
    options.tls = gcpMemorystoreTlsOptions(env);
  }

  return {
    url: raw,
    options,
  };
}

function gcpMemorystoreTlsOptions(env: NodeJS.ProcessEnv): NonNullable<RedisOptions["tls"]> {
  const path = env.REDIS_TLS_CA_FILE?.trim();
  if (!path) {
    throw new Error("REDIS_TLS_CA_FILE is required for GCP Memorystore production TLS.");
  }
  if (!isAbsolute(path)) {
    throw new Error("REDIS_TLS_CA_FILE must be an absolute mounted-file path.");
  }

  let pem: string;
  try {
    pem = readFileSync(path, "utf8");
  } catch {
    throw new Error("REDIS_TLS_CA_FILE could not be read for GCP Memorystore production TLS.");
  }
  if (Buffer.byteLength(pem, "utf8") > 256 * 1024) {
    throw new Error("REDIS_TLS_CA_FILE exceeds the permitted CA bundle size.");
  }
  const beginCount = (pem.match(/-----BEGIN CERTIFICATE-----/g) ?? []).length;
  const endCount = (pem.match(/-----END CERTIFICATE-----/g) ?? []).length;
  if (beginCount < 1 || beginCount !== endCount) {
    throw new Error("REDIS_TLS_CA_FILE must contain one or more complete PEM certificates.");
  }

  return {
    ca: pem,
    rejectUnauthorized: true,
    minVersion: "TLSv1.2",
  };
}

function isLocalHost(hostname: string): boolean {
  const value = hostname.trim().toLowerCase().replace(/^\[|\]$/g, "");
  return value === "localhost" || value === "127.0.0.1" || value === "::1" || value.endsWith(".localhost");
}

function positiveInteger(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer.`);
  return parsed;
}
