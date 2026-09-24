import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const moduleSource = read("../src/modules/appointment-continuity/appointment-continuity.module.ts");
const service = read("../src/modules/appointment-continuity/appointment-continuity.service.ts");
const engine = read("../src/modules/appointment-continuity/appointment-continuity.engine.ts");
const api = read("../../../packages/mobile_core/lib/carepoint_api.dart");
const visits = read("../../../packages/mobile_core/lib/care_visits.dart");
const ui = read("../../../packages/mobile_core/lib/patient_appointment_continuity.dart");

// PAT-138 — appointment-specific preconsult checklist.
assert.match(moduleSource, /@Controller\("patient\/appointments"\)/);
assert.match(moduleSource, /@Get\(":appointmentId\/prep"\)/);
assert.match(moduleSource, /@Patch\(":appointmentId\/prep\/:taskCode"\)/);
assert.match(moduleSource, /PATIENT_MANAGE_APPOINTMENT/);
assert.match(service, /ensureDefaultPrepTasks/);
assert.match(service, /This preparation task requires sourceRef evidence/);
assert.match(service, /taskType === "QUESTIONNAIRE"/);
assert.match(service, /taskType === "OBSERVATION"/);
assert.match(service, /taskType === "DOCUMENT"/);
assert.match(engine, /missingRequiredCodes/);
assert.match(engine, /completionPercent/);
assert.match(api, /patientAppointmentPrep/);
assert.match(api, /updatePatientAppointmentPrep/);
assert.match(visits, /visit-prep-/);
assert.match(ui, /PatientAppointmentPrepPage/);
assert.match(ui, /patient-prep-complete-/);
assert.match(ui, /patient-prep-na-/);
assert.match(ui, /sourceRefHint/);

// PAT-139 — released/versioned after-visit plan only; no implicit booking.
assert.match(moduleSource, /@Controller\("patient\/encounters"\)/);
assert.match(moduleSource, /@Get\(":appointmentId\/follow-up"\)/);
assert.match(moduleSource, /PATIENT_READ_CLINICAL_RECORD/);
assert.match(service, /status: "RELEASED"/);
assert.match(service, /Released follow-up is not available/);
assert.match(service, /version: row\.version/);
assert.match(service, /bookingCreated: false/);
assert.match(engine, /recommendedAfterDays/);
assert.match(engine, /careTaskIds/);
assert.match(api, /patientEncounterFollowUp/);
assert.match(visits, /visit-follow-up-plan-/);
assert.match(ui, /PatientEncounterFollowUpPage/);
assert.match(ui, /recommendedReview/);
assert.match(ui, /careTaskIds/);
assert.match(ui, /bookingCreated/);

for (const locale of ["CarePointLocale.en","CarePointLocale.ar","CarePointLocale.fr","CarePointLocale.es"]) {
  assert.ok(ui.includes(locale), `Missing appointment-continuity locale ${locale}`);
}

console.log("PAT-138/PAT-139 Patient appointment continuity acceptance passed");

function read(relative) {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}
