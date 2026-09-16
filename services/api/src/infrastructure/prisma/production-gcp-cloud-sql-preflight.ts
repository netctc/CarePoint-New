import { GCP_KSA_PRIMARY_REGION } from "../cloud/production-cloud-provider";
import {
  createProductionGcpCloudSqlInspectionRuntime,
  type GcpCloudSqlInspectionRuntime,
  type InspectGcpCloudSqlInstance,
} from "./gcp-cloud-sql-inspection-runtime";

export interface ProductionGcpCloudSqlPreflightOptions {
  inspectInstance?: InspectGcpCloudSqlInstance;
}

export async function assertProductionGcpCloudSqlReady(
  env: NodeJS.ProcessEnv = process.env,
  options: ProductionGcpCloudSqlPreflightOptions = {},
): Promise<void> {
  if (env.NODE_ENV !== "production" || env.CAREPOINT_CLOUD_PROVIDER?.trim() !== "gcp") return;

  let runtime: GcpCloudSqlInspectionRuntime | null = null;
  let inspectInstance = options.inspectInstance;
  if (!inspectInstance) {
    runtime = await createProductionGcpCloudSqlInspectionRuntime(env);
    if (!runtime) {
      throw new Error("GCP Cloud SQL inspection runtime is unavailable for production database preflight.");
    }
    inspectInstance = runtime.inspectInstance;
  }

  try {
    let inspection;
    try {
      inspection = await inspectInstance();
    } catch (error) {
      throw new Error(`Production GCP Cloud SQL preflight could not inspect the configured instance: ${errorName(error)}.`);
    }

    const projectId = required(env, "GCP_PROJECT_ID");
    const instanceId = required(env, "CAREPOINT_GCP_CLOUD_SQL_INSTANCE");
    if (inspection.projectId !== projectId) {
      throw new Error("GCP Cloud SQL instance project does not match GCP_PROJECT_ID.");
    }
    if (inspection.instanceId !== instanceId) {
      throw new Error("GCP Cloud SQL instance identity does not match CAREPOINT_GCP_CLOUD_SQL_INSTANCE.");
    }
    if (inspection.region !== GCP_KSA_PRIMARY_REGION) {
      throw new Error(
        `GCP Cloud SQL instance must remain in '${GCP_KSA_PRIMARY_REGION}', got '${inspection.region || "unknown"}'.`,
      );
    }
    if (inspection.state !== "RUNNABLE") {
      throw new Error(`GCP Cloud SQL instance must be RUNNABLE, got '${inspection.state || "unknown"}'.`);
    }

    const minServerMajor = positiveInteger(env.DATABASE_MIN_SERVER_MAJOR ?? "16", "DATABASE_MIN_SERVER_MAJOR");
    const major = postgresMajor(inspection.databaseVersion);
    if (major === null || major < minServerMajor) {
      throw new Error(
        `GCP Cloud SQL PostgreSQL major version must be >= ${minServerMajor}, got '${inspection.databaseVersion || "unknown"}'.`,
      );
    }

    if (inspection.availabilityType !== "REGIONAL") {
      throw new Error("GCP Cloud SQL production instance must use REGIONAL high availability.");
    }
    if (!inspection.backupEnabled) {
      throw new Error("GCP Cloud SQL production instance must enable automated backups.");
    }
    if (!inspection.pointInTimeRecoveryEnabled) {
      throw new Error("GCP Cloud SQL production instance must enable point-in-time recovery.");
    }
    if (inspection.publicIpv4Enabled) {
      throw new Error("GCP Cloud SQL production instance must disable public IPv4 connectivity.");
    }
    if (!inspection.privateNetworkConfigured && !inspection.pscEnabled) {
      throw new Error("GCP Cloud SQL production instance must use private networking or Private Service Connect.");
    }

    const tlsModeAccepted = inspection.sslMode === "ENCRYPTED_ONLY"
      || inspection.sslMode === "TRUSTED_CLIENT_CERTIFICATE_REQUIRED"
      || inspection.requireSsl === true;
    if (!tlsModeAccepted) {
      throw new Error("GCP Cloud SQL production instance must enforce TLS connections.");
    }
  } finally {
    await runtime?.close();
  }
}

function postgresMajor(value: string): number | null {
  const match = /^POSTGRES_(\d+)$/.exec(value.trim().toUpperCase());
  if (!match?.[1]) return null;
  const major = Number(match[1]);
  return Number.isSafeInteger(major) && major > 0 ? major : null;
}

function positiveInteger(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer.`);
  return parsed;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required for GCP Cloud SQL production preflight.`);
  return value;
}

function errorName(error: unknown): string {
  if (error instanceof Error && error.name) {
    return error.name.replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 80) || "GcpCloudSqlError";
  }
  return "GcpCloudSqlError";
}
