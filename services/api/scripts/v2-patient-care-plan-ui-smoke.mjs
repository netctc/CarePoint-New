import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const controller = read("../src/modules/care-plan/care-plan.controller.ts");
const service = read("../src/modules/care-plan/care-plan.service.ts");
const engine = read("../src/modules/care-plan/care-plan.engine.ts");
const api = read("../../../packages/mobile_core/lib/carepoint_api.dart");
const mobile = read("../../../packages/mobile_core/lib/patient_care_plans.dart");
const main = read("../../../apps/patient-mobile/lib/main.dart");

// PAT-125 — patient sees only own active/paused effective Care Plans.
assert.match(controller, /@Controller\("patient\/care-plans"\)/);
assert.match(controller, /PATIENT_READ_CLINICAL_RECORD/);
assert.match(service, /async listMine/);
assert.match(service, /status: \{ in: \["ACTIVE", "PAUSED"\] \}/);
assert.match(service, /effectiveFrom: \{ lte: now \}/);
assert.match(service, /PATIENT_SELF/);
assert.match(api, /patientCarePlans/);
assert.match(mobile, /class PatientCarePlansPage/);
assert.match(main, /patient-care-plans-entry/);

// PAT-126 — goals retain clinician-defined criterion / period and expose no autonomous inference.
assert.match(controller, /@Get\(":carePlanId\/goals"\)/);
assert.match(service, /async patientGoals/);
assert.match(service, /automatedClinicalInference: false/);
assert.match(engine, /criterion/);
assert.match(engine, /MEASURABLE/);
assert.match(engine, /QUALITATIVE/);
assert.match(mobile, /patientCarePlanGoals/);
assert.match(mobile, /data\['criterion'\]/);

// PAT-127 — tasks are patient-assigned, auditable and support DONE / OMITTED.
assert.match(controller, /@Get\(":carePlanId\/tasks"\)/);
assert.match(controller, /@Controller\("patient\/care-tasks"\)/);
assert.match(controller, /@Post\(":taskId\/completions"\)/);
assert.match(service, /assigneeType: "PATIENT"/);
assert.match(service, /CARE_TASK_COMPLETED/);
assert.match(service, /latestCompletion/);
assert.match(service, /careTaskCompletion\.findMany/);
assert.match(engine, /\["DONE", "OMITTED"\]/);
assert.match(api, /completePatientCareTask/);
assert.match(mobile, /patient-care-task-done-/);
assert.match(mobile, /patient-care-task-omit-/);
assert.match(mobile, /reasonCode/);
assert.match(mobile, /latestCompletion/);

// PAT-128 — adherence summary uses an explicit reported-outcomes denominator.
// Missing task occurrences are never inferred as non-adherence.
assert.match(controller, /@Get\(":carePlanId\/adherence"\)/);
assert.match(service, /async patientAdherence/);
assert.match(service, /outcome: \{ in: \["DONE", "OMITTED"\] \}/);
assert.match(service, /definition: "RECORDED_OUTCOMES_ONLY"/);
assert.match(service, /unrecordedOccurrencesPenalized: false/);
assert.match(service, /missedOccurrenceInference: false/);
assert.match(service, /automatedClinicalInference: false/);
assert.match(service, /CARE_PLAN_ADHERENCE_READ/);
assert.match(service, /Adherence period cannot exceed 365 days/);
assert.match(api, /patientCarePlanAdherence/);
assert.match(mobile, /patient-care-plan-adherence/);
assert.match(mobile, /reportedCompletionPct/);
assert.match(mobile, /adherenceDays/);
assert.match(mobile, /Missing\/unrecorded occurrences are not counted as non-adherence|Missing\/unrecorded/);

// UX is multilingual and explicitly non-diagnostic.
for (const locale of ["CarePointLocale.en","CarePointLocale.ar","CarePointLocale.fr","CarePointLocale.es"]) {
  assert.ok(mobile.includes(locale), `Missing Patient Care Plan locale ${locale}`);
}
assert.match(mobile, /does not generate clinical conclusions/);
assert.match(main, /Directionality\(textDirection: widget\.locale\.textDirection/);

console.log("PAT-125/PAT-126/PAT-127 Patient Care Plan acceptance passed");

function read(relative) {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}
