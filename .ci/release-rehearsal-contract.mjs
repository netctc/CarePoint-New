import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const FULL_GIT_SHA = /^[0-9a-f]{40}$/i;
const SHA256_DIGEST = /^sha256:[0-9a-f]{64}$/i;
const SHA256_HEX = /^[0-9a-f]{64}$/i;
const RELEASE_VERSION = /^[0-9A-Za-z][0-9A-Za-z._+-]{0,63}$/;
const ENVIRONMENT_CLASSIFICATIONS = new Set(["production-equivalent", "production"]);
const DEPLOYMENT_STRATEGIES = new Set(["rolling", "canary", "blue-green", "platform-approved-other"]);

const FORBIDDEN_KEYS = new Set([
  "password",
  "passphrase",
  "clientsecret",
  "apikey",
  "accesstoken",
  "refreshtoken",
  "privatekey",
  "authorization",
  "cookie",
  "patientid",
  "patientname",
  "mrn",
  "nationalid",
  "dateofbirth",
  "dob",
]);

const SENSITIVE_VALUE_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/i,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/i,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/,
  /https?:\/\/[^\s/@:]+:[^\s/@]+@/i,
  /[?&](?:token|access_token|api_key|apikey|secret|password)=([^&\s]+)/i,
];

const MIGRATION_RISK_RULES = [
  ["DESTRUCTIVE_SCHEMA", /\bDROP\s+(?:TABLE|COLUMN|TYPE|SCHEMA)\b/i],
  ["TRUNCATE", /\bTRUNCATE\b/i],
  ["DELETE_DML", /\bDELETE\s+FROM\b/i],
  ["UPDATE_DML", /\bUPDATE\s+[\"A-Za-z_]/i],
  ["ALTER_TABLE", /\bALTER\s+TABLE\b/i],
  ["ALTER_TYPE", /\bALTER\s+TYPE\b/i],
  ["ADD_CONSTRAINT", /\bADD\s+CONSTRAINT\b/i],
  ["SET_NOT_NULL", /\bSET\s+NOT\s+NULL\b/i],
  ["ALTER_COLUMN_TYPE", /\bALTER\s+COLUMN\b[\s\S]{0,160}\bTYPE\b/i],
  ["TRIGGER_CHANGE", /\b(?:CREATE|DROP)\s+TRIGGER\b/i],
  ["FUNCTION_CHANGE", /\bCREATE\s+OR\s+REPLACE\s+FUNCTION\b/i],
];

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function command(commandName, args) {
  return execFileSync(commandName, args, { encoding: "utf8" }).trim();
}

function currentGitSha() {
  const value = command("git", ["rev-parse", "HEAD"]).toLowerCase();
  if (!FULL_GIT_SHA.test(value)) throw new Error("Unable to resolve a full current Git SHA.");
  return value;
}

async function fileEvidence(relativePath) {
  const absolutePath = path.resolve(process.cwd(), relativePath);
  const metadata = await stat(absolutePath);
  if (!metadata.isFile()) throw new Error(`${relativePath} is not a regular file.`);
  const bytes = await readFile(absolutePath);
  return {
    path: relativePath.replaceAll(path.sep, "/"),
    bytes: metadata.size,
    sha256: sha256(bytes),
  };
}

function migrationRiskFlags(sql) {
  const flags = [];
  for (const [name, pattern] of MIGRATION_RISK_RULES) {
    if (pattern.test(sql)) flags.push(name);
  }

  const createIndexes = sql.match(/\bCREATE\s+(?:UNIQUE\s+)?INDEX\b[^;]*/gi) ?? [];
  if (createIndexes.some((statement) => !/\bCONCURRENTLY\b/i.test(statement))) {
    flags.push("CREATE_INDEX_NOT_CONCURRENTLY");
  }

  return [...new Set(flags)].sort();
}

async function migrationInventory() {
  const root = path.resolve(process.cwd(), "services/api/prisma/migrations");
  const entries = (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name));

  const migrations = [];
  for (const entry of entries) {
    const relativePath = path.posix.join("services/api/prisma/migrations", entry.name, "migration.sql");
    const evidence = await fileEvidence(relativePath);
    const sql = await readFile(path.resolve(process.cwd(), relativePath), "utf8");
    migrations.push({
      name: entry.name,
      ...evidence,
      staticRiskFlags: migrationRiskFlags(sql),
    });
  }

  if (migrations.length === 0) throw new Error("No Prisma migrations found for rehearsal inventory.");
  const aggregateInput = migrations.map((item) => `${item.name}\0${item.sha256}\0${item.bytes}\n`).join("");
  return {
    schema: "carepoint.release-migration-inventory/v1",
    sourceSha: currentGitSha(),
    migrationSetSha256: sha256(aggregateInput),
    migrationCount: migrations.length,
    staticReviewOnly: true,
    migrations,
  };
}

function requiredObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value;
}

