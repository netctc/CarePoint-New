import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const prisma = readFileSync(new URL("../prisma/v2_symptom_reports.prisma", import.meta.url), "utf8");
const migration = readFileSync(
  new URL("../prisma/migrations/20260922062000_v2_symptom_reports/migration.sql", import.meta.url),
  "utf8",
);
const service = readFileSync(
  new URL("../src/modules/symptom-reports/symptom-report.service.ts", import.meta.url),
  "utf8",
);
const moduleSource = readFileSync(
  new URL("../src/modules/symptom-reports/symptom-report.module.ts", import.meta.url),
  "utf8",
);
const appModule = readFileSync(new URL("../src/app.module.ts", import.meta.url), "utf8");

// Canonical PAT-117 backend support: patient-reported symptom journal, never an inferred diagnosis.
assert.match(prisma, /model SymptomReport\s*\{/);
assert.match(prisma, /sourceType\s+String\s+@default\("PATIENT_REPORTED"\)/);
assert.match(migration, /SymptomReport_source_patient_check/);
assert.match(migration, /"sourceType" = 'PATIENT_REPORTED'/);
assert.match(service, /source:\s*\{ type: "PATIENT_REPORTED" \}/);
assert.match(service, /severity must be an integer from 0 to 10/);
assert.match(service, /duration\.unit must be MINUTES, HOURS, DAYS or WEEKS/);
assert.match(service, /const context = this\.text\(input\.context/);

// Clinical content is envelope-encrypted; clear DB columns remain structural/provenance only.
assert.match(service, /ClinicalEnvelopeService/);
assert.match(service, /this\.envelope\.encryptRecord\(normalized\.payload\)/);
assert.match(prisma, /ciphertext\s+String/);
assert.doesNotMatch(prisma, /severity\s+(Int|String)/);
assert.doesNotMatch(prisma, /context\s+String/);

// Patient creation is idempotent but repeated legitimate symptom entries are not logically deduplicated.
assert.match(prisma, /@@unique\(\[patientId, idempotencyKey\]\)/);
assert.match(service, /requestDigest/);
assert.match(service, /idempotencyKey has already been used for a different symptom report/);
assert.doesNotMatch(prisma, /logicalKey/);

// Optional appointment and care-plan links are validated against the same patient and protected by FKs.
assert.match(service, /appointment\.patientId !== patientId/);
assert.match(service, /carePlan\.patientId !== patientId/);
assert.match(migration, /SymptomReport_appointmentId_fkey/);
assert.match(migration, /REFERENCES "Appointment"\("id"\)/);
assert.match(migration, /SymptomReport_carePlanId_fkey/);
assert.match(migration, /REFERENCES "CarePlan"\("id"\)/);

// Entries are append-only: no edit/delete path can rewrite what the patient reported.
assert.match(migration, /SymptomReport_append_only/);
assert.match(migration, /BEFORE UPDATE OR DELETE ON "SymptomReport"/);
assert.match(migration, /REVOKE UPDATE, DELETE ON "SymptomReport" FROM PUBLIC/);
assert.doesNotMatch(moduleSource, /@Patch\(/);
assert.doesNotMatch(moduleSource, /@Delete\(/);

// Canonical patient route is /patient/symptoms. Doctors have read-only access behind consent + treatment relationship.
assert.match(moduleSource, /@Controller\("patient\/symptoms"\)/);
assert.match(moduleSource, /@Post\(\)/);
assert.match(moduleSource, /RequirePermissions\("PATIENT_MANAGE_CLINICAL_PROFILE"\)/);
assert.match(moduleSource, /@Controller\("doctor\/patients\/:patientId\/symptoms"\)/);
assert.match(moduleSource, /RequirePermissions\("CLINICAL_PROFILE_READ"\)/);
const doctorController = moduleSource.split('@Controller("doctor/patients/:patientId/symptoms")')[1] ?? "";
assert.doesNotMatch(doctorController, /@Post\(/);
assert.match(service, /clinical-profile-v1/);
assert.match(service, /status:\s*\{ in: \["CONFIRMED", "COMPLETED"\] \}/);
assert.match(service, /decideClinicalResourceAccess/);

// A symptom journal entry must stay separate from professional diagnosis/order domains.
assert.match(service, /diagnosisCreated: false/);
assert.match(service, /orderCreated: false/);
assert.doesNotMatch(service, /diagnosis\.(create|update|upsert)/);
assert.doesNotMatch(service, /clinicalOrder\.(create|update|upsert)/);
assert.match(moduleSource, /Header\("Cache-Control", "no-store"\)/);
assert.match(appModule, /SymptomReportModule/);

console.log("PAT-117 symptom journal backend acceptance passed");

await import("./v2-patient-symptom-journal-ui-smoke.mjs");
