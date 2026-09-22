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
  workflowCapabilities: ["category_forms", "HOME_VISIT_ARRIVAL", "MEDIA_CAPTURE", "INVALID"],
});
assert.deepEqual(parsed.enabledModalities, ["HOME_VISIT"]);
assert.deepEqual(parsed.clinicalOrderCapabilities, ["LABORATORY"]);
assert.deepEqual(parsed.clinicalSummarySections, ["HEALTH_PROFILE", "ALLERGIES"]);
assert.deepEqual(parsed.observationCodes, ["HEART_RATE", "SPO2"]);
assert.deepEqual(parsed.questionnaireCodes, ["INTAKE_GENERAL"]);
assert.deepEqual(parsed.workflowCapabilities, ["CATEGORY_FORMS", "HOME_VISIT_ARRIVAL", "MEDIA_CAPTURE"]);

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

const fieldMediaSource = readFileSync(
  new URL("../src/modules/provider-field-media/provider-field-media.module.ts", import.meta.url),
  "utf8",
);
assert.match(fieldMediaSource, /MEDIA_CAPTURE/);
assert.match(fieldMediaSource, /modality:\s*"HOME_VISIT"/);
assert.match(fieldMediaSource, /CLINICAL_MEDIA_GOVERNED_RETENTION/);
assert.match(fieldMediaSource, /CLINICAL_MEDIA_CAPTURE/);
assert.match(fieldMediaSource, /clinical-media-v1/);
assert.match(fieldMediaSource, /findEffectiveCaptureConsent/);
assert.match(fieldMediaSource, /patientMustGrantConsent:\s*!consent/);
assert.match(fieldMediaSource, /@Get\("consent"\)/);
assert.match(fieldMediaSource, /contentDigest/);
assert.match(fieldMediaSource, /authorActorId/);
assert.match(fieldMediaSource, /capturedAt/);
assert.match(fieldMediaSource, /consentEvidence/);
assert.match(fieldMediaSource, /encryptedAtRest:\s*true/);
assert.match(fieldMediaSource, /image\/jpeg/);
assert.match(fieldMediaSource, /image\/png/);
assert.doesNotMatch(fieldMediaSource, /video\/mp4/);
assert.doesNotMatch(fieldMediaSource, /requiredId\(input\.consentId/);

const clinicalMediaSource = readFileSync(
  new URL("../src/modules/documents/clinical-media.service.ts", import.meta.url),
  "utf8",
);
assert.match(clinicalMediaSource, /CLINICAL_MEDIA_CAPTURE/);
assert.match(clinicalMediaSource, /clinical-media-v1/);
assert.match(clinicalMediaSource, /encryptBytes/);
assert.match(clinicalMediaSource, /contentDigest/);

const fieldMediaMigration = readFileSync(
  new URL("../prisma/migrations/20260921234500_v2_provider_field_media/migration.sql", import.meta.url),
  "utf8",
);
assert.match(fieldMediaMigration, /ProviderFieldMediaEvidence_append_only_trg/);
assert.match(fieldMediaMigration, /BEFORE UPDATE OR DELETE/);
assert.match(fieldMediaMigration, /REVOKE UPDATE, DELETE/);
assert.match(fieldMediaMigration, /ClinicalMedia/);
assert.match(fieldMediaMigration, /Appointment/);
assert.match(fieldMediaMigration, /retentionPolicyCode/);
assert.match(fieldMediaMigration, /contentDigest/);

const fieldMediaMobileSource = readFileSync(
  new URL("../../../apps/provider-mobile/lib/field_media_entry.dart", import.meta.url),
  "utf8",
);
assert.match(fieldMediaMobileSource, /workflowCapabilities\.contains\('MEDIA_CAPTURE'\)/);
assert.match(fieldMediaMobileSource, /CarePointPhotoSource\.camera/);
assert.match(fieldMediaMobileSource, /CarePointPhotoSource\.gallery/);
assert.match(fieldMediaMobileSource, /pickCarePointPhoto/);
assert.match(fieldMediaMobileSource, /captureAllowed/);
assert.match(fieldMediaMobileSource, /CLINICAL_MEDIA_CAPTURE/);
assert.match(fieldMediaMobileSource, /clinical-media-v1/);
assert.match(fieldMediaMobileSource, /base64Encode/);
assert.match(fieldMediaMobileSource, /8 \* 1024 \* 1024/);
assert.doesNotMatch(fieldMediaMobileSource, /package:image_picker/);

const photoPickerSource = readFileSync(
  new URL("../../../packages/mobile_core/lib/carepoint_photo_picker.dart", import.meta.url),
  "utf8",
);
assert.match(photoPickerSource, /enum CarePointPhotoSource \{ camera, gallery \}/);
assert.match(photoPickerSource, /carepoint_photo_picker_native\.dart/);
assert.match(photoPickerSource, /carepoint_photo_picker_web\.dart/);

const androidPickerSource = readFileSync(
  new URL("../../../packages/mobile_core/android/src/main/kotlin/com/carepoint/mobile_core/CarePointMobileCorePlugin.kt", import.meta.url),
  "utf8",
);
assert.match(androidPickerSource, /MediaStore\.ACTION_IMAGE_CAPTURE/);
assert.match(androidPickerSource, /Intent\.ACTION_OPEN_DOCUMENT/);
assert.match(androidPickerSource, /carepoint\/mobile\/photo_picker/);

const iosPickerSource = readFileSync(
  new URL("../../../packages/mobile_core/ios/Classes/CarePointMobileCorePlugin.swift", import.meta.url),
  "utf8",
);
assert.match(iosPickerSource, /UIImagePickerController/);
assert.match(iosPickerSource, /sourceType = \.camera/);
assert.match(iosPickerSource, /sourceType = \.photoLibrary/);
assert.match(iosPickerSource, /carepoint\/mobile\/photo_picker/);

const providerPubspecSource = readFileSync(
  new URL("../../../apps/provider-mobile/pubspec.yaml", import.meta.url),
  "utf8",
);
assert.doesNotMatch(providerPubspecSource, /image_picker/);

const fieldMediaApiSource = readFileSync(
  new URL("../../../packages/mobile_core/lib/provider_field_media.dart", import.meta.url),
  "utf8",
);
assert.match(fieldMediaApiSource, /\/media\/consent/);
assert.match(fieldMediaApiSource, /idempotencyKey/);
assert.match(fieldMediaApiSource, /capturedAt/);
assert.doesNotMatch(fieldMediaApiSource, /'consentId'/);

const providerMainSource = readFileSync(
  new URL("../../../apps/provider-mobile/lib/main.dart", import.meta.url),
  "utf8",
);
assert.match(providerMainSource, /ProviderFieldMediaLauncher/);
assert.match(providerMainSource, /workflowCapabilities:\s*workflowCapabilities/);

console.log("V2 Other Provider capability matrix, authorized insights, and PRV-076 field media acceptance passed");