function requiredString(value, label, maxLength = 500) {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${label} must be a non-empty string.`);
  const result = value.trim();
  if (result.length > maxLength || /[\r\n\0]/.test(result)) throw new Error(`${label} must be one line and at most ${maxLength} characters.`);
  return result;
}

function requireBoolean(value, label, expected = true) {
  if (typeof value !== "boolean") throw new Error(`${label} must be boolean.`);
  if (value !== expected) throw new Error(`${label} must be ${expected}.`);
}

function requireTimestamp(value, label) {
  const result = requiredString(value, label, 80);
  if (!Number.isFinite(Date.parse(result))) throw new Error(`${label} must be an ISO-compatible timestamp.`);
  return result;
}

function requireFullSha(value, label) {
  const result = requiredString(value, label, 40).toLowerCase();
  if (!FULL_GIT_SHA.test(result)) throw new Error(`${label} must be a full 40-hex Git SHA.`);
  return result;
}

function requireDigest(value, label) {
  const result = requiredString(value, label, 80).toLowerCase();
  if (!SHA256_DIGEST.test(result)) throw new Error(`${label} must be sha256:<64-hex>.`);
  return result;
}

function requireMigrationDigest(value, label) {
  const result = requiredString(value, label, 64).toLowerCase();
  if (!SHA256_HEX.test(result)) throw new Error(`${label} must be a 64-hex SHA-256 value.`);
  return result;
}

function requireReference(value, label) {
  return requiredString(value, label, 500);
}

function requireDuration(value, label, max) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error(`${label} must be a non-negative number.`);
  if (value > max) throw new Error(`${label} exceeds the Release 1 maximum of ${max} minutes.`);
}

function scanSensitiveData(value, trail = "evidence") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanSensitiveData(item, `${trail}[${index}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (FORBIDDEN_KEYS.has(normalizedKey)) {
        throw new Error(`Sensitive/PHI-like key ${trail}.${key} is not allowed in sanitized rehearsal evidence.`);
      }
      scanSensitiveData(child, `${trail}.${key}`);
    }
    return;
  }
  if (typeof value === "string") {
    for (const pattern of SENSITIVE_VALUE_PATTERNS) {
      if (pattern.test(value)) throw new Error(`Sensitive credential-like value detected at ${trail}.`);
    }
  }
}

