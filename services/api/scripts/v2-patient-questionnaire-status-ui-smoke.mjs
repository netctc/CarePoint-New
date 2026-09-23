import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const moduleSource = read("../src/modules/questionnaire/questionnaire.module.ts");
const service = read("../src/modules/questionnaire/questionnaire.service.ts");
const engine = read("../src/modules/questionnaire/questionnaire.engine.ts");
const api = read("../../../packages/mobile_core/lib/carepoint_api.dart");
const mobile = read("../../../packages/mobile_core/lib/questionnaire_requests.dart");
const main = read("../../../apps/patient-mobile/lib/main.dart");

// PAT-107 reuses the governed activation policy; no second staleness store.
assert.match(engine, /repeatDays/);
assert.match(engine, /PERIODIC_REVIEW/);
assert.match(engine, /dueAt/);
assert.match(moduleSource, /@Get\("status"\)/);
assert.match(moduleSource, /@Post\(":code\/confirm-no-changes"\)/);
assert.match(moduleSource, /PATIENT_MANAGE_QUESTIONNAIRE/);
assert.match(moduleSource, /Cache-Control/);

assert.match(service, /questionnaireVersionId: true/);
assert.match(service, /latestQuestionnaireVersionId/);
assert.match(service, /canConfirmNoChanges/);
assert.match(service, /previous\.questionnaireVersionId === item\.id/);
assert.match(service, /async confirmNoChangesMine/);
assert.match(service, /Questionnaire is not due for review/);
assert.match(service, /previous\.questionnaireVersionId !== active\.id/);
assert.match(service, /expectedQuestionnaireVersionId/);
assert.match(service, /Questionnaire version changed; complete the current questionnaire/);
assert.match(service, /answers: previousPayload\.answers/);
assert.match(service, /healthChanged: false/);
assert.match(service, /QUESTIONNAIRE_NO_CHANGES_CONFIRMED/);
assert.match(service, /activeVersion\?\.status !== "ACTIVE"/);

// Confirmation is append-only: it goes through submitMine / questionnaireResponse.create.
assert.match(service, /this\.submitMine\(principal, normalizedCode/);
assert.match(service, /questionnaireResponse\.create/);
assert.doesNotMatch(service, /questionnaireResponse\.update\(/);
assert.doesNotMatch(service, /questionnaireResponse\.delete/);

// Client pins the active version for both edit and no-change paths.
assert.match(api, /patientQuestionnaireStatus/);
assert.match(api, /patientDueQuestionnaires/);
assert.match(api, /submitPatientQuestionnaire\(/);
assert.match(api, /confirmPatientQuestionnaireNoChanges/);
assert.match(api, /expectedQuestionnaireVersionId/);
assert.match(mobile, /class PatientQuestionnaireStatusCard/);
assert.match(mobile, /patient-questionnaire-stale-reminder/);
assert.match(mobile, /patient-questionnaire-update/);
assert.match(mobile, /patient-questionnaire-no-changes/);
assert.match(mobile, /canConfirmNoChanges/);
assert.match(mobile, /expectedQuestionnaireVersionId/);
assert.match(main, /PatientQuestionnaireStatusCard/);

for (const locale of ["CarePointLocale.en","CarePointLocale.ar","CarePointLocale.fr","CarePointLocale.es"]) {
  assert.ok(mobile.includes(locale), `Missing PAT-107 locale ${locale}`);
}

console.log("PAT-107 questionnaire staleness reminder acceptance passed");

function read(relative) {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}
