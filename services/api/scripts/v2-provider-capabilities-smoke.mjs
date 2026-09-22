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

const transportResourcesSource = readFileSync(
  new URL("../src/modules/transport/transport-resources.module.ts", import.meta.url),
  "utf8",
);
assert.match(transportResourcesSource, /@Get\(":id\/resources"\)/);
assert.match(transportResourcesSource, /@Patch\(":id\/resources"\)/);
assert.match(transportResourcesSource, /RequirePermissions\("TRANSPORT_RESPOND"\)/);
assert.match(transportResourcesSource, /assignedProviderId:\s*responder\.id/);
assert.match(transportResourcesSource, /active:\s*true/);
assert.match(transportResourcesSource, /unitCompatible/);
assert.match(transportResourcesSource, /missingCurrentCredentialTypes/);
assert.match(transportResourcesSource, /MEDICAL_TRANSPORT_RESOURCES_CHANGED/);
assert.match(transportResourcesSource, /TransactionIsolationLevel\.Serializable/);
assert.match(transportResourcesSource, /idempotencyKey/);
assert.match(transportResourcesSource, /crewProviderIds/);
assert.match(transportResourcesSource, /WHEELCHAIR/);
assert.match(transportResourcesSource, /STRETCHER/);

const transportResourceSchema = readFileSync(
  new URL("../prisma/v2_transport_resources.prisma", import.meta.url),
  "utf8",
);
assert.match(transportResourceSchema, /model TransportUnit/);
assert.match(transportResourceSchema, /model CrewAssignment/);
assert.match(transportResourceSchema, /crewProviderIds\s+String\[\]/);
assert.match(transportResourceSchema, /payloadHash/);
assert.match(transportResourceSchema, /idempotencyKey/);

const transportResourceMigration = readFileSync(
  new URL("../prisma/migrations/20260922003000_v2_transport_resources/migration.sql", import.meta.url),
  "utf8",
);
assert.match(transportResourceMigration, /TransportUnit_capabilities_ck/);
assert.match(transportResourceMigration, /CrewAssignment_immutable_trigger/);
assert.match(transportResourceMigration, /REVOKE UPDATE, DELETE ON "CrewAssignment"/);
assert.match(transportResourceMigration, /MedicalTransportRequest/);
assert.match(transportResourceMigration, /Provider/);

const transportApiSource = readFileSync(
  new URL("../../../packages/mobile_core/lib/transport_api.dart", import.meta.url),
  "utf8",
);
assert.match(transportApiSource, /providerMedicalTransportResources/);
assert.match(transportApiSource, /updateProviderMedicalTransportResources/);
assert.match(transportApiSource, /'PATCH', '\/provider\/medical-transport\/\$requestId\/resources'/);

const transportMobileSource = readFileSync(
  new URL("../../../packages/mobile_core/lib/transport_workspace.dart", import.meta.url),
  "utf8",
);
assert.match(transportMobileSource, /_TransportResourcesSheet/);
assert.match(transportMobileSource, /crewProviderIds:/);
assert.match(transportMobileSource, /transportUnitId:/);
assert.match(transportMobileSource, /selectedCrewIds\.isNotEmpty/);
assert.match(transportMobileSource, /resourcesLocked/);

const transportLocalizationSource = readFileSync(
  new URL("../../../packages/mobile_core/lib/transport_localization.dart", import.meta.url),
  "utf8",
);
assert.match(transportLocalizationSource, /'crewUnit': 'Crew & unit'/);
assert.match(transportLocalizationSource, /'crewUnit': 'الطاقم والمركبة'/);
assert.match(transportLocalizationSource, /'crewUnit': 'Équipe et véhicule'/);
assert.match(transportLocalizationSource, /'crewUnit': 'Tripulación y unidad'/);

console.log("V2 Other Provider capability matrix, authorized insights, and PRV-082 transport resources acceptance passed");
await import("./v2-transport-handoff-smoke.mjs");
await import("./v2-transport-incidents-smoke.mjs");
await import("./v2-provider-work-queue-smoke.mjs");
