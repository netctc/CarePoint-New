export const DataRetentionClasses = [
  "AUTH_EPHEMERAL",
  "IDENTITY_PROFILE",
  "CLINICAL_RECORD",
  "CLINICAL_DOCUMENT",
  "DIAGNOSTIC_REPORT",
  "CONSENT",
  "FINANCIAL",
  "COMMUNICATION",
  "AUDIT_SECURITY",
] as const;

export type DataRetentionClassName = (typeof DataRetentionClasses)[number];
export type DataRetentionAction = "DELETE" | "PURGE" | "PRESERVE";

export interface DataRetentionRule {
  dataClass: DataRetentionClassName;
  action: DataRetentionAction;
  retentionDays: number | null;
}

export interface DataRetentionPolicy {
  version: string;
  rules: Record<DataRetentionClassName, DataRetentionRule>;
}

export interface DataResidencyConfiguration {
  jurisdiction: string;
  region: string;
  policyVersion: string;
  evidenceReference: string;
  databaseRegion: string;
  redisRegion: string;
}

type Environment = Record<string, string | undefined>;

const destructiveActions: Readonly<Record<DataRetentionClassName, readonly DataRetentionAction[]>> = {
  AUTH_EPHEMERAL: ["DELETE"],
  IDENTITY_PROFILE: [],
  CLINICAL_RECORD: ["DELETE"],
  CLINICAL_DOCUMENT: ["PURGE"],
  DIAGNOSTIC_REPORT: ["DELETE"],
  CONSENT: [],
  FINANCIAL: [],
  COMMUNICATION: ["DELETE"],
  AUDIT_SECURITY: [],
};

export function parseDataRetentionPolicy(raw: string | undefined, required = true): DataRetentionPolicy | null {
  const source = raw?.trim();
  if (!source) {
    if (required) throw new Error("DATA_RETENTION_POLICY_JSON is required.");
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(source) as unknown;
  } catch {
    throw new Error("DATA_RETENTION_POLICY_JSON must contain valid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("DATA_RETENTION_POLICY_JSON must be a JSON object.");
  }

  const object = parsed as Record<string, unknown>;
  const version = safeReference(object.version, "DATA_RETENTION_POLICY_JSON.version");
  if (!Array.isArray(object.rules)) throw new Error("DATA_RETENTION_POLICY_JSON.rules must be an array.");

  const rules = new Map<DataRetentionClassName, DataRetentionRule>();
  for (const rawRule of object.rules) {
    if (!rawRule || typeof rawRule !== "object" || Array.isArray(rawRule)) {
      throw new Error("Each DATA_RETENTION_POLICY_JSON rule must be an object.");
    }
    const row = rawRule as Record<string, unknown>;
    const dataClass = retentionClass(row.dataClass);
    if (rules.has(dataClass)) throw new Error(`DATA_RETENTION_POLICY_JSON contains duplicate rule '${dataClass}'.`);
    const action = retentionAction(row.action);
    const retentionDays = retentionDaysValue(row.retentionDays, dataClass, action);
    assertSupportedAction(dataClass, action);
    rules.set(dataClass, { dataClass, action, retentionDays });
  }

  for (const dataClass of DataRetentionClasses) {
    if (!rules.has(dataClass)) throw new Error(`DATA_RETENTION_POLICY_JSON is missing required data class '${dataClass}'.`);
  }

  return {
    version,
    rules: Object.fromEntries(DataRetentionClasses.map((dataClass) => [dataClass, rules.get(dataClass)!])) as Record<DataRetentionClassName, DataRetentionRule>,
  };
}

export function dataResidencyConfiguration(env: Environment = process.env, required = true): DataResidencyConfiguration | null {
  const jurisdiction = env.DATA_RESIDENCY_JURISDICTION?.trim();
  const region = env.DATA_RESIDENCY_REGION?.trim();
  const policyVersion = env.DATA_RESIDENCY_POLICY_VERSION?.trim();
  const evidenceReference = env.DATA_RESIDENCY_EVIDENCE_REFERENCE?.trim();
  const databaseRegion = env.DATABASE_DEPLOYMENT_REGION?.trim();
  const redisRegion = env.REDIS_DEPLOYMENT_REGION?.trim();

  if (!jurisdiction && !region && !policyVersion && !evidenceReference && !databaseRegion && !redisRegion && !required) return null;
  for (const [name, value] of [
    ["DATA_RESIDENCY_JURISDICTION", jurisdiction],
    ["DATA_RESIDENCY_REGION", region],
    ["DATA_RESIDENCY_POLICY_VERSION", policyVersion],
    ["DATA_RESIDENCY_EVIDENCE_REFERENCE", evidenceReference],
    ["DATABASE_DEPLOYMENT_REGION", databaseRegion],
    ["REDIS_DEPLOYMENT_REGION", redisRegion],
  ] as const) {
    if (!value) throw new Error(`${name} is required for the data-residency contract.`);
    if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(value)) throw new Error(`${name} must be an opaque deployment/reference value without whitespace or secrets.`);
  }

  return {
    jurisdiction: jurisdiction!,
    region: region!,
    policyVersion: policyVersion!,
    evidenceReference: evidenceReference!,
    databaseRegion: databaseRegion!,
    redisRegion: redisRegion!,
  };
}

