import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const moduleSource = read("../src/modules/provider-category-forms/provider-category-forms.module.ts");
const service = read("../src/modules/provider-category-forms/provider-category-forms.service.ts");
const engine = read("../src/modules/provider-category-forms/provider-form.engine.ts");
const api = read("../../../packages/mobile_core/lib/carepoint_api.dart");
const mobile = read("../../../packages/mobile_core/lib/provider_category_forms.dart");
const providerMain = read("../../../apps/provider-mobile/lib/main.dart");

assert.match(moduleSource, /@Controller\("provider\/category-forms"\)/);
assert.match(moduleSource, /OTHER_PROVIDER_CATEGORY_FORMS/);
assert.match(moduleSource, /@Post\(":code\/responses"\)/);
assert.match(service, /assertWorkflowCapability\(principal, "CATEGORY_FORMS"\)/);
assert.match(service, /where: \{ categoryId: context\.categoryId, active: true \}/);
assert.match(service, /where: \{ status: "ACTIVE" \}/);
assert.match(service, /formVersionId: active\.id/);
assert.match(service, /formVersion: active\.version/);
assert.match(service, /sequence: currentSequence \+ 1/);
assert.match(service, /PROVIDER_CATEGORY_FORM_SUBMITTED/);
assert.match(service, /this\.envelope\.encryptRecord/);
assert.match(engine, /GENERAL/);
assert.match(engine, /HOME_VISIT/);
assert.match(engine, /SERVICE_COMPLETION/);
assert.match(engine, /PROCEDURE_CHECKLIST/);
assert.match(engine, /TRANSPORT_EQUIPMENT/);
assert.match(engine, /APPOINTMENT/);
assert.match(engine, /MEDICAL_TRANSPORT/);
assert.match(engine, /EMERGENCY_AMBULANCE/);

assert.match(api, /providerCategoryForms\(\)/);
assert.match(api, /submitProviderCategoryForm/);
assert.match(api, /\/provider\/category-forms/);
assert.match(mobile, /workflowCapabilities\.contains\('CATEGORY_FORMS'\)/);
assert.match(mobile, /class ProviderCategoryFormsPage/);
assert.match(mobile, /class ProviderCategoryFormResponsePage/);
assert.match(mobile, /providerMedicalTransportJobs/);
assert.match(mobile, /providerEmergencyAmbulanceJobs/);
assert.match(mobile, /expectedLatestSequence/);
assert.match(mobile, /currentSequence/);
assert.match(mobile, /create an explicit new immutable response/);
for (const type of ["BOOLEAN","SINGLE_CHOICE","MULTI_CHOICE","NUMBER","TEXT","DATE"]) {
  assert.match(mobile, new RegExp(type));
}
for (const locale of ["CarePointLocale.en","CarePointLocale.ar","CarePointLocale.fr","CarePointLocale.es"]) {
  assert.ok(mobile.includes(locale), `Missing provider form locale ${locale}`);
}
assert.match(providerMain, /ProviderCategoryFormsLauncher/);
assert.match(providerMain, /workflowCapabilities: workflowCapabilities/);

console.log("PRV-091 Provider Mobile configurable category forms acceptance passed");

function read(relative) {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}