async function validateEvidence(evidence, providedInventory) {
  const inventory = providedInventory ?? await migrationInventory();
  const root = requiredObject(evidence, "evidence");
  scanSensitiveData(root);
  if (root.schema !== "carepoint.release-rehearsal/v1") throw new Error("Unsupported rehearsal evidence schema.");
  requireBoolean(root.sensitiveDataIncluded, "sensitiveDataIncluded", false);

  const environment = requiredObject(root.environment, "environment");
  requireReference(environment.id, "environment.id");
  if (!ENVIRONMENT_CLASSIFICATIONS.has(environment.classification)) {
    throw new Error("environment.classification must be production-equivalent or production.");
  }
  requireReference(environment.evidenceRef, "environment.evidenceRef");

  const release = requiredObject(root.release, "release");
  const version = requiredString(release.version, "release.version", 64);
  if (!RELEASE_VERSION.test(version)) throw new Error("release.version has an invalid format.");
  const sourceSha = requireFullSha(release.sourceSha, "release.sourceSha");
  if (sourceSha !== inventory.sourceSha) throw new Error(`release.sourceSha ${sourceSha} does not match checkout ${inventory.sourceSha}.`);
  const migrationSetSha256 = requireMigrationDigest(release.migrationSetSha256, "release.migrationSetSha256");
  if (migrationSetSha256 !== inventory.migrationSetSha256) throw new Error("release.migrationSetSha256 does not match the current migration inventory.");
  requireDigest(release.apiArtifactDigest, "release.apiArtifactDigest");
  requireDigest(release.adminArtifactDigest, "release.adminArtifactDigest");

  const previous = requiredObject(release.previous, "release.previous");
  requiredString(previous.version, "release.previous.version", 64);
  const previousSha = requireFullSha(previous.sourceSha, "release.previous.sourceSha");
  if (previousSha === sourceSha) throw new Error("release.previous.sourceSha must identify a different previously approved release.");
  requireDigest(previous.apiArtifactDigest, "release.previous.apiArtifactDigest");
  requireDigest(previous.adminArtifactDigest, "release.previous.adminArtifactDigest");

  const predeploy = requiredObject(root.predeploy, "predeploy");
  requireBoolean(predeploy.pitrReady, "predeploy.pitrReady");
  requireReference(predeploy.backupPitrEvidenceRef, "predeploy.backupPitrEvidenceRef");
  requireBoolean(predeploy.configReady, "predeploy.configReady");
  requireReference(predeploy.providerReadinessRef, "predeploy.providerReadinessRef");
  requireReference(predeploy.migrationReviewRef, "predeploy.migrationReviewRef");

  const deployment = requiredObject(root.deployment, "deployment");
  if (!DEPLOYMENT_STRATEGIES.has(deployment.strategy)) throw new Error("deployment.strategy is not an approved contract value.");
  if (deployment.strategy === "platform-approved-other") requireReference(deployment.strategyRef, "deployment.strategyRef");
  const deployStartedAt = requireTimestamp(deployment.startedAt, "deployment.startedAt");
  const deployReadyAt = requireTimestamp(deployment.readyAt, "deployment.readyAt");
  if (Date.parse(deployReadyAt) < Date.parse(deployStartedAt)) throw new Error("deployment.readyAt cannot precede deployment.startedAt.");
  const observedSourceSha = requireFullSha(deployment.runtimeObservedSourceSha, "deployment.runtimeObservedSourceSha");
  if (observedSourceSha !== sourceSha) throw new Error("deployment.runtimeObservedSourceSha does not match the candidate source SHA.");
  requireReference(deployment.healthEvidenceRef, "deployment.healthEvidenceRef");
  requireReference(deployment.smokeEvidenceRef, "deployment.smokeEvidenceRef");
  requireBoolean(deployment.safetySignalsPass, "deployment.safetySignalsPass");

  const rollback = requiredObject(root.rollback, "rollback");
  requireBoolean(rollback.executed, "rollback.executed");
  requireReference(rollback.triggerRef, "rollback.triggerRef");
  const rollbackStartedAt = requireTimestamp(rollback.startedAt, "rollback.startedAt");
  const rollbackCompletedAt = requireTimestamp(rollback.completedAt, "rollback.completedAt");
  if (Date.parse(rollbackCompletedAt) < Date.parse(rollbackStartedAt)) throw new Error("rollback.completedAt cannot precede rollback.startedAt.");
  const rollbackObservedSha = requireFullSha(rollback.runtimeObservedSourceSha, "rollback.runtimeObservedSourceSha");
  if (rollbackObservedSha !== previousSha) throw new Error("rollback.runtimeObservedSourceSha does not match the previous approved source SHA.");
  requireReference(rollback.healthEvidenceRef, "rollback.healthEvidenceRef");
  requireReference(rollback.smokeEvidenceRef, "rollback.smokeEvidenceRef");
  requireBoolean(rollback.sideEffectsReconciled, "rollback.sideEffectsReconciled");

  const recovery = requiredObject(root.recovery, "recovery");
  requireBoolean(recovery.pitrRehearsed, "recovery.pitrRehearsed");
  requireDuration(recovery.rpoMinutes, "recovery.rpoMinutes", 15);
  requireDuration(recovery.rtoMinutes, "recovery.rtoMinutes", 120);
  requireReference(recovery.evidenceRef, "recovery.evidenceRef");

  const approvals = requiredObject(root.approvals, "approvals");
  for (const role of ["release", "operations", "sre", "security", "database", "product"]) {
    requireBoolean(approvals[role], `approvals.${role}`);
  }
  if (typeof approvals.clinicalRequired !== "boolean") throw new Error("approvals.clinicalRequired must be boolean.");
  if (approvals.clinicalRequired) requireBoolean(approvals.clinical, "approvals.clinical");
  requireBoolean(approvals.rehearsalAccepted, "approvals.rehearsalAccepted");
  requireReference(approvals.approvalRef, "approvals.approvalRef");

  return {
    schema: "carepoint.release-rehearsal-validation/v1",
    valid: true,
    sourceSha,
    releaseVersion: version,
    previousSourceSha: previousSha,
    migrationSetSha256,
    migrationCount: inventory.migrationCount,
    staticMigrationRiskCount: inventory.migrations.filter((item) => item.staticRiskFlags.length > 0).length,
    environmentClassification: environment.classification,
    rpoMinutes: recovery.rpoMinutes,
    rtoMinutes: recovery.rtoMinutes,
    validatedAt: new Date().toISOString(),
    note: "Contract validation proves evidence completeness/consistency only; it does not execute deployment, rollback or PITR.",
  };
}

