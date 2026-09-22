import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");

const schema = read("prisma/v2_patient_merge.prisma");
const migration = read("prisma/migrations/20260922141000_v2_patient_merge/migration.sql");
const service = read("src/modules/patient-merge/patient-merge.service.ts");
const module = read("src/modules/patient-merge/patient-merge.module.ts");
const app = read("src/app.module.ts");

for (const model of ["PatientMergeJob", "MergeConflict", "PatientAlias", "PatientMergeMovement"]) {
  assert.ok(schema.includes(`model ${model}`), `missing patient merge model ${model}`);
}
assert.match(migration, /PatientMergeJob_identity_immutable/);
assert.match(migration, /PatientMergeJob_no_delete/);
assert.match(migration, /PatientAlias_no_delete/);
assert.match(migration, /PatientMergeMovement_no_delete/);

assert.match(service, /information_schema\.columns/);
assert.match(service, /column_name = 'patientId'/);
assert.match(service, /UNSUPPORTED_PATIENT_DOMAIN/);
assert.match(service, /DOMAIN_ROW_LIMIT_EXCEEDED/);
assert.match(service, /UNRESOLVED_HIGH_DATA_QUALITY_ISSUE/);
assert.match(service, /ONE_TO_ONE_DOMAIN_COLLISION/);
assert.match(service, /PATIENT_SCOPED_UNIQUE_COLLISION/);
assert.match(service, /previewDigest/);
assert.match(service, /Patient data changed after preview; create a new merge preview/);
assert.match(service, /TransactionIsolationLevel\.Serializable/);
assert.match(service, /patientMergeMovement\.create/);
assert.match(service, /patientAlias\.create/);
assert.match(service, /status: "ARCHIVED"/);
assert.match(service, /authSession\.updateMany/);
assert.match(service, /status: "ROLLED_BACK"/);
assert.match(service, /Rollback adapter missing/);
assert.match(service, /rollback aborted atomically/);
assert.match(service, /resolvePatientId/);

for (const action of ["PATIENT_MERGE_PREVIEW_CREATED", "PATIENT_MERGE_EXECUTED", "PATIENT_MERGE_ROLLED_BACK"]) {
  assert.ok(service.includes(action), `missing merge audit action ${action}`);
}

assert.match(module, /@Controller\("admin\/patients\/merge"\)/);
assert.match(module, /@RequirePermissions\("DATA_GOVERNANCE_MANAGE"\)/);
for (const route of [
  '@Post("preview")',
  '@Post(":jobId/execute")',
  '@Post(":jobId/rollback")',
  '@Get(":jobId")',
  '@Get("resolve/:patientId")',
]) assert.ok(module.includes(route), `missing patient merge route ${route}`);
assert.match(app, /PatientMergeModule/);

assert.equal(service.includes("patientProfile.delete"), false, "patient merge must not hard-delete a patient profile");
assert.equal(service.includes("clinicalDocument.delete"), false, "patient merge must not delete clinical documents");
assert.equal(service.includes("clinicalMedia.delete"), false, "patient merge must not delete clinical media");

console.log("V2 BE-045 controlled patient merge acceptance passed");
