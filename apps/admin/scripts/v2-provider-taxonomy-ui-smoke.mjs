import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = read("../app/providers/taxonomy/page.tsx");
const route = read("../app/api/admin/provider-taxonomy/[...segments]/route.ts");
const providers = read("../app/providers/page.tsx");
const providerModule = read("../../../services/api/src/modules/providers/providers.module.ts");
const formsModule = read("../../../services/api/src/modules/provider-category-forms/provider-category-forms.module.ts");
const formsService = read("../../../services/api/src/modules/provider-category-forms/provider-category-forms.service.ts");
const formEngine = read("../../../services/api/src/modules/provider-category-forms/provider-form.engine.ts");
const capabilityEngine = read("../../../services/api/src/modules/providers/provider-category-capabilities.ts");
const offline = read("../../../services/api/src/modules/provider-offline-sync/provider-offline-sync.service.ts");
const signature = read("../../../services/api/src/modules/service-signature/service-signature.service.ts");

assert.match(providers, /\/providers\/taxonomy/);
assert.match(page, /ADM-106 \/ ADM-107/);
assert.match(page, /clinicalOrderCapabilities/);
assert.match(page, /clinicalSummarySections/);
assert.match(page, /observationCodes/);
assert.match(page, /questionnaireCodes/);
assert.match(page, /workflowCapabilities/);
assert.match(page, /HOME_VISIT enables offline field-sync eligibility/);
assert.match(page, /SERVICE_COMPLETION_CHECKLIST governs service receipt\/signature/);
for (const capability of ["CATEGORY_FORMS","MEDIA_CAPTURE","TRANSPORT_EQUIPMENT_CHECKLIST","TRANSPORT_ACCEPT","TRANSPORT_REJECT"]) assert.match(page, new RegExp(capability));
for (const type of ["BOOLEAN","SINGLE_CHOICE","MULTI_CHOICE","NUMBER","TEXT","DATE"]) assert.match(page, new RegExp(type));
for (const purpose of ["GENERAL","HOME_VISIT","SERVICE_COMPLETION","PROCEDURE_CHECKLIST","TRANSPORT_EQUIPMENT"]) assert.match(page, new RegExp(purpose));
assert.match(page, /schemaVersion: 1/);
assert.doesNotMatch(page, /dangerouslySetInnerHTML/);

assert.match(route, /forwardAdminJson/);
assert.match(route, /requireSameOrigin: true/);
assert.match(route, /MAX_BODY_BYTES = 131072/);
assert.match(route, /\/other-provider-categories/);
assert.match(route, /\/admin\/provider-category-forms/);

assert.match(providerModule, /questionnaireCodes\?: string\[\]/);
assert.match(providerModule, /questionnaireCodes: input\.questionnaireCodes \?\? existing\.questionnaireCodes/);
assert.match(providerModule, /PROVIDER_CATEGORY_CAPABILITIES_UPDATED/);
assert.match(providerModule, /actorId: principal\.accountId/);
assert.match(providerModule, /Invalid questionnaire code/);
assert.match(capabilityEngine, /questionnaireCodes/);

assert.match(formsModule, /@Controller\("admin\/provider-category-forms"\)/);
assert.match(formsModule, /CATALOG_MANAGE/);
assert.match(formsService, /normalizeProviderFormSchema/);
assert.match(formsService, /status: "DRAFT"/);
assert.match(formsService, /Only a DRAFT form version can be activated/);
assert.match(formsService, /status: "RETIRED"/);
assert.match(formsService, /encryptRecord/);
assert.match(formEngine, /normalizeQuestionnaireSchema/);

assert.match(offline, /enabledModalities\.has\("HOME_VISIT"\)/);
assert.match(signature, /assertWorkflowCapability\(principal, "SERVICE_COMPLETION_CHECKLIST"\)/);

console.log("ADM-106/ADM-107 Admin provider taxonomy and capability matrix acceptance passed");

function read(relative) {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}
