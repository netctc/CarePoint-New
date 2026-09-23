import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const api = readFileSync(new URL("../../../packages/mobile_core/lib/carepoint_api.dart", import.meta.url), "utf8");
const ui = readFileSync(new URL("../../../packages/mobile_core/lib/patient_clinical_history.dart", import.meta.url), "utf8");
const patientMain = readFileSync(new URL("../../../apps/patient-mobile/lib/main.dart", import.meta.url), "utf8");
const moduleSource = readFileSync(new URL("../src/modules/clinical-history/clinical-history.module.ts", import.meta.url), "utf8");

// PAT-089 and PAT-093 must use the governed BE-005/BE-006 API instead of a parallel mobile store.
assert.match(api, /patientHospitalizations\(\)/);
assert.match(api, /createPatientHospitalization/);
assert.match(api, /updatePatientHospitalization/);
assert.match(api, /patientImmunizations\(\)/);
assert.match(api, /createPatientImmunization/);
assert.match(api, /updatePatientImmunization/);
assert.match(api, /\/patient\/clinical-history\/hospitalizations/);
assert.match(api, /\/patient\/clinical-history\/immunizations/);

// Patient Mobile exposes both longitudinal workspaces from My Health.
assert.match(patientMain, /patient-hospitalizations-entry/);
assert.match(patientMain, /patient-immunizations-entry/);
assert.match(patientMain, /PatientHospitalizationsPage/);
assert.match(patientMain, /PatientImmunizationsPage/);
assert.match(ui, /class PatientHospitalizationsPage/);
assert.match(ui, /class PatientImmunizationsPage/);

// Create + optimistic edit are explicit; hospital intervals are checked client-side and the server remains authoritative.
assert.match(ui, /expectedVersion:/);
assert.match(ui, /invalidInterval/);
assert.match(ui, /duplicateOrConflict/);
assert.match(ui, /idempotencyKey:/);
assert.match(ui, /vaccineDisplay:/);
assert.match(ui, /doseNumber:/);
assert.match(ui, /lotNumber:/);
assert.match(ui, /manufacturer:/);

// All four product locales are present; Arabic inherits Directionality from the Patient shell.
for (const locale of ["en", "ar", "fr", "es"]) {
  assert.match(ui, new RegExp("'"+locale+"': \\{"));
}
assert.match(patientMain, /Directionality\(textDirection: locale\.textDirection/);

// Backend contract remains no-store, patient self-scoped and has no DELETE route.
assert.match(moduleSource, /@Controller\("patient\/clinical-history"\)/);
assert.match(moduleSource, /@Get\("hospitalizations"\)/);
assert.match(moduleSource, /@Post\("hospitalizations"\)/);
assert.match(moduleSource, /@Patch\("hospitalizations\/:id"\)/);
assert.match(moduleSource, /@Get\("immunizations"\)/);
assert.match(moduleSource, /@Post\("immunizations"\)/);
assert.match(moduleSource, /@Patch\("immunizations\/:id"\)/);
assert.match(moduleSource, /PATIENT_MANAGE_CLINICAL_PROFILE/);
assert.doesNotMatch(moduleSource, /@Delete\(/);

await import("./v2-clinical-history-smoke.mjs");
console.log("PAT-089/PAT-093 Patient Mobile hospitalization + immunization acceptance passed");
