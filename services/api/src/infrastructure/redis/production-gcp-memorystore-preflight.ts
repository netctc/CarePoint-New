import { GCP_KSA_PRIMARY_REGION } from "../cloud/production-cloud-provider";
import {
  createProductionGcpMemorystoreInspectionRuntime,
  type GcpMemorystoreInspectionRuntime,
  type InspectGcpMemorystoreInstance,
} from "./gcp-memorystore-inspection-runtime";

export interface ProductionGcpMemorystorePreflightOptions {
  inspectInstance?: InspectGcpMemorystoreInstance;
}

export async function assertProductionGcpMemorystoreReady(
  env: NodeJS.ProcessEnv = process.env,
  options: ProductionGcpMemorystorePreflightOptions = {},
): Promise<void> {
  if (env.NODE_ENV !== "production" || env.CAREPOINT_CLOUD_PROVIDER?.trim() !== "gcp") return;

  let runtime: GcpMemorystoreInspectionRuntime | null = null;
  let inspectInstance = options.inspectInstance;
  if (!inspectInstance) {
    runtime = await createProductionGcpMemorystoreInspectionRuntime(env);
    if (!runtime) {
      throw new Error("GCP Memorystore inspection runtime is unavailable for production Redis preflight.");
    }
    inspectInstance = runtime.inspectInstance;
  }

  try {
    let inspection;
    try {
      inspection = await inspectInstance();
    } catch (error) {
      throw new Error(`Production GCP Memorystore preflight could not inspect the configured instance: ${errorName(error)}.`);
    }

    const projectId = required(env, "GCP_PROJECT_ID");
    const instanceId = required(env, "CAREPOINT_GCP_REDIS_INSTANCE");
    const expectedNetwork = required(env, "CAREPOINT_GCP_REDIS_NETWORK");
    if (inspection.projectId !== projectId) {
      throw new Error("GCP Memorystore instance project does not match GCP_PROJECT_ID.");
    }
    if (inspection.instanceId !== instanceId) {
      throw new Error("GCP Memorystore instance identity does not match CAREPOINT_GCP_REDIS_INSTANCE.");
    }
    if (inspection.region !== GCP_KSA_PRIMARY_REGION) {
      throw new Error(
        `GCP Memorystore instance must remain in '${GCP_KSA_PRIMARY_REGION}', got '${inspection.region || "unknown"}'.`,
      );
    }
    if (inspection.state !== "READY") {
      throw new Error(`GCP Memorystore instance must be READY, got '${inspection.state || "unknown"}'.`);
    }
    if (inspection.tier !== "STANDARD_HA") {
      throw new Error("GCP Memorystore production instance must use STANDARD_HA tier.");
    }
    if (inspection.replicaCount < 1) {
      throw new Error("GCP Memorystore production instance must expose at least one replica.");
    }
    if (!inspection.authEnabled) {
      throw new Error("GCP Memorystore production instance must enable Redis AUTH.");
    }
    if (inspection.transitEncryptionMode !== "SERVER_AUTHENTICATION") {
      throw new Error("GCP Memorystore production instance must enable SERVER_AUTHENTICATION TLS.");
    }
    if (inspection.serverCaCertCount < 1) {
      throw new Error("GCP Memorystore TLS instance must expose at least one server CA certificate.");
    }
    if (inspection.connectMode !== "PRIVATE_SERVICE_ACCESS") {
      throw new Error("GCP Memorystore production instance must use PRIVATE_SERVICE_ACCESS networking.");
    }
    if (inspection.authorizedNetwork !== expectedNetwork) {
      throw new Error("GCP Memorystore authorized network does not match CAREPOINT_GCP_REDIS_NETWORK.");
    }
    if (!validNetworkRef(expectedNetwork, projectId)) {
      throw new Error("CAREPOINT_GCP_REDIS_NETWORK must be a full VPC network resource in GCP_PROJECT_ID.");
    }

    const haZones = memorystoreHaZones(inspection.nodeZones, inspection.locationId, inspection.alternativeLocationId);
    if (haZones.some((zone) => !isRegionZone(zone))) {
      throw new Error(`GCP Memorystore STANDARD_HA nodes must remain inside '${GCP_KSA_PRIMARY_REGION}'.`);
    }
    if (new Set(haZones).size < 2) {
      throw new Error("GCP Memorystore STANDARD_HA must prove placement across at least two distinct Dammam zones.");
    }

    const minRedisMajor = positiveInteger(env.CAREPOINT_GCP_REDIS_MIN_MAJOR ?? "7", "CAREPOINT_GCP_REDIS_MIN_MAJOR");
    const major = redisMajor(inspection.redisVersion);
    if (major === null || major < minRedisMajor) {
      throw new Error(
        `GCP Memorystore Redis major version must be >= ${minRedisMajor}, got '${inspection.redisVersion || "unknown"}'.`,
      );
    }

    const redisUrl = parseRedisUrl(required(env, "REDIS_URL"));
    if (redisUrl.protocol !== "rediss:") {
      throw new Error("GCP Memorystore production REDIS_URL must use rediss:// TLS.");
    }
    if (redisUrl.hostname !== inspection.host) {
      throw new Error("GCP Memorystore REDIS_URL host does not match the inspected Memorystore endpoint.");
    }
    if (inspection.port !== 6378) {
      throw new Error(`GCP Memorystore TLS endpoint must use secure port 6378, got '${inspection.port || "unknown"}'.`);
    }
    const configuredPort = redisUrl.port ? Number(redisUrl.port) : 6379;
    if (!Number.isSafeInteger(configuredPort) || configuredPort !== inspection.port) {
      throw new Error("GCP Memorystore REDIS_URL port does not match the inspected Memorystore endpoint.");
    }
    if ((env.REDIS_PERSISTENCE_MODE ?? "").trim().toLowerCase() !== "managed") {
      throw new Error("GCP Memorystore production requires REDIS_PERSISTENCE_MODE=managed.");
    }
    required(env, "REDIS_TLS_CA_FILE");
  } finally {
    await runtime?.close();
  }
}

