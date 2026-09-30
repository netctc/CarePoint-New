import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const api = readFileSync(new URL("../../../packages/mobile_core/lib/carepoint_api.dart", import.meta.url), "utf8");
const record = readFileSync(new URL("../../../packages/mobile_core/lib/clinical_record.dart", import.meta.url), "utf8");
const ui = readFileSync(new URL("../../../packages/mobile_core/lib/doctor_immunizations.dart", import.meta.url), "utf8");
const moduleSource = readFileSync(new URL("../src/modules/clinical-history/clinical-history.module.ts", import.meta.url), "utf8");

// DOC-068 reuses the governed BE-006 clinical-history surface.
assert.match(api, /doctorPatientImmunizations/);
assert.match(api, /createDoctorPatientImmunization/);
assert.match(api, /updateDoctorPatientImmunization/);
assert.match(api, /\/doctor\/patients\/\$patientId\/clinical-history\/immunizations/);
assert.match(moduleSource, /@Controller\("doctor\/patients\/:patientId\/clinical-history"\)/);
assert.match(moduleSource, /RequirePermissions\("CLINICAL_PROFILE_READ"\)/);
assert.match(moduleSource, /RequirePermissions\("CLINICAL_PROFILE_WRITE"\)/);

// Doctor Mobile exposes longitudinal list + create/edit with provenance and version conflict handling.
assert.match(record, /doctor-immunization-history-entry/);
assert.match(record, /DoctorImmunizationsPage/);
assert.match(ui, /expectedVersion:/);
assert.match(ui, /idempotencyKey:/);
assert.match(ui, /vaccineDisplay:/);
assert.match(ui, /doseNumber:/);
assert.match(ui, /lotNumber:/);
assert.match(ui, /manufacturer:/);
assert.match(ui, /route:/);
assert.match(ui, /site:/);
assert.match(ui, /source/);
assert.match(ui, /statusCode == 409/);

// Four product locales and inherited RTL remain available.
for (const locale of ["CarePointLocale.en", "CarePointLocale.ar", "CarePointLocale.fr", "CarePointLocale.es"]) {
  assert.ok(ui.includes(locale), `Missing Doctor immunization locale ${locale}`);
}
assert.match(record, /Directionality[\s\S]*textDirection: locale\.textDirection/);

// No delete path is added; immutable/versioned server history remains authoritative.
assert.doesNotMatch(api, /deleteDoctorPatientImmunization/);
assert.doesNotMatch(moduleSource, /@Delete\(/);

await import("./v2-clinical-history-smoke.mjs");
console.log("DOC-068 Doctor Mobile immunization history acceptance passed");
