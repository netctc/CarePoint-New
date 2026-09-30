import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");

const schema = read("prisma/v2_patient_merge.prisma");
const migration = read("prisma/migrations/20260922111500_v2_patient_merge/migration.sql");
const service = read("src/modules/patient-merge/patient-merge.service.ts");
const moduleSource = read("src/modules/patient-merge/patient-merge.module.ts");
const app = read("src/app.module.ts");

for (const model of ["model PatientMergeJob", "model PatientMergeConflict", "model PatientAlias"]) {
  assert.ok(schema.includes(model), `missing ${model}`);
}
assert.match(schema, /aliasPatientId\s+String\s+@unique/);
assert.match(schema, /planDigest\s+String/);
assert.match(migration, /PatientMergeJob_guard_preview_evidence/);
assert.match(migration, /PatientMergeConflict_append_only/);
assert.match(migration, /PatientAlias_append_only/);
assert.match(migration, /REVOKE DELETE ON "PatientMergeJob", "PatientMergeConflict", "PatientAlias" FROM PUBLIC/);
assert.match(migration, /REVOKE UPDATE ON "PatientMergeConflict", "PatientAlias" FROM PUBLIC/);

assert.match(service, /information_schema\.columns/);
assert.match(service, /column_name = 'patientId'/);
assert.match(service, /pg_trigger/);
assert.match(service, /pg_indexes/);
assert.match(service, /IMMUTABLE_OR_GOVERNED_DOMAIN/);
assert.match(service, /PATIENT_SCOPED_UNIQUE_COLLISION_RISK/);
assert.match(service, /blockingConflictCount > 0/);
assert.match(service, /currentPlan\.digest !== job\.planDigest/);
assert.match(service, /TransactionIsolationLevel\.Serializable/);
assert.match(service, /FOR UPDATE/);
assert.match(service, /Patient merge record counts changed during execution; transaction rolled back/);
assert.match(service, /patientAlias\.create/);
assert.match(service, /status: "ARCHIVED"/);
assert.match(service, /authSession\.updateMany/);
assert.match(service, /PATIENT_MERGE_PREVIEW_CREATED/);
assert.match(service, /PATIENT_MERGE_EXECUTED/);
assert.doesNotMatch(service, /patientProfile\.delete/);
assert.doesNotMatch(service, /patientProfile\.deleteMany/);

assert.match(moduleSource, /@Controller\("admin\/patients"\)/);
assert.match(moduleSource, /@RequirePermissions\("DATA_GOVERNANCE_MANAGE"\)/);
for (const route of [
  '@Post("merge/preview")',
  '@Get("merge/:jobId")',
  '@Post("merge/:jobId/execute")',
  '@Get("resolve/:patientId")',
]) {
  assert.ok(moduleSource.includes(route), `missing patient merge route ${route}`);
}
assert.match(app, /PatientMergeModule/);

assert.match(service, /\$executeRawUnsafe\(/);
assert.match(service, /safeTableName/);
assert.match(service, /IDENTIFIER\.test\(value\)/);
assert.match(service, /WHERE "patientId" = \$2/);

console.log("V2 BE-045 fail-closed patient merge acceptance passed");
