import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const model = read("../prisma/v2_patient_clinical_share.prisma");
const migration = read("../prisma/migrations/20260924031500_v2_patient_clinical_shares/migration.sql");
const service = read("../src/modules/patient-clinical-export/patient-clinical-share.service.ts");
const moduleSource = read("../src/modules/patient-clinical-export/patient-clinical-export.module.ts");
const mobileApi = read("../../../packages/mobile_core/lib/patient_clinical_export_api.dart");
const mobileUi = read("../../../packages/mobile_core/lib/patient_clinical_share.dart");
const qr = read("../../../packages/mobile_core/lib/secure_share_qr.dart");
const qrTest = read("../../../packages/mobile_core/test/secure_share_qr_test.dart");
const patientMain = read("../../../apps/patient-mobile/lib/main.dart");

// PAT-137: one closed scope, hashed bearer token, encrypted snapshot, bounded TTL and revocation.
assert.match(model, /enum PatientClinicalShareScope[\s\S]*OBSERVATIONS[\s\S]*MEDICATIONS[\s\S]*DEVICES[\s\S]*QUESTIONNAIRE[\s\S]*CARE_PLAN/);
assert.match(model, /tokenHash\s+String\s+@unique/);
assert.match(model, /ciphertext\s+String/);
assert.match(model, /contentDigest\s+String/);
assert.match(model, /revokedAt\s+DateTime\?/);
assert.match(model, /accessCount\s+Int/);
assert.doesNotMatch(model, /rawToken|shareUrl|bearerToken/);
assert.match(migration, /length\("tokenHash"\) = 64/);
assert.match(migration, /length\("contentDigest"\) = 64/);
assert.match(migration, /expiresAt.*createdAt/);
assert.match(migration, /REVOKE SELECT \("tokenHash", "ciphertext", "wrappedKey", "iv"\)/);

assert.match(service, /randomBytes\(32\)\.toString\("base64url"\)/);
assert.match(service, /const tokenHash = this\.sha256\(rawToken\)/);
assert.match(service, /encryptBytes\(bytes\)/);
assert.match(service, /decryptBytes\(this\.asEnvelope\(row\)\)/);
assert.match(service, /this\.sha256\(bytes\) !== row\.contentDigest/);
assert.match(service, /MIN_TTL_MINUTES = 5/);
assert.match(service, /MAX_TTL_MINUTES = 60/);
assert.match(service, /resolveEffectivePatient\(principal, "CLINICAL_READ"\)/);
assert.match(service, /effectiveRelation\(row\.accountId, row\.patientId, "CLINICAL_READ"\)/);
assert.match(service, /relation\.id === row\.relationId/);
assert.match(service, /patientId: row\.patientId, userId: row\.accountId/);
assert.match(service, /PATIENT_CLINICAL_SHARE_CREATED/);
assert.match(service, /PATIENT_CLINICAL_SHARE_REVOKED/);
assert.match(service, /PATIENT_CLINICAL_SHARE_ACCESSED/);
assert.match(service, /viewerAuthenticated: false/);
assert.match(service, /tokenPersisted: false/);
assert.doesNotMatch(service, /tokenHash[^\n]*return|rawToken[^\n]*data:/);

// Public endpoint is explicitly public only because the high-entropy bearer token is its authorization.
assert.match(moduleSource, /@Public\(\)[\s\S]*@Controller\("s"\)/);
assert.match(moduleSource, /@Get\(":token"\)/);
assert.match(moduleSource, /Referrer-Policy", "no-referrer"/);
assert.match(moduleSource, /X-Content-Type-Options", "nosniff"/);
assert.match(moduleSource, /Cache-Control", "no-store, max-age=0"/);
assert.match(moduleSource, /@Controller\("patient\/clinical-shares"\)/);
assert.match(moduleSource, /@Post\("temporary-link"\)/);
assert.match(moduleSource, /@Post\(":shareId\/revoke"\)/);
assert.match(moduleSource, /PATIENT_READ_CLINICAL_RECORD/);

// Public projection strips internal resource identifiers and allows exactly one selected summary section.
assert.match(service, /case "OBSERVATIONS"/);
assert.match(service, /case "MEDICATIONS"/);
assert.match(service, /case "DEVICES"/);
assert.match(service, /case "QUESTIONNAIRE"/);
assert.match(service, /case "CARE_PLAN"/);
const projection = service.match(/private project\([\s\S]*?\n  private scope/)?.[0] ?? "";
assert.doesNotMatch(projection, /id:\s*item\.id|sourceId|questionnaireId|carePlanId/);

// Mobile shows link + locally rendered QR, explicit warning, copy, clear and revoke.
assert.match(mobileApi, /createTemporaryShare/);
assert.match(mobileApi, /revokeTemporaryShare/);
assert.match(mobileApi, /'shareUrl': '\$\{api\.baseUrl\}\$relativePath'/);
assert.match(mobileUi, /class PatientTemporaryClinicalSharePage/);
assert.match(mobileUi, /CarePointSecureShareQr\(data: url\)/);
assert.match(mobileUi, /Clipboard\.setData/);
assert.match(mobileUi, /patient-clinical-share-revoke-/);
assert.match(mobileUi, /activeShare = null/);
assert.match(mobileUi, /showDialog<bool>/);
assert.match(mobileUi, /Anyone holding the link or QR/);
assert.match(patientMain, /patient-temporary-clinical-share-entry/);
assert.match(patientMain, /openTemporaryClinicalShare/);

// QR generation is local and dependency-free: no third party ever receives the bearer URL.
assert.match(qr, /class CarePointQrCode/);
assert.match(qr, /version = 10/);
assert.match(qr, /_dataCodewords = 274/);
assert.match(qr, /_eccPerBlock = 18/);
assert.match(qr, /_reedSolomonRemainder/);
assert.match(qr, /mask 0/);
assert.doesNotMatch(qr, /https?:\/\/|qrserver|googleapis|chart\.google/);
assert.match(qrTest, /expect\(black, 1636\)/);
assert.match(qrTest, /272.*throwsArgumentError/);

// Four product locales + RTL shell are retained.
for (const locale of ["CarePointLocale.en", "CarePointLocale.ar", "CarePointLocale.fr", "CarePointLocale.es"]) {
  assert.ok(mobileUi.includes(locale), `Missing PAT-137 locale ${locale}`);
}
assert.match(mobileUi, /textDirection: widget\.locale\.textDirection/);

console.log("PAT-137 temporary secure clinical link + local QR acceptance passed");

function read(relative) {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}
