import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  parseProviderCategoryCapabilities,
  providerCategoryCapabilitiesPayload,
} = require("../dist/modules/providers/provider-category-capabilities.js");

const parsed = parseProviderCategoryCapabilities({
  enabledModalities: ["HOME_VISIT", "HOME_VISIT"],
  clinicalOrderCapabilities: ["LABORATORY"],
  clinicalSummarySections: ["health_profile", "ALLERGIES", "INVALID"],
  observationCodes: ["heart_rate", "SpO2", "bad code"],
  workflowCapabilities: ["category_forms", "HOME_VISIT_ARRIVAL", "INVALID"],
});
assert.deepEqual(parsed.enabledModalities, ["HOME_VISIT"]);
assert.deepEqual(parsed.clinicalOrderCapabilities, ["LABORATORY"]);
assert.deepEqual(parsed.clinicalSummarySections, ["HEALTH_PROFILE", "ALLERGIES"]);
assert.deepEqual(parsed.observationCodes, ["HEART_RATE", "SPO2"]);
assert.deepEqual(parsed.workflowCapabilities, ["CATEGORY_FORMS", "HOME_VISIT_ARRIVAL"]);

const payload = providerCategoryCapabilitiesPayload({
  enabledModalities: ["CLINIC"],
  clinicalOrderCapabilities: [],
  clinicalSummarySections: ["CONDITIONS", "MEDICATIONS"],
  observationCodes: ["glucose"],
  workflowCapabilities: ["SERVICE_COMPLETION_CHECKLIST"],
});
assert.deepEqual(payload, {
  enabledModalities: ["CLINIC"],
  clinicalOrderCapabilities: [],
  clinicalSummarySections: ["CONDITIONS", "MEDICATIONS"],
  observationCodes: ["GLUCOSE"],
  workflowCapabilities: ["SERVICE_COMPLETION_CHECKLIST"],
});

console.log("V2 Other Provider capability matrix acceptance passed");