export function hasDestructiveRetention(policy: DataRetentionPolicy): boolean {
  return DataRetentionClasses.some((dataClass) => policy.rules[dataClass].action !== "PRESERVE");
}

export function retentionExecutionEnabled(env: Environment = process.env): boolean {
  return env.DATA_RETENTION_EXECUTION_ENABLED?.trim().toLowerCase() === "true";
}

export function retentionBatchSize(env: Environment = process.env): number {
  const raw = env.DATA_RETENTION_BATCH_SIZE?.trim() || "100";
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 500) throw new Error("DATA_RETENTION_BATCH_SIZE must be an integer between 1 and 500.");
  return parsed;
}

function retentionClass(value: unknown): DataRetentionClassName {
  if (typeof value !== "string" || !(DataRetentionClasses as readonly string[]).includes(value)) {
    throw new Error(`Unsupported DATA_RETENTION_POLICY_JSON dataClass '${String(value)}'.`);
  }
  return value as DataRetentionClassName;
}

function retentionAction(value: unknown): DataRetentionAction {
  if (value !== "DELETE" && value !== "PURGE" && value !== "PRESERVE") {
    throw new Error(`Unsupported DATA_RETENTION_POLICY_JSON action '${String(value)}'.`);
  }
  return value;
}

function retentionDaysValue(value: unknown, dataClass: DataRetentionClassName, action: DataRetentionAction): number | null {
  if (action === "PRESERVE") {
    if (value !== undefined && value !== null) throw new Error(`${dataClass} PRESERVE policy must not define retentionDays.`);
    return null;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 36_500) {
    throw new Error(`${dataClass} ${action} policy requires retentionDays as an integer between 1 and 36500.`);
  }
  return parsed;
}

function assertSupportedAction(dataClass: DataRetentionClassName, action: DataRetentionAction): void {
  if (action === "PRESERVE") return;
  if (!destructiveActions[dataClass].includes(action)) {
    throw new Error(`${dataClass} does not support destructive action ${action} in Release 1; use PRESERVE until an approved lifecycle exists.`);
  }
  if (dataClass === "AUDIT_SECURITY") throw new Error("AUDIT_SECURITY must be PRESERVE; immutable audit evidence cannot be hard-deleted by the generic retention engine.");
}

function safeReference(value: unknown, name: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(value)) {
    throw new Error(`${name} must be an opaque non-secret reference using letters, numbers, '.', '_', ':', '/', or '-'.`);
  }
  return value;
}
