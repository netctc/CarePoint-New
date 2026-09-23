import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const moduleSource = read("../src/modules/rpm/rpm-alert.module.ts");
const service = read("../src/modules/rpm/rpm-alert.service.ts");
const api = read("../../../packages/mobile_core/lib/carepoint_api.dart");
const ui = read("../../../packages/mobile_core/lib/patient_clinical_alerts.dart");
const main = read("../../../apps/patient-mobile/lib/main.dart");

assert.match(moduleSource, /@Controller\("patient\/clinical-alerts"\)/);
assert.match(moduleSource, /@Get\(\)/);
assert.match(moduleSource, /@Post\(":alertId\/viewed"\)/);
assert.match(moduleSource, /PATIENT_READ_CLINICAL_RECORD/);
assert.match(moduleSource, /Cache-Control/);

assert.match(service, /async patientAlerts/);
assert.match(service, /async markPatientViewed/);
assert.match(service, /action: "VIEWED"/);
assert.match(service, /ruleId: row\.ruleId/);
assert.match(service, /ruleVersion: row\.ruleVersion/);
assert.match(service, /sourceObservationId: row\.sourceObservationId/);
assert.match(service, /patientActionKey: row\.patientActionKey/);
assert.match(service, /automatedDiagnosis: false/);

assert.match(api, /patientClinicalAlerts/);
assert.match(api, /markPatientClinicalAlertViewed/);
assert.match(api, /\/patient\/clinical-alerts/);

assert.match(main, /patient-clinical-alerts-entry/);
assert.match(main, /PatientClinicalAlertsPage/);
assert.match(ui, /Recommended action/);
assert.match(ui, /Source observation/);
assert.match(ui, /ruleVersion/);
assert.match(ui, /markPatientClinicalAlertViewed/);
assert.match(ui, /do not create an automatic diagnosis/);
for (const locale of ["CarePointLocale.en","CarePointLocale.ar","CarePointLocale.fr","CarePointLocale.es"]) {
  assert.ok(ui.includes(locale), `Missing patient-alert locale ${locale}`);
}

console.log("PAT-124 Patient Mobile care-plan alerts acceptance passed");

function read(relative) {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}
