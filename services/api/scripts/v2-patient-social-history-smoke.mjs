import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const moduleSource = read("../src/modules/questionnaire/questionnaire.module.ts");
const service = read("../src/modules/questionnaire/questionnaire.service.ts");
const engine = read("../src/modules/questionnaire/questionnaire.engine.ts");
const questionnaireModel = read("../prisma/v2_questionnaire.prisma");
const api = read("../../../packages/mobile_core/lib/carepoint_api.dart");
const ui = read("../../../packages/mobile_core/lib/patient_social_history.dart");
const main = read("../../../apps/patient-mobile/lib/main.dart");

// PAT-095 is a governed view over the existing Questionnaire domain, not a parallel PHI table.
assert.match(moduleSource, /@Controller\("patient\/social-history"\)/);
assert.match(moduleSource, /@Get\(\)/);
assert.match(moduleSource, /@Patch\(\)/);
assert.match(moduleSource, /PATIENT_MANAGE_QUESTIONNAIRE/);
assert.match(moduleSource, /Cache-Control/);
assert.doesNotMatch(questionnaireModel, /model SocialHistory/);

assert.match(service, /questionnaire: \{ code: "SOCIAL_HISTORY", active: true \}/);
assert.match(service, /policySource: "ACTIVE_SOCIAL_HISTORY_QUESTIONNAIRE"/);
assert.match(service, /questionnaireResponse\.findFirst/);
assert.match(service, /decryptResponse\(latest\)/);
assert.match(service, /submitMine\(principal, "SOCIAL_HISTORY", input\)/);
assert.match(service, /SOCIAL_HISTORY_UPDATED/);
assert.match(service, /changedFields: response\.changedQuestionIds/);

// Existing Questionnaire engine remains the only validator/encryption/versioning path.
for (const type of ["BOOLEAN","SINGLE_CHOICE","MULTI_CHOICE","NUMBER","TEXT","DATE"]) {
  assert.match(engine, new RegExp(type));
}
assert.match(service, /encryptRecord\(payload\)/);
assert.match(service, /previousResponseId/);
assert.match(service, /expectedQuestionnaireVersionId/);
assert.match(service, /QUESTIONNAIRE_SCOPE/);
assert.match(service, /QUESTIONNAIRE_CONSENT_VERSION/);
assert.match(service, /latestForDoctor/);

// Patient Mobile is schema-driven and pins the exact active version on write.
assert.match(api, /patientSocialHistory\(\)/);
assert.match(api, /updatePatientSocialHistory/);
assert.match(ui, /model\['schema'\]/);
assert.match(ui, /question\['type'\]/);
assert.match(ui, /expectedLatestSequence/);
assert.match(ui, /expectedQuestionnaireVersionId/);
assert.match(ui, /questionnaireVersionId/);
assert.match(ui, /Only questions enabled by the active Admin policy are shown/);
assert.doesNotMatch(ui, /id:\s*['"]tobacco|id:\s*['"]alcohol|id:\s*['"]activity/);
assert.match(main, /patient-social-history-entry/);

for (const locale of ["CarePointLocale.en","CarePointLocale.ar","CarePointLocale.fr","CarePointLocale.es"]) {
  assert.ok(ui.includes(locale), `Missing social-history locale ${locale}`);
}

console.log("PAT-095 policy-driven Social History acceptance passed");

function read(relative) {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}
