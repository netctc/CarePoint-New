import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");

const schema = read("prisma/v2_data_quality.prisma");
const migration = read("prisma/migrations/20260922132000_v2_data_quality/migration.sql");
const service = read("src/modules/data-quality/data-quality.service.ts");
const module = read("src/modules/data-quality/data-quality.module.ts");
const app = read("src/app.module.ts");

for (const model of [
  "model DataQualityRule",
  "model DataQualityRuleVersion",
  "model DataQualityRun",
  "model DataQualityIssue",
  "model DataQualityIssueAction",
]) {
  assert.ok(schema.includes(model), `missing ${model}`);
}

for (const rule of [
  "HOSPITALIZATION_INVALID_INTERVAL",
  "OBSERVATION_UNIT_CONFIGURATION",
  "SYMPTOM_REPORT_LOGICAL_DUPLICATE",
  "CLINICAL_PROFILE_PROVIDER_PROVENANCE",
]) {
  assert.ok(migration.includes(rule), `seeded rule missing: ${rule}`);
  assert.ok(service.includes(rule), `runtime evaluator missing: ${rule}`);
}

assert.match(migration, /DataQualityRuleVersion_append_only/);
assert.match(migration, /DataQualityIssueAction_append_only/);
assert.match(migration, /DataQualityIssue_identity_immutable/);
assert.match(migration, /DataQualityIssue_no_delete/);
assert.match(migration, /REVOKE UPDATE, DELETE ON "DataQualityRuleVersion" FROM PUBLIC/);
assert.match(migration, /REVOKE DELETE ON "DataQualityIssue" FROM PUBLIC/);

assert.match(service, /"dischargedOn" < "admittedOn"/);
assert.match(service, /UNKNOWN_ACTIVE_UNIT_DEFINITION/);
assert.match(service, /PARTITION BY "patientId", "requestDigest"/);
assert.match(service, /PROVIDER_PROVENANCE_INCOMPLETE/);
assert.match(service, /createHash\("sha256"\)/);
assert.match(service, /expectedVersion/);
assert.match(service, /DATA_QUALITY_ISSUE_STATUS_CHANGED/);
assert.match(service, /reasonCode: "REDETECTED"/);
assert.match(service, /Terminal data quality issues cannot be manually changed/);

for (const forbiddenMutation of [
  "hospitalization.update(",
  "symptomReport.update(",
  "clinicalProfileEntry.update(",
  "observation.update(",
]) {
  assert.equal(service.includes(forbiddenMutation), false, `BE-044 must not auto-correct source data: ${forbiddenMutation}`);
}

assert.match(module, /@Controller\("admin\/data-quality"\)/);
assert.match(module, /@RequirePermissions\("DATA_GOVERNANCE_MANAGE"\)/);
for (const route of [
  '@Get("rules")',
  '@Get("runs")',
  '@Get("issues")',
  '@Post("run")',
  '@Post("issues\/:issueId\/status")',
]) {
  assert.ok(module.includes(route), `missing data quality route ${route}`);
}
assert.match(app, /DataQualityModule/);

const evidenceSections = service.match(/evidence:\s*\{[^}]+\}/gs) ?? [];
for (const evidence of evidenceSections) {
  assert.doesNotMatch(evidence, /patientId|requestDigest|ciphertext|freeText|notes|value/i, "data quality issue evidence must remain structural/PHI-minimized");
}

console.log("V2 BE-044 deterministic data quality acceptance passed");
