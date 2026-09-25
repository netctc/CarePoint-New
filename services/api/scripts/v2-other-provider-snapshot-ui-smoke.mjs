import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const moduleSource=read("../src/modules/other-provider-workspace/other-provider-workspace.module.ts");
const service=read("../src/modules/other-provider-workspace/other-provider-workspace.service.ts");
const api=read("../../../packages/mobile_core/lib/carepoint_api.dart");
const workspace=read("../../../packages/mobile_core/lib/provider_workspace.dart");
const mobile=read("../../../packages/mobile_core/lib/other_provider_patient_snapshot.dart");

assert.match(moduleSource, /:patientId\/observation-trends/);
assert.match(moduleSource, /:patientId\/questionnaire-summary/);
assert.match(moduleSource, /OTHER_PROVIDER_CLINICAL_WORKSPACE/);
assert.match(moduleSource, /Cache-Control/);

assert.match(service, /context\.observationCodes/);
assert.match(service, /currentObservationConsent/);
assert.match(service, /buildObservationTrend/);
assert.match(service, /providerCategoryCapabilityEnforced: true/);
assert.match(service, /observationConsentEnforced: true/);
assert.match(service, /questionnaireCodes/);
assert.match(service, /QUESTIONNAIRE_READ/);
assert.match(service, /questionnaireConsentEnforced: true/);
assert.match(service, /rawAnswersIncluded: false/);
const summary=service.match(/async questionnaireSummary[\s\S]*?\n  private async clinicalSection/)?.[0]??"";
assert.ok(summary);
assert.doesNotMatch(summary,/answers\b|ciphertext|wrappedKey/);

assert.match(api, /otherProviderObservationTrends/);
assert.match(api, /otherProviderQuestionnaireSummary/);
assert.match(api, /capability-workspace\/\$patientId\/observation-trends/);
assert.match(api, /capability-workspace\/\$patientId\/questionnaire-summary/);

assert.match(workspace, /OtherProviderPatientSnapshotButton/);
assert.match(workspace, /widget\.session\.role == 'OTHER_PROVIDER'/);
assert.match(mobile, /class OtherProviderPatientSnapshotPage/);
assert.match(mobile, /contextType: 'APPOINTMENT'/);
assert.match(mobile, /DataTable/);
assert.match(mobile, /minimum/);
assert.match(mobile, /maximum/);
assert.match(mobile, /average/);
assert.match(mobile, /changedQuestionCount/);
assert.match(mobile, /rawAnswersIncluded/);
assert.doesNotMatch(mobile,/\b(normal|abnormal|critical|high risk|low risk)\b/i);
assert.doesNotMatch(mobile,/answers\b|ciphertext|wrappedKey/);
for(const locale of ["CarePointLocale.en","CarePointLocale.ar","CarePointLocale.fr","CarePointLocale.es"]){
  assert.ok(mobile.includes(locale),`Missing PRV-059/060 locale ${locale}`);
}

console.log("PRV-059/PRV-060 Other Provider scoped trends and questionnaire summary acceptance passed");

function read(relative){return readFileSync(new URL(relative,import.meta.url),"utf8");}
