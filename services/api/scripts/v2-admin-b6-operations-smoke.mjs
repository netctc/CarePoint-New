import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const moduleSource = read("src/modules/admin-b6-operations/admin-b6-operations.module.ts");
const duplicates = read("src/modules/admin-b6-operations/duplicate-patient.service.ts");
const integrations = read("src/modules/admin-b6-operations/integration-center.service.ts");
const clinical = read("src/modules/admin-b6-operations/clinical-operations.service.ts");
const exportsSource = read("src/modules/admin-b6-operations/audit-export.service.ts");
const appModule = read("src/app.module.ts");
const schema = read("prisma/v2_admin_b6_operations.prisma");
const migration = read("prisma/migrations/20260922164000_v2_admin_b6_operations/migration.sql");

assert.match(moduleSource, /@Controller\("admin\/patient-duplicates"\)/);
assert.match(moduleSource, /@Controller\("admin\/integrations"\)/);
assert.match(moduleSource, /@Controller\("admin\/audit-exports"\)/);
assert.match(moduleSource, /@Controller\("admin\/clinical-operations"\)/);
assert.match(moduleSource, /RequirePermissions\("DATA_GOVERNANCE_MANAGE"\)/);
assert.match(moduleSource, /RequirePermissions\("IAM_READ_AUDIT"\)/);
assert.match(appModule, /AdminB6OperationsModule/);

// ADM-089: deterministic, minimized, explainable and never automatic.
assert.match(duplicates, /DETERMINISTIC_IDENTITY_MATCH_V1/);
assert.match(duplicates, /autoMerge:\s*false/);
assert.match(duplicates, /minimizedEvidence:\s*true/);
assert.match(duplicates, /EMAIL_EXACT/);
assert.match(duplicates, /PHONE_EXACT/);
assert.match(duplicates, /NAME_EXACT_SUPPORTING/);
assert.match(duplicates, /reviewRequired:\s*true/);
assert.doesNotMatch(duplicates, /prisma\.[A-Za-z0-9_]+\.(?:create|update|delete|createMany|updateMany|deleteMany)\s*\(/);
assert.doesNotMatch(duplicates, /email:\s*row|phone:\s*row/);

// ADM-102: connector health may expose references, never secret values.
assert.match(integrations, /secretsExposed:\s*false/);
assert.match(integrations, /credentialReferences/);
assert.match(integrations, /TERMINOLOGY/);
assert.match(integrations, /FHIR_R4/);
assert.match(integrations, /LAB_GATEWAY/);
assert.match(integrations, /DEVICE_INGESTION/);
assert.match(integrations, /SIEM/);
assert.doesNotMatch(integrations, /apiKey:\s*process\.env|secretValue|passwordValue|tokenValue/);

// ADM-111: durable encrypted export, hash, expiry and actor evidence.
assert.match(schema, /model AuditExportJob/);
assert.match(schema, /model AuditExportDownloadGrant/);
assert.match(schema, /contentDigest\s+String\?/);
assert.match(schema, /expiresAt\s+DateTime/);
assert.match(migration, /AuditExportJob_no_delete/);
assert.match(migration, /AuditExportDownloadGrant_no_delete/);
assert.match(migration, /REVOKE DELETE ON "AuditExportJob"/);
assert.match(migration, /REVOKE DELETE ON "AuditExportDownloadGrant"/);
assert.match(exportsSource, /createHash\("sha256"\)/);
assert.match(exportsSource, /encryptBytes/);
assert.match(exportsSource, /storage\.put/);
assert.match(exportsSource, /AUDIT_EXPORT_REQUESTED/);
assert.match(exportsSource, /AUDIT_EXPORT_READY/);
assert.match(exportsSource, /AUDIT_EXPORT_DOWNLOAD_GRANTED/);
assert.match(exportsSource, /AUDIT_EXPORT_DOWNLOADED/);
assert.match(exportsSource, /consumedAt:\s*null/);
assert.match(exportsSource, /expiresAt:\s*\{\s*gt:\s*new Date\(\)\s*\}/);
assert.match(exportsSource, /MAX_EVENTS = 10_000/);

// ADM-112: each KPI is defined from reproducible server-side predicates.
assert.match(clinical, /questionnaireOverdue:\s*"ACTIVE_PATIENT_X_ACTIVE_QUESTIONNAIRE_PAIR_WITHOUT_RESPONSE_IN_LAST_30_DAYS"/);
assert.match(clinical, /carePlanReview:\s*"ACTIVE_PLAN_REVIEW_AT_BEFORE_SNAPSHOT"/);
assert.match(clinical, /rpmAlert:\s*"OPEN_OR_ACKNOWLEDGED"/);
assert.match(clinical, /pendingResult:\s*"SIGNED_LAB_ORDER_WITHOUT_RELEASED_RESULT"/);
assert.match(clinical, /orphanTask:\s*"ACTIVE_TASK_WITH_INACTIVE_OR_MISSING_PLAN_OR_OWNER_PROVIDER"/);
assert.match(clinical, /questionnairesOverdue/);
assert.match(clinical, /plansWithoutReview/);
assert.match(clinical, /rpmAlertsOpen/);
assert.match(clinical, /pendingResults/);
assert.match(clinical, /orphanTasks/);
assert.match(clinical, /drillDown/);

console.log("V2 B6 Admin operations backend acceptance passed: ADM-089/102/111/112");

function read(relative) {
  return readFileSync(new URL("../" + relative, import.meta.url), "utf8");
}
await import("./v2-admin-population-analytics-smoke.mjs");
await import("./v2-integration-gateways-smoke.mjs");
