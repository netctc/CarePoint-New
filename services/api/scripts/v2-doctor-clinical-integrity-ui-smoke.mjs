import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const clinicalModule = read("../src/modules/clinical/clinical.module.ts");
const clinicalService = read("../src/modules/clinical/clinical.service.ts");
const clinicalSignature = read("../src/modules/clinical/clinical-signature.service.ts");
const clinicalSignatureSchema = read("../prisma/v2_clinical_signature.prisma");
const clinicalSignatureMigration = read("../prisma/migrations/20260922184500_v2_clinical_signature/migration.sql");
const addenda = read("../src/modules/clinical/encounter-addenda.service.ts");
const followController = read("../src/modules/provider-follow-up/provider-follow-up.controller.ts");
const followService = read("../src/modules/provider-follow-up/provider-follow-up.service.ts");
const mobileRecord = read("../../../packages/mobile_core/lib/clinical_record.dart");
const mobileApi = read("../../../packages/mobile_core/lib/carepoint_api.dart");
const mobileFollow = read("../../../packages/mobile_core/lib/follow_up_recommendation.dart");
const mobileLocalization = read("../../../packages/mobile_core/lib/clinical_localization.dart");

// DOC-081 / BE-037 addendum: finalized encounter only, append-only create path, signed exact envelope.
assert.match(clinicalModule, /@Post\(":encounterId\/addenda"\)/);
assert.match(addenda, /appointment\.status !== "COMPLETED"/);
assert.match(addenda, /encounterAddendum\.create/);
assert.match(addenda, /signatureAlgorithm/);
assert.match(addenda, /payloadDigest/);
assert.match(addenda, /signedAt/);
assert.doesNotMatch(addenda, /encounterAddendum\.(?:update|delete|updateMany|deleteMany)\s*\(/);

// Doctor UI only offers addendum after finalized; original fields remain disabled.
assert.match(mobileRecord, /widget\.session\.role == 'DOCTOR' && finalized/);
assert.match(mobileRecord, /onPressed: saving \? null : _addAddendum/);
assert.match(mobileRecord, /enabled: !finalized/);
assert.match(mobileRecord, /createEncounterAddendum/);
assert.match(mobileApi, /\/provider\/encounters\/.*\/addenda/);
assert.match(mobileRecord, /encounter\?\['addenda'\]/);

// DOC-083 follow-up: existing backend remains a recommendation, not an automatic booking.
assert.match(followController, /provider\/follow-up-recommendations/);
assert.match(followService, /PROVIDER_FOLLOW_UP_RECOMMENDATION_CREATED/);
assert.match(mobileRecord, /ProviderFollowUpPage/);
assert.match(mobileFollow, /This is a recommendation only/);
assert.match(mobileFollow, /patient must book separately/i);
assert.doesNotMatch(mobileFollow, /\/bookings|book\(/);

// DOC-082 clinical signature: explicit Doctor + MFA, exact current revision, immutable evidence and shared encounter lock.
assert.match(clinicalModule, /@Post\(":encounterId\/sign"\)/);
assert.match(clinicalSignatureSchema, /model ClinicalSignature/);
assert.match(clinicalSignatureSchema, /@@unique\(\[encounterId, recordId\]\)/);
assert.match(clinicalSignatureMigration, /ClinicalSignature_append_only/);
assert.match(clinicalSignatureMigration, /BEFORE UPDATE OR DELETE ON "ClinicalSignature"/);
assert.match(clinicalSignatureMigration, /REVOKE UPDATE, DELETE ON "ClinicalSignature" FROM PUBLIC/);
assert.match(clinicalSignature, /principal\.role !== "DOCTOR"/);
assert.match(clinicalSignature, /isMfaAssuredSessionId\(principal\.sessionId\)/);
assert.match(clinicalSignature, /OrdersAttestationService/);
assert.match(clinicalSignature, /attestation\.attest\(material\)/);
assert.match(clinicalSignature, /recordId: record\.id/);
assert.match(clinicalSignature, /sessionId: principal\.sessionId/);
assert.match(clinicalSignature, /CLINICAL_ENCOUNTER_SIGNED/);
assert.match(clinicalSignature, /SELECT id FROM "Appointment" WHERE id = \$\{encounterId\} FOR UPDATE/);
assert.match(clinicalService, /SELECT id FROM "Appointment" WHERE id = \$\{appointment\.id\} FOR UPDATE/);
assert.match(clinicalService, /clinicalSignature\.findFirst/);
assert.match(clinicalService, /recordId: record\.id/);
assert.match(clinicalService, /Sign the current clinical record revision before finalizing/);
assert.match(mobileApi, /signClinicalEncounter/);
assert.match(mobileRecord, /if \(doctorSignature\) await api\.signClinicalEncounter\(appointmentId\);[\s\S]*encounter = await api\.finalizeClinicalEncounter\(appointmentId\);/);
assert.match(mobileLocalization, /signFinalizePrompt/);

await import("./v2-doctor-immunization-ui-smoke.mjs");
await import("./v2-doctor-procedure-ui-smoke.mjs");
console.log("V2 Doctor clinical integrity UI acceptance passed: DOC-067/DOC-068/DOC-081/DOC-082/DOC-083");

function read(relative) {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}
