import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const schema = read("../prisma/v2_adverse_event_reports.prisma");
const migration = read("../prisma/migrations/20260924014500_v2_adverse_event_reports/migration.sql");
const moduleSource = read("../src/modules/adverse-events/adverse-events.module.ts");
const app = read("../src/app.module.ts");
const api = read("../../../packages/mobile_core/lib/carepoint_api.dart");
const mobile = read("../../../packages/mobile_core/lib/patient_adverse_events.dart");
const reminders = read("../../../packages/mobile_core/lib/patient_medication_reminders.dart");

assert.match(schema, /model AdverseEventReport/);
assert.match(schema, /ciphertext\s+String/);
assert.match(schema, /requestDigest\s+String/);
assert.doesNotMatch(schema, /symptom\s+String|severityDeclared\s+Int|notes\s+String/);
assert.match(migration, /AdverseEventReport_append_only/);
assert.match(migration, /BEFORE UPDATE OR DELETE ON "AdverseEventReport"/);
assert.match(migration, /REVOKE UPDATE, DELETE ON "AdverseEventReport" FROM PUBLIC/);
assert.doesNotMatch(migration, /DROP TABLE|DROP COLUMN/);

assert.match(moduleSource, /@Controller\("patient\/adverse-events"\)/);
assert.match(moduleSource, /@Controller\("provider\/adverse-events"\)/);
assert.match(moduleSource, /PATIENT_MANAGE_CLINICAL_PROFILE/);
assert.match(moduleSource, /CLINICAL_PROFILE_READ/);
assert.match(moduleSource, /causality: \{ assessed: false \}/);
assert.match(moduleSource, /severityDeclared must be an integer from 0 to 10/);
assert.match(moduleSource, /row\.kind !== "MEDICATION"|entry\.kind !== "MEDICATION"/);
assert.match(moduleSource, /order\.type !== "PRESCRIPTION"/);
assert.match(moduleSource, /order\.status !== "SIGNED"/);
assert.match(moduleSource, /routedToCareTeam: true/);
assert.match(moduleSource, /notification\.adverse_event\.title/);
assert.match(moduleSource, /enqueueAccountInTransaction/);
assert.match(moduleSource, /diagnosisCreated: false/);
assert.match(moduleSource, /prescriptionModified: false/);
assert.doesNotMatch(moduleSource, /diagnosis\.(create|update|upsert)/);
assert.doesNotMatch(moduleSource, /clinicalOrder\.(create|update|upsert)/);
assert.match(app, /AdverseEventReportModule/);

assert.match(api, /patientAdverseEvents/);
assert.match(api, /createPatientAdverseEvent/);
assert.match(api, /doctorAdverseEventInbox/);
assert.match(api, /\/patient\/adverse-events/);
assert.match(api, /\/provider\/adverse-events/);

assert.match(reminders, /patient-adverse-event-report-/);
assert.match(reminders, /PatientAdverseEventReportPage/);
assert.match(mobile, /causalityAssessed/);
assert.match(mobile, /does not establish|no demuestra|ne prouvent pas|لا تثبت/);
assert.match(mobile, /patient-adverse-event-create/);
for (const locale of ["CarePointLocale.en","CarePointLocale.ar","CarePointLocale.fr","CarePointLocale.es"]) {
  assert.ok(mobile.includes(locale), `Missing adverse-event locale ${locale}`);
}

console.log("PAT-131 possible medication adverse-effect reporting acceptance passed");

function read(relative) {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}
