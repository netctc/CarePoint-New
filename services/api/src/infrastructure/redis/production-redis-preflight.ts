import Redis from "ioredis";
import { randomUUID } from "node:crypto";
import { redisRuntimeConnection, type RedisRuntimeConnection } from "./redis-production-config";

export type RedisPersistenceMode = "aof" | "rdb" | "managed";

export interface ProductionRedisInspection {
  ping: string;
  role: string;
  connectedReplicas: number;
  clusterEnabled: boolean;
  aofEnabled: boolean;
  aofLastWriteStatus?: string | undefined;
  rdbLastSaveTime: number;
  rdbLastBgsaveStatus?: string | undefined;
  writeProbeVerified: boolean;
}

export type InspectProductionRedis = (connection: RedisRuntimeConnection) => Promise<ProductionRedisInspection>;

export interface ProductionRedisPreflightOptions {
  inspectRedis?: InspectProductionRedis;
}

export async function assertProductionRedisReady(options: ProductionRedisPreflightOptions = {}): Promise<void> {
  if (process.env.NODE_ENV !== "production") return;

  const connection = redisRuntimeConnection(process.env);
  if (!connection) throw new Error("Production Redis connection is unavailable.");
  const minReplicas = nonNegativeInteger(process.env.REDIS_MIN_REPLICAS ?? "1", "REDIS_MIN_REPLICAS");
  const persistenceMode = persistenceModeFromEnv(process.env.REDIS_PERSISTENCE_MODE);
  const inspectRedis = options.inspectRedis ?? liveRedisInspector;

  let inspection: ProductionRedisInspection;
  try {
    inspection = await inspectRedis(connection);
  } catch (error) {
    throw new Error(`Production Redis preflight could not verify Redis readiness: ${errorMessage(error)}`);
  }

  if (inspection.ping !== "PONG") throw new Error("Production Redis preflight requires a successful PING response.");
  if (inspection.role !== "master") throw new Error(`Production Redis endpoint must be a writable master, got '${inspection.role}'.`);
  if (!inspection.writeProbeVerified) throw new Error("Production Redis write/read/delete probe failed.");
  if (inspection.clusterEnabled) {
    throw new Error("Redis Cluster mode is not supported by the current CarePoint Redis runtime; use a non-clustered primary endpoint with replicas.");
  }
  if (!Number.isInteger(inspection.connectedReplicas) || inspection.connectedReplicas < minReplicas) {
    throw new Error(`Production Redis requires at least ${minReplicas} connected replica(s), got ${inspection.connectedReplicas}.`);
  }

  if (persistenceMode === "aof") {
    if (!inspection.aofEnabled) throw new Error("REDIS_PERSISTENCE_MODE=aof requires aof_enabled=1.");
    if (inspection.aofLastWriteStatus && inspection.aofLastWriteStatus.toLowerCase() !== "ok") {
      throw new Error(`Redis AOF last write status is '${inspection.aofLastWriteStatus}', expected 'ok'.`);
    }
  } else if (persistenceMode === "rdb") {
    if (!Number.isFinite(inspection.rdbLastSaveTime) || inspection.rdbLastSaveTime <= 0) {
      throw new Error("REDIS_PERSISTENCE_MODE=rdb requires a valid rdb_last_save_time.");
    }
    if ((inspection.rdbLastBgsaveStatus ?? "").toLowerCase() !== "ok") {
      throw new Error(`Redis RDB last background-save status is '${inspection.rdbLastBgsaveStatus ?? "unknown"}', expected 'ok'.`);
    }
  }
}

function liveRedisInspector(connection: RedisRuntimeConnection): Promise<ProductionRedisInspection> {
  return inspectWithClient(new Redis(connection.url, connection.options));
}

async function inspectWithClient(client: Redis): Promise<ProductionRedisInspection> {
  const probeKey = `carepoint:preflight:${randomUUID()}`;
  const probeValue = randomUUID();
  try {
    await client.connect();
    const ping = await client.ping();
    const roleResult = await client.role();
    const role = Array.isArray(roleResult) && typeof roleResult[0] === "string" ? roleResult[0] : "unknown";

    const setResult = await client.set(probeKey, probeValue, "EX", 30, "NX");
    const readBack = setResult === "OK" ? await client.get(probeKey) : null;
    const deleted = await client.del(probeKey);
    const writeProbeVerified = setResult === "OK" && readBack === probeValue && deleted === 1;

    const [replicationRaw, persistenceRaw, clusterRaw] = await Promise.all([
      client.info("replication"),
      client.info("persistence"),
      client.info("cluster"),
    ]);
    const replication = parseInfo(replicationRaw);
    const persistence = parseInfo(persistenceRaw);
    const cluster = parseInfo(clusterRaw);

    return {
      ping,
      role,
      connectedReplicas: integerInfo(replication, "connected_slaves", "connected_replicas"),
      clusterEnabled: cluster.cluster_enabled === "1",
      aofEnabled: persistence.aof_enabled === "1",
      aofLastWriteStatus: persistence.aof_last_write_status,
      rdbLastSaveTime: Number(persistence.rdb_last_save_time ?? 0),
      rdbLastBgsaveStatus: persistence.rdb_last_bgsave_status,
      writeProbeVerified,
    };
  } finally {
    try {
      await client.del(probeKey);
    } catch {
      // Best-effort cleanup only; the probe has a short TTL.
    }
    try {
      await client.quit();
    } catch {
      client.disconnect();
    }
  }
}

function parseInfo(value: string): Record<string, string> {
  const output: Record<string, string> = {};
  for (const rawLine of value.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    output[line.slice(0, separator)] = line.slice(separator + 1);
  }
  return output;
}

function integerInfo(input: Record<string, string>, ...names: string[]): number {
  for (const name of names) {
    const value = input[name];
    if (value === undefined) continue;
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed >= 0) return parsed;
  }
  return 0;
}

function persistenceModeFromEnv(value: string | undefined): RedisPersistenceMode {
  const mode = value?.trim().toLowerCase();
  if (mode === "aof" || mode === "rdb" || mode === "managed") return mode;
  throw new Error("REDIS_PERSISTENCE_MODE must be explicitly set to 'aof', 'rdb', or 'managed' in production.");
}

function nonNegativeInteger(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${name} must be a non-negative integer.`);
  return parsed;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}
