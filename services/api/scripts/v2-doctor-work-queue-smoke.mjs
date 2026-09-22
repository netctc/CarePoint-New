import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const moduleSource = readFileSync(new URL("../src/modules/doctor-work-queue/doctor-work-queue.module.ts", import.meta.url), "utf8");
const appModule = readFileSync(new URL("../src/app.module.ts", import.meta.url), "utf8");
const api = readFileSync(new URL("../../../packages/mobile_core/lib/carepoint_api.dart", import.meta.url), "utf8");
const workspace = readFileSync(new URL("../../../packages/mobile_core/lib/provider_workspace.dart", import.meta.url), "utf8");
const mobile = readFileSync(new URL("../../../packages/mobile_core/lib/doctor_work_queue.dart", import.meta.url), "utf8");

assert.match(moduleSource, /@Controller\("provider\/work-queue"\)/);
assert.match(moduleSource, /@RequirePermissions\("CLINICAL_RECORD_READ"\)/);
assert.match(moduleSource, /principal\.role !== "DOCTOR"/);
assert.match(moduleSource, /provider\.class !== "DOCTOR"/);
assert.match(moduleSource, /provider\.status !== "ACTIVE"/);
assert.match(moduleSource, /@Header\("Cache-Control", "no-store"\)/);
assert.doesNotMatch(moduleSource, /@Post\(/);
assert.doesNotMatch(moduleSource, /@Patch\(/);
assert.doesNotMatch(moduleSource, /@Delete\(/);

assert.match(moduleSource, /status: \{ in: \["CONFIRMED", "COMPLETED"\] \}/);
assert.match(moduleSource, /const patientIds = \[\.\.\.new Set\(rosterAppointments\.map/);
assert.match(moduleSource, /patientId: \{ in: patientIds \}/);
assert.match(moduleSource, /ownerProviderId: provider\.id/);
assert.match(moduleSource, /type: "LABORATORY"/);
assert.match(moduleSource, /recommendedFor: \{ lt: now \}/);

assert.match(moduleSource, /QUESTIONNAIRE_SCOPE = "QUESTIONNAIRE_READ"/);
assert.match(moduleSource, /QUESTIONNAIRE_CONSENT_VERSION = "questionnaire-read-v1"/);
assert.match(moduleSource, /state: "GRANTED"/);
assert.match(moduleSource, /evaluateQuestionnaireActivation/);
assert.match(moduleSource, /normalizeActivationRules/);

assert.match(moduleSource, /status: \{ not: "RESOLVED" \}/);
assert.match(moduleSource, /status: "RELEASED"/);
assert.match(moduleSource, /releasedAt <= item\.lastCompletedAt/);
assert.match(moduleSource, /completedAt >= dueAt/);
assert.match(moduleSource, /autonomousClinicalDecision: false/);
assert.match(moduleSource, /DOCTOR_WORK_QUEUE_READ/);
assert.match(appModule, /DoctorWorkQueueModule/);

assert.match(api, /doctorWorkQueue\(\)/);
assert.match(api, /\/provider\/work-queue/);
assert.match(workspace, /widget\.session\.role == 'DOCTOR'/);
assert.match(workspace, /DoctorWorkQueuePanel/);
assert.match(workspace, /doctorWorkQueuePatientIds/);
for (const key of ["PENDING_QUESTIONNAIRE", "OPEN_ALERT", "NEW_RESULT", "OVERDUE_FOLLOW_UP"]) {
  assert.match(mobile, new RegExp(key));
}
for (const locale of ["en", "ar", "fr", "es"]) {
  assert.match(mobile, new RegExp("'" + locale + "'"));
}

console.log("DOC-089 Doctor follow-up work queue acceptance passed");
