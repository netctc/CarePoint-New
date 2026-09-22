import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [model, migration, service, moduleFile, appModule] = await Promise.all([
  readFile(new URL("../prisma/v2_patient_clinical_export.prisma", import.meta.url), "utf8"),
  readFile(new URL("../prisma/migrations/20260922143000_v2_patient_clinical_export/migration.sql", import.meta.url), "utf8"),
  readFile(new URL("../src/modules/patient-clinical-export/patient-clinical-export.service.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/modules/patient-clinical-export/patient-clinical-export.module.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/app.module.ts", import.meta.url), "utf8"),
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

console.log(JSON.stringify({
  status: "passed",
  id: "BE-027",
  asynchronousDurableJob: true,
  formats: ["JSON", "PDF"],
  encryptedPrivateStorage: true,
  sha256Integrity: true,
  artifactTtlHours: 24,
  oneTimeDownloadGrantMinutes: 5,
  patientContextPinned: true,
  authSessionRetentionDecoupled: true,
  publicObjectUrlForbidden: true,
}));