function memorystoreHaZones(nodeZones: string[], locationId: string, alternativeLocationId: string): string[] {
  const runtimeZones = nodeZones.map((zone) => zone.trim().toLowerCase()).filter(Boolean);
  if (runtimeZones.length > 0) return [...new Set(runtimeZones)];
  return [locationId, alternativeLocationId]
    .map((zone) => zone.trim().toLowerCase())
    .filter(Boolean);
}

function parseRedisUrl(value: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("REDIS_URL must be a valid Redis URL for GCP Memorystore production preflight.");
  }
  if (/\r|\n|\0/.test(parsed.username) || /\r|\n|\0/.test(parsed.password)) {
    throw new Error("REDIS_URL contains invalid credential characters.");
  }
  return parsed;
}

function redisMajor(value: string): number | null {
  const match = /^REDIS_(\d+)(?:_[A-Z0-9]+)?$/.exec(value.trim().toUpperCase());
  if (!match?.[1]) return null;
  const major = Number(match[1]);
  return Number.isSafeInteger(major) && major > 0 ? major : null;
}

function validNetworkRef(value: string, projectId: string): boolean {
  const match = /^projects\/([a-z][a-z0-9-]{4,28}[a-z0-9])\/global\/networks\/([a-z][a-z0-9-]{0,61}[a-z0-9])$/.exec(value);
  return Boolean(match?.[1] === projectId && match[2]);
}

function isRegionZone(value: string): boolean {
  return new RegExp(`^${GCP_KSA_PRIMARY_REGION}-[a-z]$`).test(value);
}

function positiveInteger(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer.`);
  return parsed;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required for GCP Memorystore production preflight.`);
  return value;
}

function errorName(error: unknown): string {
  if (error instanceof Error && error.name) {
    return error.name.replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 80) || "GcpMemorystoreError";
  }
  return "GcpMemorystoreError";
}
