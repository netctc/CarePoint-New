export type DatabasePoolMode = "direct" | "pgbouncer" | "managed";
export type DatabaseHaMode = "replicated" | "managed";
export type DatabasePitrMode = "native" | "managed";

export interface DatabaseRuntimeConfiguration {
  url: string;
  poolMode: DatabasePoolMode | null;
  haMode: DatabaseHaMode | null;
  pitrMode: DatabasePitrMode | null;
  connectionLimit: number | null;
}

export function databaseRuntimeConfiguration(env: NodeJS.ProcessEnv = process.env): DatabaseRuntimeConfiguration {
  const raw = env.DATABASE_URL?.trim();
  if (!raw) throw new Error("DATABASE_URL is required.");

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL URL.");
  }
  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
    throw new Error("DATABASE_URL must use the postgresql:// or postgres:// scheme.");
  }

  const connectionLimit = optionalPositiveInteger(parsed.searchParams.get("connection_limit"), "DATABASE_URL connection_limit");
  let poolMode: DatabasePoolMode | null = null;
  let haMode: DatabaseHaMode | null = null;
  let pitrMode: DatabasePitrMode | null = null;

  if (env.NODE_ENV === "production") {
    if (!parsed.username || !parsed.password) throw new Error("Production DATABASE_URL must include database authentication credentials.");
    if (isLocalHost(parsed.hostname)) throw new Error("Production DATABASE_URL must not target a local loopback host.");

    const sslMode = parsed.searchParams.get("sslmode")?.trim().toLowerCase();
    if (sslMode !== "require" && sslMode !== "verify-ca" && sslMode !== "verify-full") {
      throw new Error("Production DATABASE_URL must set sslmode=require, verify-ca, or verify-full.");
    }
    if (parsed.searchParams.get("sslaccept")?.trim().toLowerCase() === "accept_invalid_certs") {
      throw new Error("Production DATABASE_URL must not disable PostgreSQL TLS certificate validation.");
    }
    if (!connectionLimit) throw new Error("Production DATABASE_URL must set an explicit positive connection_limit.");

    poolMode = poolModeFromEnv(env.DATABASE_POOL_MODE);
    haMode = haModeFromEnv(env.DATABASE_HA_MODE);
    pitrMode = pitrModeFromEnv(env.DATABASE_PITR_MODE);

    const pgbouncer = parsed.searchParams.get("pgbouncer")?.trim().toLowerCase();
    if (poolMode === "pgbouncer" && pgbouncer !== "true") {
      throw new Error("DATABASE_POOL_MODE=pgbouncer requires pgbouncer=true in DATABASE_URL.");
    }
  }

  return { url: raw, poolMode, haMode, pitrMode, connectionLimit };
}

function poolModeFromEnv(value: string | undefined): DatabasePoolMode {
  const mode = value?.trim().toLowerCase();
  if (mode === "direct" || mode === "pgbouncer" || mode === "managed") return mode;
  throw new Error("DATABASE_POOL_MODE must be explicitly set to 'direct', 'pgbouncer', or 'managed' in production.");
}

function haModeFromEnv(value: string | undefined): DatabaseHaMode {
  const mode = value?.trim().toLowerCase();
  if (mode === "replicated" || mode === "managed") return mode;
  throw new Error("DATABASE_HA_MODE must be explicitly set to 'replicated' or 'managed' in production.");
}

function pitrModeFromEnv(value: string | undefined): DatabasePitrMode {
  const mode = value?.trim().toLowerCase();
  if (mode === "native" || mode === "managed") return mode;
  throw new Error("DATABASE_PITR_MODE must be explicitly set to 'native' or 'managed' in production.");
}

function optionalPositiveInteger(value: string | null, name: string): number | null {
  if (value === null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer.`);
  return parsed;
}

function isLocalHost(hostname: string): boolean {
  const value = hostname.trim().toLowerCase().replace(/^\[|\]$/g, "");
  return value === "localhost" || value === "127.0.0.1" || value === "::1" || value.endsWith(".localhost");
}
