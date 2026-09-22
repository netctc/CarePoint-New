import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const model = read("../prisma/v2_questionnaire.prisma");
const migration = read("../prisma/migrations/20260923003000_v2_questionnaire_requests/migration.sql");
const moduleSource = read("../src/modules/questionnaire-requests/questionnaire-requests.module.ts");
const service = read("../src/modules/questionnaire-requests/questionnaire-requests.service.ts");
const app = read("../src/app.module.ts");
const api = read("../../../packages/mobile_core/lib/carepoint_api.dart");
const mobile = read("../../../packages/mobile_core/lib/questionnaire_requests.dart");
const record = read("../../../packages/mobile_core/lib/clinical_record.dart");
const patientMain = read("../../../apps/patient-mobile/lib/main.dart");

// DOC-084 metadata is additive and never duplicates the encrypted response payload.
assert.match(model, /model QuestionnaireRequest/);
const requestModel = model.match(/model QuestionnaireRequest \{[\s\S]*?\n\}/)?.[0] ?? "";
assert.match(requestModel, /questionnaireVersionId/);
assert.match(requestModel, /appointmentId/);
assert.match(requestModel, /context/);
assert.match(requestModel, /dueAt/);
assert.match(requestModel, /completedResponseId/);
assert.doesNotMatch(requestModel, /answers|ciphertext|wrappedKey/);
assert.match(migration, /QuestionnaireRequest_context_check/);
assert.match(migration, /PRE_VISIT/);
assert.match(migration, /POST_VISIT/);
assert.match(migration, /FOLLOW_UP/);
assert.match(migration, /QuestionnaireRequest_questionnaireVersionId_fkey/);
assert.match(migration, /QuestionnaireRequest_completedResponseId_fkey/);

// Doctor can request only an active exact version for this Doctor's appointment.
assert.match(moduleSource, /@Controller\("doctor\/patients"\)/);
assert.match(moduleSource, /@Get\(":patientId\/questionnaire-requests\/available"\)/);
assert.match(moduleSource, /@Post\(":patientId\/questionnaire-requests"\)/);
assert.match(moduleSource, /CARE_COORDINATION_MANAGE/);
assert.match(moduleSource, /Cache-Control/);
assert.match(service, /principal\.role !== "DOCTOR"/);
assert.match(service, /provider\.class !== "DOCTOR"/);
assert.match(service, /provider\.status !== "ACTIVE"/);
assert.match(service, /appointment\.patientId !== patientId/);
assert.match(service, /appointment\.providerId !== providerId/);
assert.match(service, /status: "ACTIVE"/);
assert.match(service, /questionnaire: \{ code, active: true \}/);
assert.match(service, /PRE_VISIT dueAt must be before appointment start/);
assert.match(service, /POST_VISIT/);
assert.match(service, /FOLLOW_UP/);
assert.match(service, /MAX_REQUEST_DAYS = 30/);
assert.match(service, /QUESTIONNAIRE_REQUEST_CREATED/);

// Notifications are structural only; no questionnaire answer is copied into notification metadata.
assert.match(service, /safeTitleKey: "questionnaire\.requested\.title"/);
assert.match(service, /safeBodyKey: "questionnaire\.requested\.body"/);
assert.match(service, /safeTitleKey: "questionnaire\.completed\.title"/);
assert.doesNotMatch(service, /safeBodyKey:[\s\S]{0,120}answers/);

// Patient sees only unexpired own requests and submits the exact requested version.
assert.match(moduleSource, /@Controller\("patient\/questionnaire-requests"\)/);
assert.match(moduleSource, /PATIENT_MANAGE_QUESTIONNAIRE/);
assert.match(service, /patientId: patient\.id, status: "REQUESTED", dueAt: \{ gt: now \}/);
assert.match(service, /questionnaireVersionId: version\.id/);
assert.match(service, /normalizeQuestionnaireSchema\(version\.schema\)/);
assert.match(service, /normalizeQuestionnaireAnswers\(schema, input\?\.answers\)/);
assert.match(service, /questionnaireResponse\.create/);
assert.match(service, /status: "COMPLETED"/);
assert.match(service, /completedResponseId: response\.id/);
assert.match(service, /QUESTIONNAIRE_REQUEST_COMPLETED/);
assert.match(service, /encryptRecord\(payload\)/);
assert.match(app, /QuestionnaireRequestsModule/);

// Doctor + Patient Mobile expose the governed flow without a parallel questionnaire engine.
assert.match(api, /doctorQuestionnaireRequestOptions/);
assert.match(api, /createDoctorQuestionnaireRequest/);
assert.match(api, /patientQuestionnaireRequests/);
assert.match(api, /submitPatientQuestionnaireRequest/);
assert.match(record, /doctor-questionnaire-request-entry/);
assert.match(patientMain, /patient-questionnaire-requests-entry/);
assert.match(mobile, /class DoctorQuestionnaireRequestsPage/);
assert.match(mobile, /class PatientQuestionnaireRequestsPage/);
assert.match(mobile, /class RequestedQuestionnaireFormPage/);
for (const type of ["BOOLEAN", "SINGLE_CHOICE", "MULTI_CHOICE", "NUMBER", "TEXT", "DATE"]) {
  assert.match(mobile, new RegExp(type));
}
for (const locale of ["CarePointLocale.en", "CarePointLocale.ar", "CarePointLocale.fr", "CarePointLocale.es"]) {
  assert.ok(mobile.includes(locale), `Missing questionnaire-request locale ${locale}`);
}
assert.match(record, /Directionality[\s\S]*textDirection: locale\.textDirection/);
assert.match(patientMain, /Directionality\(textDirection: widget\.locale\.textDirection/);

console.log("DOC-084 Doctor-requested questionnaire acceptance passed");

function read(relative) {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}
