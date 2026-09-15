import {
  dataResidencyConfiguration,
  hasDestructiveRetention,
  parseDataRetentionPolicy,
  retentionBatchSize,
  retentionExecutionEnabled,
} from "./data-governance-policy";

type Environment = Record<string, string | undefined>;

export function assertProductionDataGovernanceReady(env: Environment = process.env): void {
  if (env.NODE_ENV !== "production") return;

  const residency = dataResidencyConfiguration(env, true)!;
  const policy = parseDataRetentionPolicy(env.DATA_RETENTION_POLICY_JSON, true)!;
  retentionBatchSize(env);

  const awsRegion = required(env, "AWS_REGION");
  if (awsRegion !== residency.region) {
    throw new Error(`AWS_REGION '${awsRegion}' must match DATA_RESIDENCY_REGION '${residency.region}' so S3/KMS preflights validate the approved data region.`);
  }
  if (residency.databaseRegion !== residency.region) {
    throw new Error(`DATABASE_DEPLOYMENT_REGION '${residency.databaseRegion}' must match DATA_RESIDENCY_REGION '${residency.region}'.`);
  }
  if (residency.redisRegion !== residency.region) {
    throw new Error(`REDIS_DEPLOYMENT_REGION '${residency.redisRegion}' must match DATA_RESIDENCY_REGION '${residency.region}'.`);
  }

  if (hasDestructiveRetention(policy)) {
    if (!retentionExecutionEnabled(env)) {
      throw new Error("DATA_RETENTION_EXECUTION_ENABLED=true is required when the approved retention policy contains DELETE/PURGE actions.");
    }
    requiredSafeReference(env, "DATA_RETENTION_APPROVAL_REFERENCE");
    const mode = required(env, "DATA_RETENTION_EXECUTION_MODE");
    if (mode !== "manual" && mode !== "scheduled") {
      throw new Error("DATA_RETENTION_EXECUTION_MODE must be 'manual' or 'scheduled'.");
    }
  }
}

function required(env: Environment, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required for production data-governance preflight.`);
  return value;
}

function requiredSafeReference(env: Environment, name: string): string {
  const value = required(env, name);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(value)) {
    throw new Error(`${name} must be an opaque non-secret approval/reference value.`);
  }
  return value;
}
