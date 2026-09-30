import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const schema = read("../prisma/v2_emergency_health_card.prisma");
const migration = read("../prisma/migrations/20260923013000_v2_emergency_health_card/migration.sql");
const moduleSource = read("../src/modules/patient-emergency-card/patient-emergency-card.module.ts");
const app = read("../src/app.module.ts");
const api = read("../../../packages/mobile_core/lib/carepoint_api.dart");
const ui = read("../../../packages/mobile_core/lib/patient_emergency_card.dart");
const main = read("../../../apps/patient-mobile/lib/main.dart");

assert.match(schema, /model EmergencyHealthCardPreference/);
assert.match(schema, /includeSevereAllergies\s+Boolean\s+@default\(false\)/);
assert.match(schema, /includeActiveMedications\s+Boolean\s+@default\(false\)/);
assert.match(schema, /includeActiveConditions\s+Boolean\s+@default\(false\)/);
assert.match(migration, /DEFAULT false/);
assert.doesNotMatch(migration, /DROP TABLE|DROP COLUMN/);

assert.match(moduleSource, /@Controller\("patient\/emergency-card"\)/);
assert.match(moduleSource, /PATIENT_READ_CLINICAL_RECORD/);
assert.match(moduleSource, /PATIENT_MANAGE_CLINICAL_PROFILE/);
assert.match(moduleSource, /principal\.role !== "PATIENT"/);
assert.match(moduleSource, /severity === "SEVERE"/);
assert.match(moduleSource, /medicationStatus === "ACTIVE"/);
assert.match(moduleSource, /clinicalStatus === "ACTIVE"/);
assert.match(moduleSource, /status: "ACTIVE"/);
assert.match(moduleSource, /Selected emergency contact is not active for this patient/);
assert.match(moduleSource, /documentsIncluded: false/);
assert.match(moduleSource, /patientControlled: true/);
assert.match(moduleSource, /privacyByDefault: true/);
assert.match(moduleSource, /PATIENT_EMERGENCY_CARD_READ/);
assert.match(moduleSource, /PATIENT_EMERGENCY_CARD_SETTINGS_UPDATED/);
assert.doesNotMatch(moduleSource, /clinicalDocument|documentContent|ciphertext.*metadata/);
assert.match(app, /PatientEmergencyCardModule/);

assert.match(api, /patientEmergencyCard\(\)/);
assert.match(api, /patientEmergencyCardSettings\(\)/);
assert.match(api, /updatePatientEmergencyCardSettings/);
assert.match(main, /patient-emergency-card-entry/);
assert.match(ui, /class PatientEmergencyCardPage/);
assert.match(ui, /patient-emergency-card-settings/);
assert.match(ui, /Nothing is shared by default/);
assert.match(ui, /never includes full clinical documents/);
for (const locale of ["CarePointLocale.en","CarePointLocale.ar","CarePointLocale.fr","CarePointLocale.es"]) {
  assert.ok(ui.includes(locale), `Missing PAT-098 locale ${locale}`);
}

console.log("PAT-098 Patient emergency medical card acceptance passed");

function read(relative) {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}
