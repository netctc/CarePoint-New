import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const service = read("../src/modules/symptom-reports/symptom-report.service.ts");
const moduleSource = read("../src/modules/symptom-reports/symptom-report.module.ts");
const api = read("../../../packages/mobile_core/lib/carepoint_api.dart");
const ui = read("../../../packages/mobile_core/lib/patient_symptom_journal.dart");
const main = read("../../../apps/patient-mobile/lib/main.dart");

assert.match(moduleSource, /@Controller\("patient\/symptoms"\)/);
assert.match(moduleSource, /@Post\(\)/);
assert.match(moduleSource, /@Get\(\)/);
assert.match(moduleSource, /PATIENT_MANAGE_CLINICAL_PROFILE/);
assert.doesNotMatch(moduleSource, /@Patch\(/);
assert.doesNotMatch(moduleSource, /@Delete\(/);

assert.match(service, /source:\s*\{ type: "PATIENT_REPORTED" \}/);
assert.match(service, /severity must be an integer from 0 to 10/);
assert.match(service, /duration\.unit must be MINUTES, HOURS, DAYS or WEEKS/);
assert.match(service, /occurredAt cannot be in the future/);
assert.match(service, /effectiveAt: row\.occurredAt \?\? row\.reportedAt/);
assert.match(service, /occurredAt: \{ sort: "desc", nulls: "last" \}/);
assert.match(service, /diagnosisCreated: false/);
assert.match(service, /orderCreated: false/);

assert.match(api, /patientSymptoms/);
assert.match(api, /createPatientSymptom/);
assert.match(api, /\/patient\/symptoms/);
assert.match(main, /patient-symptom-journal-entry/);
assert.match(main, /PatientSymptomJournalPage/);

assert.match(ui, /Slider/);
assert.match(ui, /max: 10/);
assert.match(ui, /showDatePicker/);
assert.match(ui, /showTimePicker/);
assert.match(ui, /durationUnit/);
assert.match(ui, /Context \/ trigger/);
assert.match(ui, /patient-reported symptoms, not professional diagnoses/);
assert.match(ui, /effectiveAt/);
assert.match(ui, /sourceType/);
for (const locale of ["CarePointLocale.en","CarePointLocale.ar","CarePointLocale.fr","CarePointLocale.es"]) {
  assert.ok(ui.includes(locale), `Missing symptom-journal locale ${locale}`);
}

console.log("PAT-117 Patient Mobile symptom journal acceptance passed");

function read(relative) {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}
