import { PrismaClient } from "@prisma/client";
import { databaseRuntimeConfiguration, type DatabaseRuntimeConfiguration } from "./database-production-config";

export interface ProductionDatabaseInspection {
  serverVersionNum: number;
  sslActive: boolean;
  sslVersion?: string | undefined;
  sslCipher?: string | undefined;
  inRecovery: boolean;
  transactionReadOnly: boolean;
  walLevel: string;
  archiveMode: string;
  archiveCommandConfigured: boolean;
  streamingReplicas: number;
}

export type InspectProductionDatabase = (configuration: DatabaseRuntimeConfiguration) => Promise<ProductionDatabaseInspection>;

export interface ProductionDatabasePreflightOptions {
  inspectDatabase?: InspectProductionDatabase;
}

type InspectionRow = {
  server_version_num: number;
  ssl_active: boolean;
  ssl_version: string | null;
  ssl_cipher: string | null;
  in_recovery: boolean;
  transaction_read_only: string;
  wal_level: string;
  archive_mode: string;
  archive_command_configured: boolean;
  streaming_replicas: number;
};

export async function assertProductionDatabaseReady(options: ProductionDatabasePreflightOptions = {}): Promise<void> {
  if (process.env.NODE_ENV !== "production") return;

  const configuration = databaseRuntimeConfiguration(process.env);
  const minServerMajor = positiveInteger(process.env.DATABASE_MIN_SERVER_MAJOR ?? "16", "DATABASE_MIN_SERVER_MAJOR");
  const minStreamingReplicas = nonNegativeInteger(
    process.env.DATABASE_MIN_STREAMING_REPLICAS ?? "1",
    "DATABASE_MIN_STREAMING_REPLICAS",
  );
  const inspectDatabase = options.inspectDatabase ?? liveDatabaseInspector;

  let inspection: ProductionDatabaseInspection;
  try {
    inspection = await inspectDatabase(configuration);
  } catch (error) {
    throw new Error(`Production PostgreSQL preflight could not verify database readiness: ${safeErrorMessage(error)}`);
  }

  if (!inspection.sslActive) throw new Error("Production PostgreSQL connection must negotiate TLS.");
  if (inspection.inRecovery) throw new Error("Production DATABASE_URL must target the writable PostgreSQL primary, not a recovery/read replica.");
  if (inspection.transactionReadOnly) throw new Error("Production PostgreSQL connection is read-only; CarePoint requires a writable primary.");

  const serverMajor = Math.floor(inspection.serverVersionNum / 10_000);
  if (!Number.isInteger(serverMajor) || serverMajor < minServerMajor) {
    throw new Error(`Production PostgreSQL server major version must be >= ${minServerMajor}, got ${serverMajor || "unknown"}.`);
  }

  if (configuration.haMode === "replicated") {
    if (!Number.isInteger(inspection.streamingReplicas) || inspection.streamingReplicas < minStreamingReplicas) {
      throw new Error(
        `DATABASE_HA_MODE=replicated requires at least ${minStreamingReplicas} streaming replica(s), got ${inspection.streamingReplicas}.`,
      );
    }
  }

  if (configuration.pitrMode === "native") {
    if (inspection.walLevel !== "replica" && inspection.walLevel !== "logical") {
      throw new Error(`DATABASE_PITR_MODE=native requires wal_level=replica or logical, got '${inspection.walLevel}'.`);
    }
    if (inspection.archiveMode !== "on" && inspection.archiveMode !== "always") {
      throw new Error(`DATABASE_PITR_MODE=native requires archive_mode=on or always, got '${inspection.archiveMode}'.`);
    }
    if (!inspection.archiveCommandConfigured) {
      throw new Error("DATABASE_PITR_MODE=native requires a configured PostgreSQL archive_command.");
    }
  }
}

async function liveDatabaseInspector(_configuration: DatabaseRuntimeConfiguration): Promise<ProductionDatabaseInspection> {
  const client = new PrismaClient();
  try {
    await client.$connect();
    const rows = await client.$queryRawUnsafe<InspectionRow[]>(`
      SELECT
        current_setting('server_version_num')::int AS server_version_num,
        COALESCE((SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()), false) AS ssl_active,
        (SELECT version FROM pg_stat_ssl WHERE pid = pg_backend_pid()) AS ssl_version,
        (SELECT cipher FROM pg_stat_ssl WHERE pid = pg_backend_pid()) AS ssl_cipher,
        pg_is_in_recovery() AS in_recovery,
        current_setting('transaction_read_only') AS transaction_read_only,
        current_setting('wal_level') AS wal_level,
        current_setting('archive_mode') AS archive_mode,
        CASE
          WHEN current_setting('archive_command') = '' THEN false
          WHEN current_setting('archive_command') = '(disabled)' THEN false
          ELSE true
        END AS archive_command_configured,
        (SELECT count(*)::int FROM pg_stat_replication WHERE state = 'streaming') AS streaming_replicas
    `);
    const row = rows[0];
    if (!row) throw new Error("PostgreSQL readiness query returned no rows.");
    return {
      serverVersionNum: Number(row.server_version_num),
      sslActive: row.ssl_active === true,
      sslVersion: row.ssl_version ?? undefined,
      sslCipher: row.ssl_cipher ?? undefined,
      inRecovery: row.in_recovery === true,
      transactionReadOnly: row.transaction_read_only.toLowerCase() === "on",
      walLevel: row.wal_level,
      archiveMode: row.archive_mode,
      archiveCommandConfigured: row.archive_command_configured === true,
      streamingReplicas: Number(row.streaming_replicas),
    };
  } finally {
    await client.$disconnect().catch(() => undefined);
  }
}

function positiveInteger(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer.`);
  return parsed;
}

function nonNegativeInteger(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${name} must be a non-negative integer.`);
  return parsed;
}

function safeErrorMessage(error: unknown): string {
  const source = error instanceof Error && error.message ? error.message : String(error);
  let sanitized = source;
  const rawUrl = process.env.DATABASE_URL?.trim();
  if (rawUrl) {
    sanitized = sanitized.split(rawUrl).join("<database-url>");
    try {
      const parsed = new URL(rawUrl);
      for (const secret of [parsed.password, parsed.username]) {
        if (!secret) continue;
        sanitized = sanitized.split(secret).join("<database-credential>");
        try {
          const decoded = decodeURIComponent(secret);
          if (decoded) sanitized = sanitized.split(decoded).join("<database-credential>");
        } catch {
          // Encoded credential redaction above remains in effect.
        }
      }
    } catch {
      // DATABASE_URL validation occurs before live inspection.
    }
  }
  return sanitized.slice(0, 500);
}
