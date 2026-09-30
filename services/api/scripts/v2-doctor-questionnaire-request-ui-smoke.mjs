import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const model = read("../prisma/v2_appointment_continuity.prisma");
const migration = read("../prisma/migrations/20260923003000_v2_questionnaire_requests/migration.sql");
const moduleSource = read("../src/modules/appointment-continuity/appointment-continuity.module.ts");
const service = read("../src/modules/appointment-continuity/appointment-continuity.service.ts");
const app = read("../src/app.module.ts");
const questionnaireModel = read("../prisma/v2_questionnaire.prisma");
const api = read("../../../packages/mobile_core/lib/carepoint_api.dart");
const mobile = read("../../../packages/mobile_core/lib/questionnaire_requests.dart");
const record = read("../../../packages/mobile_core/lib/clinical_record.dart");
const patientMain = read("../../../apps/patient-mobile/lib/main.dart");

const requestModel = model.match(/model QuestionnaireRequest \{[\s\S]*?\n\}/)?.[0] ?? "";
assert.ok(requestModel);
assert.match(requestModel, /questionnaireVersionId/);
assert.match(requestModel, /appointmentId/);
assert.match(requestModel, /idempotencyKey\s+String\?\s+@unique/);
assert.match(requestModel, /context\s+String\?/);
assert.match(requestModel, /completedAt\s+DateTime\?/);
assert.match(requestModel, /responseId\s+String\?/);
assert.doesNotMatch(requestModel, /answers|ciphertext|wrappedKey/);
assert.equal((questionnaireModel.match(/model QuestionnaireRequest/g) ?? []).length, 0);

assert.match(migration, /ALTER TABLE "QuestionnaireRequest"/);
assert.doesNotMatch(migration, /CREATE TABLE "QuestionnaireRequest"/);
assert.match(migration, /QuestionnaireRequest_idempotencyKey_key/);
assert.match(migration, /PRE_VISIT/);
assert.match(migration, /POST_VISIT/);
assert.match(migration, /FOLLOW_UP/);

assert.match(moduleSource, /@Controller\("doctor\/patients"\)/);
assert.match(moduleSource, /questionnaire-requests\/available/);
assert.match(moduleSource, /@Controller\("patient\/questionnaire-requests"\)/);
assert.match(moduleSource, /PATIENT_MANAGE_QUESTIONNAIRE/);
assert.match(service, /requestQuestionnaireForVisit/);
assert.match(service, /principal\.role !== "DOCTOR"/);
assert.match(service, /status: \{ in: \["CONFIRMED", "COMPLETED"\] \}/);
assert.match(service, /version\.status !== "ACTIVE"/);
assert.match(service, /dueAt cannot exceed 30 days/);
assert.match(service, /PRE_VISIT dueAt must be before appointment start/);
assert.match(service, /idempotencyKey is bound to another questionnaire request/);
assert.match(service, /patientQuestionnaireRequests/);
assert.match(service, /submitRequestedQuestionnaire/);
assert.match(service, /questionnaireVersionId: version\.id/);
assert.match(service, /normalizeQuestionnaireSchema\(version\.schema\)/);
assert.match(service, /normalizeQuestionnaireAnswers\(schema, input\?\.answers\)/);
assert.match(service, /status: "COMPLETED", responseId: created\.id, completedAt: created\.completedAt/);
assert.match(service, /encryptRecord/);
assert.match(service, /QUESTIONNAIRE_REQUEST_COMPLETED/);
assert.match(service, /notification\.questionnaire_request\.title/);
assert.match(service, /notification\.questionnaire_completed\.title/);

assert.doesNotMatch(app, /QuestionnaireRequestsModule/);
assert.match(app, /AppointmentContinuityModule/);

assert.match(api, /doctorQuestionnaireRequestOptions/);
assert.match(api, /createDoctorQuestionnaireRequest/);
assert.match(api, /patientQuestionnaireRequests/);
assert.match(api, /submitPatientQuestionnaireRequest/);
assert.match(record, /doctor-questionnaire-request-entry/);
assert.match(patientMain, /patient-questionnaire-requests-entry/);
assert.match(mobile, /class DoctorQuestionnaireRequestsPage/);
assert.match(mobile, /class PatientQuestionnaireRequestsPage/);
assert.match(mobile, /class RequestedQuestionnaireFormPage/);
assert.match(mobile, /questionnaireVersionId/);
for (const type of ["BOOLEAN", "SINGLE_CHOICE", "MULTI_CHOICE", "NUMBER", "TEXT", "DATE"]) {
  assert.match(mobile, new RegExp(type));
}
for (const locale of ["CarePointLocale.en", "CarePointLocale.ar", "CarePointLocale.fr", "CarePointLocale.es"]) {
  assert.ok(mobile.includes(locale), `Missing questionnaire-request locale ${locale}`);
}

console.log("DOC-084 Doctor-requested questionnaire acceptance passed");

function read(relative) {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}
