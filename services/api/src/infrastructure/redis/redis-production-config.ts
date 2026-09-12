import type { RedisOptions } from "ioredis";

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

  if (env.NODE_ENV === "production") {
    if (parsed.protocol !== "rediss:") throw new Error("Production REDIS_URL must use rediss:// TLS.");
    if (!parsed.password) throw new Error("Production REDIS_URL must include Redis authentication credentials.");
    if (isLocalHost(parsed.hostname)) throw new Error("Production REDIS_URL must not target a local loopback host.");
    if (env.REDIS_TLS_REJECT_UNAUTHORIZED?.trim().toLowerCase() === "false") {
      throw new Error("Disabling Redis TLS certificate verification is forbidden in production.");
    }
  }

  return {
    url: raw,
    options: {
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      connectTimeout: positiveInteger(env.REDIS_CONNECT_TIMEOUT_MS ?? "3000", "REDIS_CONNECT_TIMEOUT_MS"),
      enableReadyCheck: true,
      connectionName: "carepoint-api",
    },
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
