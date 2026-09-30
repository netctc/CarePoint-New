import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const service = read("../src/modules/observation/provider-observation.service.ts");
const moduleSource = read("../src/modules/observation/observation.module.ts");
const capabilityScope = read("../../../apps/provider-mobile/lib/provider_capability_scope.dart");
const providerMain = read("../../../apps/provider-mobile/lib/main.dart");
const nursing = read("../../../apps/provider-mobile/lib/nursing_entry.dart");
const api = read("../../../packages/mobile_core/lib/carepoint_api.dart");

// PRV-061 reuses the canonical Observation domain; no parallel metric tables/endpoints.
assert.match(moduleSource, /@Controller\("provider\/observations"\)/);
assert.match(moduleSource, /@Get\("catalog"\)/);
assert.match(moduleSource, /@Post\(":patientId\/observations"\)/);
assert.match(moduleSource, /ProvidersModule/);
assert.match(service, /ProviderCategoryCapabilityService/);
assert.match(service, /principal\.role === "OTHER_PROVIDER"/);
assert.match(service, /context\.observationCodes\.has\(code\)/);
assert.match(service, /Other Provider category is not authorized for observation/);
assert.match(service, /observationType: \{[\s\S]*code: \{ in: \[\.\.\.scope\] \}/);
assert.match(service, /assertCanonicalRange/);
assert.match(service, /allowed\.includes\(originalUnitCode\)/);
assert.match(service, /encryptRecord\(payload\)/);
assert.match(service, /automatedDiagnosis: false/);
assert.match(service, /currentTreatmentRelationship/);
assert.match(service, /assertProviderEncounterBinding/);

// Mobile capability propagation is explicit and the server catalog remains authoritative.
assert.match(capabilityScope, /Set<String> observationCodes/);
assert.match(capabilityScope, /capabilities\['observationCodes'\]/);
assert.match(providerMain, /observationCodes: observationCodes/);
assert.match(nursing, /class ProviderObservationPanelPage/);
assert.match(nursing, /widget\.allowedCodes\.contains\(item\['code'\]/);
assert.match(nursing, /providerObservationCatalog/);
assert.match(nursing, /recordProviderObservation/);
assert.match(nursing, /encounterId: encounterId/);
assert.match(api, /GET', '\/provider\/observations\/catalog/);
assert.match(api, /POST', '\/provider\/patients\/\$patientId\/observations/);

// Four product locales + no hard-coded clinical interpretation.
for (const locale of ["CarePointLocale.en", "CarePointLocale.ar", "CarePointLocale.fr", "CarePointLocale.es"]) {
  assert.ok(nursing.includes(locale), `Missing PRV-061 locale ${locale}`);
}
const panelSource = nursing.match(/class ProviderObservationPanelPage[\s\S]*?class MedicationAdministrationPage/)?.[0] ?? "";
assert.ok(panelSource, "PRV-061 observation panel source was not found.");
assert.match(panelSource, /no automated diagnosis/i);
assert.doesNotMatch(panelSource, /\b(normal|abnormal|critical|high risk|low risk)\b/i);
assert.doesNotMatch(panelSource, /(?:>|<|>=|<=)\s*\d+(?:\.\d+)?/);

console.log("PRV-061 capability-bound Other Provider observation panel acceptance passed");

function read(relative) {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}
await import("./v2-other-provider-snapshot-ui-smoke.mjs");
