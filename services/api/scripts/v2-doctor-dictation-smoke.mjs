import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const schema = read("../prisma/v2_dictation.prisma");
const migration = read("../prisma/migrations/20260925003000_v2_doctor_dictation/migration.sql");
const moduleSource = read("../src/modules/dictation/dictation.module.ts");
const service = read("../src/modules/dictation/dictation.service.ts");
const app = read("../src/app.module.ts");
const api = read("../../../packages/mobile_core/lib/carepoint_api.dart");
const mobile = read("../../../packages/mobile_core/lib/doctor_dictation.dart");
const record = read("../../../packages/mobile_core/lib/clinical_record.dart");
const pubspec = read("../../../packages/mobile_core/pubspec.yaml");

// DOC-088 stores encrypted recognized text only; audio never enters CarePoint persistence/API.
assert.match(schema, /model DictationJob/);
assert.match(schema, /algorithm\s+String/);
assert.match(schema, /wrappedKey\s+String/);
assert.match(schema, /ciphertext\s+String/);
assert.match(schema, /expiresAt\s+DateTime/);
assert.doesNotMatch(schema, /audio|recording|blob|objectKey/i);
assert.match(migration, /DictationJob_payload_immutable/);
assert.match(migration, /DRAFT/);
assert.match(migration, /CONFIRMED/);
assert.match(migration, /DISCARDED/);
assert.match(migration, /EXPIRED/);

// Server is Doctor-only, appointment-bound, short-lived, encrypted and never writes ClinicalRecord.
assert.match(moduleSource, /@Controller\("provider\/dictation\/jobs"\)/);
assert.match(moduleSource, /CLINICAL_RECORD_WRITE/);
assert.match(moduleSource, /@Post\(":jobId\/confirm"\)/);
assert.match(moduleSource, /@Post\(":jobId\/discard"\)/);
assert.match(service, /principal\.role !== "DOCTOR"/);
assert.match(service, /provider\.class !== "DOCTOR"/);
assert.match(service, /provider\.status !== "ACTIVE"/);
assert.match(service, /status: "CONFIRMED"/);
assert.match(service, /DRAFT_TTL_MINUTES = 30/);
assert.match(service, /deviceSpeechDisclosureAccepted !== true/);
assert.match(service, /ClinicalEnvelopeService/);
assert.match(service, /encryptRecord\(payload\)/);
assert.match(service, /reviewedByHuman: true/);
assert.match(service, /clinicalRecordWritten: false/);
assert.match(service, /requiresSeparateClinicalSave: true/);
assert.match(service, /automatedClinicalInference: false/);
assert.doesNotMatch(service, /clinicalRecord\.(?:create|update|updateMany)/);
assert.doesNotMatch(service, /writeRecord|finalizeEncounter|signClinicalEncounter/);
assert.match(app, /DictationModule/);

// Mobile requires device disclosure, review and server confirmation before local field mutation.
assert.match(pubspec, /speech_to_text:\s*7\.4\.0/);
assert.match(mobile, /SpeechToText/);
assert.match(mobile, /doctor-dictation-device-disclosure/);
assert.match(mobile, /doctor-dictation-secure-draft/);
assert.match(mobile, /doctor-dictation-confirm-apply/);
assert.match(mobile, /createDoctorDictationJob/);
assert.match(mobile, /confirmDoctorDictationJob/);
assert.match(mobile, /clinicalRecordWritten.*false/s);
assert.doesNotMatch(mobile, /writeClinicalRecord|finalizeClinicalEncounter|signClinicalEncounter/);
assert.match(record, /showDoctorDictationDialog/);
assert.match(record, /controller\.text = current\.isEmpty \? confirmed : '\$current\\n\$confirmed'/);
assert.match(record, /Future<void> save\(\)/);
assert.match(api, /\/provider\/dictation\/jobs/);

// Five clinical narrative fields are dictation-enabled; vitals are intentionally excluded.
for (const field of ["CHIEF_COMPLAINT", "SUBJECTIVE", "OBJECTIVE", "ASSESSMENT", "PLAN"]) {
  assert.match(record, new RegExp("dictationTarget: key"));
  assert.match(service, new RegExp(`\\["${field}"`));
}
assert.doesNotMatch(service, /\["VITALS"/);

for (const locale of ["CarePointLocale.en","CarePointLocale.ar","CarePointLocale.fr","CarePointLocale.es"]) {
  assert.ok(mobile.includes(locale), `Missing DOC-088 locale ${locale}`);
}

console.log("DOC-088 human-confirmed clinical dictation acceptance passed");

function read(relative) {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}
