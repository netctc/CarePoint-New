import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const api = readFileSync(new URL("../../../packages/mobile_core/lib/carepoint_api.dart", import.meta.url), "utf8");
const record = readFileSync(new URL("../../../packages/mobile_core/lib/clinical_record.dart", import.meta.url), "utf8");
const ui = readFileSync(new URL("../../../packages/mobile_core/lib/doctor_procedures.dart", import.meta.url), "utf8");
const moduleSource = readFileSync(new URL("../src/modules/clinical-profile/clinical-profile.module.ts", import.meta.url), "utf8");
const service = readFileSync(new URL("../src/modules/clinical-profile/clinical-profile.service.ts", import.meta.url), "utf8");
const engine = readFileSync(new URL("../src/modules/clinical-profile/clinical-profile.engine.ts", import.meta.url), "utf8");

// DOC-067 reuses the governed clinical-profile PROCEDURE domain.
assert.match(engine, /ClinicalProfileEntryKind = "ALLERGY" \| "CONDITION" \| "PROCEDURE" \| "MEDICATION"/);
assert.match(engine, /kind: "PROCEDURE"; display: string; performedDate\?: string; facility\?: string/);
assert.match(engine, /rejectUnknown\(raw, \["display", "performedDate", "facility"\]\)/);
assert.match(service, /ClinicalEnvelopeService/);
assert.match(service, /clinicalProfileEntryRevision\.create/);
assert.match(service, /PROFILE_CONSENT_VERSION = "clinical-profile-v1"/);

// Doctor API remains treatment/consent bounded and versioned.
assert.match(moduleSource, /@Controller\("doctor\/patients"\)/);
assert.match(moduleSource, /@Get\(":patientId\/clinical-profile\/entries"\)/);
assert.match(moduleSource, /@Post\(":patientId\/clinical-profile\/entries"\)/);
assert.match(moduleSource, /@Patch\(":patientId\/clinical-profile\/entries\/:entryId"\)/);
assert.match(moduleSource, /RequirePermissions\("CLINICAL_PROFILE_READ"\)/);
assert.match(moduleSource, /RequirePermissions\("CLINICAL_PROFILE_WRITE"\)/);
assert.match(api, /doctorPatientProcedures/);
assert.match(api, /createDoctorPatientProcedure/);
assert.match(api, /updateDoctorPatientProcedure/);
assert.match(api, /'kind': 'PROCEDURE'/);
assert.match(api, /'expectedVersion': expectedVersion/);

// Doctor Mobile provides longitudinal list + create/edit with provenance and conflict reload.
assert.match(record, /doctor-procedure-history-entry/);
assert.match(record, /DoctorProceduresPage/);
assert.match(ui, /expectedVersion:/);
assert.match(ui, /performedDate:/);
assert.match(ui, /facility:/);
assert.match(ui, /provenance/);
assert.match(ui, /verificationStatus/);
assert.match(ui, /statusCode == 409/);
assert.doesNotMatch(api, /deleteDoctorPatientProcedure/);
assert.doesNotMatch(moduleSource, /@Delete\(/);

for (const locale of ["CarePointLocale.en", "CarePointLocale.ar", "CarePointLocale.fr", "CarePointLocale.es"]) {
  assert.ok(ui.includes(locale), `Missing Doctor procedure locale ${locale}`);
}
assert.match(record, /Directionality[\s\S]*textDirection: locale\.textDirection/);

console.log("DOC-067 Doctor Mobile procedure history acceptance passed");