async function selfTest() {
  const inventory = await migrationInventory();
  const currentSha = inventory.sourceSha;
  const previousSha = currentSha === "1111111111111111111111111111111111111111"
    ? "2222222222222222222222222222222222222222"
    : "1111111111111111111111111111111111111111";
  const digestA = `sha256:${"a".repeat(64)}`;
  const digestB = `sha256:${"b".repeat(64)}`;

  const fixture = {
    schema: "carepoint.release-rehearsal/v1",
    sensitiveDataIncluded: false,
    environment: { id: "synthetic-self-test", classification: "production-equivalent", evidenceRef: "restricted://synthetic/environment" },
    release: {
      version: "0.0.0-self-test",
      sourceSha: currentSha,
      migrationSetSha256: inventory.migrationSetSha256,
      apiArtifactDigest: digestA,
      adminArtifactDigest: digestB,
      previous: { version: "0.0.0-prev", sourceSha: previousSha, apiArtifactDigest: digestB, adminArtifactDigest: digestA },
    },
    predeploy: {
      pitrReady: true,
      backupPitrEvidenceRef: "restricted://synthetic/pitr",
      configReady: true,
      providerReadinessRef: "restricted://synthetic/providers",
      migrationReviewRef: "restricted://synthetic/migrations",
    },
    deployment: {
      strategy: "blue-green",
      startedAt: "2026-01-01T00:00:00Z",
      readyAt: "2026-01-01T00:05:00Z",
      runtimeObservedSourceSha: currentSha,
      healthEvidenceRef: "restricted://synthetic/health-new",
      smokeEvidenceRef: "restricted://synthetic/smoke-new",
      safetySignalsPass: true,
    },
    rollback: {
      executed: true,
      triggerRef: "restricted://synthetic/trigger",
      startedAt: "2026-01-01T00:10:00Z",
      completedAt: "2026-01-01T00:15:00Z",
      runtimeObservedSourceSha: previousSha,
      healthEvidenceRef: "restricted://synthetic/health-prev",
      smokeEvidenceRef: "restricted://synthetic/smoke-prev",
      sideEffectsReconciled: true,
    },
    recovery: { pitrRehearsed: true, rpoMinutes: 10, rtoMinutes: 60, evidenceRef: "restricted://synthetic/recovery" },
    approvals: {
      release: true,
      operations: true,
      sre: true,
      security: true,
      database: true,
      product: true,
      clinicalRequired: true,
      clinical: true,
      rehearsalAccepted: true,
      approvalRef: "restricted://synthetic/approval",
    },
  };

  await validateEvidence(fixture, inventory);

  const negativeCases = [
    ["wrong candidate SHA", (copy) => { copy.release.sourceSha = previousSha; }],
    ["wrong deployed runtime SHA", (copy) => { copy.deployment.runtimeObservedSourceSha = previousSha; }],
    ["wrong rollback SHA", (copy) => { copy.rollback.runtimeObservedSourceSha = currentSha; }],
    ["wrong migration digest", (copy) => { copy.release.migrationSetSha256 = "f".repeat(64); }],
    ["RPO over target", (copy) => { copy.recovery.rpoMinutes = 16; }],
    ["RTO over target", (copy) => { copy.recovery.rtoMinutes = 121; }],
    ["secret-like key", (copy) => { copy.environment.apiKey = "not-allowed"; }],
    ["missing readiness", (copy) => { copy.predeploy.pitrReady = false; }],
    ["missing approval", (copy) => { copy.approvals.security = false; }],
  ];

  for (const [name, mutate] of negativeCases) {
    const copy = structuredClone(fixture);
    mutate(copy);
    let rejected = false;
    try {
      await validateEvidence(copy, inventory);
    } catch {
      rejected = true;
    }
    if (!rejected) throw new Error(`Self-test negative case was not rejected: ${name}`);
  }

  console.log(JSON.stringify({ selfTest: "PASS", sourceSha: currentSha, migrationSetSha256: inventory.migrationSetSha256, negativeCases: negativeCases.length }));
}

async function main() {
  const [mode, value, maybeOutFlag, maybeOutPath] = process.argv.slice(2);
  if (mode === "--self-test") {
    await selfTest();
    return;
  }
  if (mode === "--inventory") {
    if (!value) throw new Error("--inventory requires an output JSON path.");
    const inventory = await migrationInventory();
    await writeFile(path.resolve(process.cwd(), value), `${JSON.stringify(inventory, null, 2)}\n`, "utf8");
    console.log(JSON.stringify({ inventory: value, sourceSha: inventory.sourceSha, migrationSetSha256: inventory.migrationSetSha256, migrationCount: inventory.migrationCount }));
    return;
  }
  if (mode === "--validate") {
    if (!value) throw new Error("--validate requires an evidence JSON path.");
    if (maybeOutFlag !== "--out" || !maybeOutPath) throw new Error("--validate requires --out <validation.json>.");
    const evidence = JSON.parse(await readFile(path.resolve(process.cwd(), value), "utf8"));
    const validation = await validateEvidence(evidence);
    await writeFile(path.resolve(process.cwd(), maybeOutPath), `${JSON.stringify(validation, null, 2)}\n`, "utf8");
    console.log(JSON.stringify(validation));
    return;
  }
  throw new Error("Usage: --self-test | --inventory <out.json> | --validate <evidence.json> --out <validation.json>");
}

main().catch((error) => {
  console.error(`Release rehearsal contract failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
