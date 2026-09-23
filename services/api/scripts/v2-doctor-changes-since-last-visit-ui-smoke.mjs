import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const engine = read("../src/modules/doctor-snapshot/changes-since-last-visit.engine.ts");
const service = read("../src/modules/doctor-snapshot/changes-since-last-visit.service.ts");
const moduleSource = read("../src/modules/doctor-snapshot/doctor-snapshot.module.ts");
const api = read("../../../packages/mobile_core/lib/carepoint_api.dart");
const ui = read("../../../packages/mobile_core/lib/doctor_changes_since_last_visit.dart");
const record = read("../../../packages/mobile_core/lib/clinical_record.dart");

assert.match(engine, /"LAB_RESULT"/);
assert.match(engine, /"CLINICAL_ALERT"/);
assert.match(engine, /detailTarget: `\/clinical-orders\//);
assert.match(engine, /detailTarget: `\/provider\/monitoring-queue\?alertId=/);
assert.match(engine, /automatedClinicalInference: false/);
assert.doesNotMatch(engine, /metadata: \{[^}]*\bvalue\b/s);
assert.doesNotMatch(engine, /metadata: \{[^}]*\bunit\b/s);

assert.match(service, /OrdersService/);
assert.match(service, /RpmAlertService/);
assert.match(service, /providerPatientOrders\(principal, patientId\)/);
assert.match(service, /providerInbox\(principal\)/);
assert.match(service, /order\.type !== "LABORATORY"/);
assert.match(service, /lab\.status === "VALIDATED" \|\| lab\.status === "RELEASED"/);
assert.match(service, /alert\.patientId !== patientId/);
assert.match(moduleSource, /OrdersModule/);
assert.match(moduleSource, /RpmAlertModule/);

assert.match(api, /doctorChangesSinceLastVisit/);
assert.match(api, /changes-since-last-visit/);
assert.match(record, /doctor-changes-since-last-visit-entry/);
assert.match(record, /DoctorChangesSinceLastVisitPage/);
assert.match(record, /openFullHistory == true/);
assert.match(record, /showPatientHistory\(\)/);

assert.match(ui, /class DoctorChangesSinceLastVisitPage/);
assert.match(ui, /doctor-change-source-/);
assert.match(ui, /doctor-change-detail-target-/);
assert.match(ui, /detailTarget/);
assert.match(ui, /doctor-changes-open-full-history/);
for (const domain of ["HEALTH_PROFILE","CLINICAL_PROFILE","QUESTIONNAIRE","OBSERVATION","LAB_RESULT","CLINICAL_ALERT"]) {
  assert.match(ui, new RegExp(domain));
}
for (const locale of ["CarePointLocale.en","CarePointLocale.ar","CarePointLocale.fr","CarePointLocale.es"]) {
  assert.ok(ui.includes(locale), `Missing DOC-090 locale ${locale}`);
}

console.log("DOC-090 changes-since-last-consult Doctor Mobile acceptance passed");

function read(relative) {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}
