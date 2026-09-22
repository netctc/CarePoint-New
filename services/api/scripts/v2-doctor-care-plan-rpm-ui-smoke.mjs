import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const careController = read("../src/modules/care-plan/care-plan.controller.ts");
const careService = read("../src/modules/care-plan/care-plan.service.ts");
const careEngine = read("../src/modules/care-plan/care-plan.engine.ts");
const rpmModule = read("../src/modules/rpm/rpm-alert.module.ts");
const rpmService = read("../src/modules/rpm/rpm-alert.service.ts");
const rpmEngine = read("../src/modules/rpm/rpm-alert.engine.ts");
const api = read("../../../packages/mobile_core/lib/carepoint_api.dart");
const record = read("../../../packages/mobile_core/lib/clinical_record.dart");
const ui = read("../../../packages/mobile_core/lib/doctor_care_plan_rpm.dart");

// DOC-069..072 reuse versioned, encrypted Care Plan domain and expose the missing provider reads.
assert.match(careController, /@Get\("care-plans\/:carePlanId\/goals"\)/);
assert.match(careController, /@Get\("care-plans\/:carePlanId\/tasks"\)/);
assert.match(careController, /Header\("Cache-Control", "no-store"\)/);
assert.match(careService, /async providerGoals/);
assert.match(careService, /async providerTasks/);
assert.match(careService, /requireReadablePlan/);
assert.match(careService, /CARE_PLAN_CONSENT_VERSION = "care-plan-v1"/);
assert.match(careService, /ClinicalEnvelopeService/);
assert.match(careService, /carePlanRevision\.create/);
assert.match(careService, /carePlanGoalRevision\.create/);
assert.match(careEngine, /MEASURABLE/);
assert.match(careEngine, /QUALITATIVE/);
assert.match(careEngine, /MEASUREMENT/);
assert.match(careEngine, /FOLLOW_UP/);
assert.match(api, /doctorPatientCarePlans/);
assert.match(api, /createDoctorCarePlan/);
assert.match(api, /doctorCarePlanGoals/);
assert.match(api, /doctorCarePlanTasks/);
assert.match(api, /addDoctorCarePlanGoal/);
assert.match(api, /addDoctorCarePlanTask/);
assert.match(api, /doctorCarePlanProgress/);

// DOC-073..075 reuse deterministic RPM; provider policy projection is config-only and role guarded.
assert.match(rpmModule, /@Get\("rpm\/policies"\)/);
assert.match(rpmModule, /@Get\("monitoring-queue"\)/);
assert.match(rpmModule, /@Post\("clinical-alerts\/:alertId\/actions"\)/);
assert.match(rpmService, /async providerPolicyCatalog/);
assert.match(rpmService, /await this\.requireDoctor\(principal\)/);
assert.match(rpmService, /clinicalPayloadIncluded: false/);
assert.match(rpmService, /async providerInbox/);
assert.match(rpmService, /async act/);
assert.match(rpmService, /async createRule/);
assert.match(rpmService, /async updateRule/);
assert.match(rpmEngine, /evaluateAlertRule/);
assert.match(rpmEngine, /ACKNOWLEDGE/);
assert.match(rpmEngine, /ESCALATE/);
assert.match(rpmEngine, /RESOLVE/);
assert.match(rpmService, /automatedClinicalInference: false/);
assert.match(api, /doctorMonitoringQueue/);
assert.match(api, /doctorClinicalAlertAction/);
assert.match(api, /doctorRpmPolicies/);
assert.match(api, /createDoctorCarePlanAlertRule/);

// Doctor Mobile explicitly authors Care Plans/goals/tasks, reads deterministic progress, and operates RPM.
assert.match(record, /doctor-care-plan-rpm-entry/);
assert.match(record, /DoctorCarePlanRpmPage/);
assert.match(ui, /createDoctorCarePlan/);
assert.match(ui, /addDoctorCarePlanGoal/);
assert.match(ui, /addDoctorCarePlanTask/);
assert.match(ui, /doctorCarePlanProgress/);
assert.match(ui, /createDoctorCarePlanAlertRule/);
assert.match(ui, /doctorClinicalAlertAction/);
assert.match(ui, /ACKNOWLEDGE/);
assert.match(ui, /ESCALATE/);
assert.match(ui, /RESOLVE/);
assert.match(ui, /no autonomous clinical inference/i);
for (const locale of ["CarePointLocale.en", "CarePointLocale.ar", "CarePointLocale.fr", "CarePointLocale.es"]) {
  assert.ok(ui.includes(locale), `Missing Care Plan/RPM locale ${locale}`);
}
assert.match(record, /Directionality[\s\S]*textDirection: locale\.textDirection/);

console.log("DOC-069..DOC-075 Doctor Care Plan and deterministic RPM acceptance passed");

function read(relative) {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}
