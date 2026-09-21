import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  parseProviderCategoryCapabilities,
  providerCategoryCapabilitiesPayload,
} = require("../dist/modules/providers/provider-category-capabilities.js");
const { buildObservationTrend } = require("../dist/modules/observation/observation-trend.engine.js");

const parsed = parseProviderCategoryCapabilities({
  enabledModalities: ["HOME_VISIT", "HOME_VISIT"],
  clinicalOrderCapabilities: ["LABORATORY"],
  clinicalSummarySections: ["health_profile", "ALLERGIES", "INVALID"],
  observationCodes: ["heart_rate", "SpO2", "bad code"],
  questionnaireCodes: ["intake_general", "INTAKE_GENERAL", "bad code"],
  workflowCapabilities: ["category_forms", "HOME_VISIT_ARRIVAL", "INVALID"],
});
assert.deepEqual(parsed.enabledModalities, ["HOME_VISIT"]);
assert.deepEqual(parsed.clinicalOrderCapabilities, ["LABORATORY"]);
assert.deepEqual(parsed.clinicalSummarySections, ["HEALTH_PROFILE", "ALLERGIES"]);
assert.deepEqual(parsed.observationCodes, ["HEART_RATE", "SPO2"]);
assert.deepEqual(parsed.questionnaireCodes, ["INTAKE_GENERAL"]);
assert.deepEqual(parsed.workflowCapabilities, ["CATEGORY_FORMS", "HOME_VISIT_ARRIVAL"]);

const payload = providerCategoryCapabilitiesPayload({
  enabledModalities: ["CLINIC"],
  clinicalOrderCapabilities: [],
  clinicalSummarySections: ["CONDITIONS", "MEDICATIONS"],
  observationCodes: ["glucose"],
  questionnaireCodes: ["follow_up"],
  workflowCapabilities: ["SERVICE_COMPLETION_CHECKLIST"],
});
assert.deepEqual(payload, {
  enabledModalities: ["CLINIC"],
  clinicalOrderCapabilities: [],
  clinicalSummarySections: ["CONDITIONS", "MEDICATIONS"],
  observationCodes: ["GLUCOSE"],
  questionnaireCodes: ["FOLLOW_UP"],
  workflowCapabilities: ["SERVICE_COMPLETION_CHECKLIST"],
});

const trend = buildObservationTrend([
  {
    id: "obs-1",
    observedAt: "2026-09-20T08:00:00.000Z",
    value: 100,
    unitCode: "mg/dL",
    canonicalValue: 5.55,
    canonicalUnitCode: "mmol/L",
    sourceType: "MANUAL",
    sourceId: null,
    verificationStatus: "VERIFIED",
  },
  {
    id: "obs-2",
    observedAt: "2026-09-21T08:00:00.000Z",
    value: 110,
    unitCode: "mg/dL",
    canonicalValue: 6.11,
    canonicalUnitCode: "mmol/L",
    sourceType: "PROVIDER",
    sourceId: "provider-1",
    verificationStatus: "VERIFIED",
  },
]);
assert.equal(trend.state, "READY");
assert.equal(trend.series.length, 1);
assert.equal(trend.series[0].count, 2);
assert.equal(trend.automatedDiagnosis, false);

const workspaceSource = readFileSync(
  new URL("../src/modules/other-provider-workspace/other-provider-workspace.service.ts", import.meta.url),
  "utf8",
);
assert.match(workspaceSource, /OTHER_PROVIDER_OBSERVATION_TRENDS_READ/);
assert.match(workspaceSource, /OTHER_PROVIDER_QUESTIONNAIRE_SUMMARY_READ/);
assert.match(workspaceSource, /QUESTIONNAIRE_READ/);
assert.match(workspaceSource, /rawAnswersIncluded:\s*false/);
assert.doesNotMatch(workspaceSource, /decryptResponse\(/);

const consentPolicySource = readFileSync(
  new URL("../src/modules/clinical-governance/clinical-consent-policy.ts", import.meta.url),
  "utf8",
);
assert.match(
  consentPolicySource,
  /scopePattern:\s*"QUESTIONNAIRE_READ"[\s\S]*?eligibleRoles:\s*\["DOCTOR",\s*"OTHER_PROVIDER"\]/,
);

const mobileSource = readFileSync(
  new URL("../../../packages/mobile_core/lib/other_provider_insights.dart", import.meta.url),
  "utf8",
);
assert.match(mobileSource, /otherProviderObservationTrends/);
assert.match(mobileSource, /otherProviderQuestionnaireSummary/);
assert.match(mobileSource, /No automated diagnosis is produced/);

console.log("V2 Other Provider capability matrix and authorized insights acceptance passed");
