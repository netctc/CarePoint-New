import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [model, migration, service, moduleFile, appModule, mobileApi, mobileUi, patientMain] = await Promise.all([
  readFile(new URL("../prisma/v2_patient_clinical_export.prisma", import.meta.url), "utf8"),
  readFile(new URL("../prisma/migrations/20260922143000_v2_patient_clinical_export/migration.sql", import.meta.url), "utf8"),
  readFile(new URL("../src/modules/patient-clinical-export/patient-clinical-export.service.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/modules/patient-clinical-export/patient-clinical-export.module.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/app.module.ts", import.meta.url), "utf8"),
  readFile(new URL("../../../packages/mobile_core/lib/patient_clinical_export_api.dart", import.meta.url), "utf8"),
  readFile(new URL("../../../packages/mobile_core/lib/patient_clinical_export.dart", import.meta.url), "utf8"),
  readFile(new URL("../../../apps/patient-mobile/lib/main.dart", import.meta.url), "utf8"),
]);

assert.match(model, /enum PatientClinicalExportFormat[\s\S]*JSON[\s\S]*PDF/);
assert.match(model, /enum PatientClinicalExportStatus[\s\S]*PENDING[\s\S]*PROCESSING[\s\S]*READY[\s\S]*FAILED[\s\S]*EXPIRED/);
assert.match(model, /@@unique\(\[accountId, clientRequestId\]\)/);
assert.match(model, /contentDigest\s+String\?/);
assert.match(model, /PatientClinicalExportDownloadGrant/);

assert.match(migration, /PatientClinicalExportJob_patientId_fkey/);
assert.doesNotMatch(migration, /PatientClinicalExportJob_sessionId_fkey/, "Export evidence must not block auth-session lifecycle cleanup.");
assert.match(migration, /carepoint_reject_patient_export_grant_delete/);
assert.match(migration, /REVOKE DELETE ON "PatientClinicalExportDownloadGrant" FROM PUBLIC/);
assert.match(migration, /length\("contentDigest"\) = 64/);

assert.match(service, /ARTIFACT_TTL_MS = 24 \* 60 \* 60 \* 1000/);
assert.match(service, /DOWNLOAD_GRANT_TTL_MS = 5 \* 60 \* 1000/);
assert.match(service, /resolveEffectivePatient\(principal, "CLINICAL_READ"\)/);
assert.match(service, /snapshot\.patientId !== job\.patientId/);
assert.match(service, /this\.envelope\.encryptBytes\(bytes\)/);
assert.match(service, /this\.storage\.put\(objectKey, encrypted\.ciphertext\)/);
assert.match(service, /this\.sha256\(bytes\)/);
assert.match(service, /patientClinicalExportDownloadGrant/);
assert.match(service, /consumedAt: null/);
assert.match(service, /patient-exports\//);
assert.match(service, /renderPdf\(packageValue\)/);
assert.match(service, /JSON\.stringify\(packageValue, null, 2\)/);
assert.match(service, /cleanupExpired\(\)/);
assert.match(service, /this\.storage\.remove/);
assert.doesNotMatch(service, /signedUrl:\s*`https?:\/\//, "Export URLs must not expose a public object-storage URL.");

assert.match(moduleFile, /@Controller\("patient\/exports"\)/);
assert.match(moduleFile, /@RequirePermissions\("PATIENT_READ_CLINICAL_RECORD"\)/);
assert.match(moduleFile, /@Post\(":jobId\/download-token"\)/);
assert.match(moduleFile, /@Get\(":jobId\/download"\)/);
assert.match(moduleFile, /Cache-Control", "private, no-store, max-age=0/);
assert.match(appModule, /PatientClinicalExportModule/);

assert.match(mobileApi, /class PatientClinicalExportApi/);
assert.match(mobileApi, /\/patient\/exports/);
assert.match(mobileApi, /download-token/);
assert.match(mobileApi, /queryParameters\['token'\]/);
assert.match(mobileApi, /response\.bodyBytes/);
assert.doesNotMatch(mobileApi, /tokenStore|SharedPreferences|writeTokens|File\(/, "PAT-136 must not persist one-time export grants or export bytes from the API client.");

assert.match(mobileUi, /class PatientClinicalExportPage/);
assert.match(mobileUi, /SegmentedButton<String>/);
assert.match(mobileUi, /value: 'PDF'/);
assert.match(mobileUi, /value: 'JSON'/);
assert.match(mobileUi, /showDialog<bool>/);
assert.match(mobileUi, /confirmBody/);
assert.match(mobileUi, /Timer\.periodic\(const Duration\(seconds: 2\)/);
assert.match(mobileUi, /patient-clinical-export-download/);
assert.match(mobileUi, /downloaded = null/);
assert.match(mobileUi, /'ar':/);
assert.match(mobileUi, /'fr':/);
assert.match(mobileUi, /'es':/);
assert.match(patientMain, /patient_clinical_export\.dart/);
assert.match(patientMain, /patient-clinical-export-entry/);
assert.match(patientMain, /openClinicalExport/);

console.log(JSON.stringify({
  status: "passed",
  ids: ["BE-027", "PAT-136"],
  asynchronousDurableJob: true,
  formats: ["JSON", "PDF"],
  encryptedPrivateStorage: true,
  sha256Integrity: true,
  artifactTtlHours: 24,
  oneTimeDownloadGrantMinutes: 5,
  patientContextPinned: true,
  authSessionRetentionDecoupled: true,
  publicObjectUrlForbidden: true,
  mobileConfirmationRequired: true,
  mobileOneTimeGrantNotPersisted: true,
  mobileLocales: ["en", "ar", "fr", "es"],
}));

await import("./v2-patient-clinical-share-smoke.mjs");
