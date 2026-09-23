import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const schema = read("../prisma/v2_medication_reminders.prisma");
const migration = read("../prisma/migrations/20260924013000_v2_medication_reminders/migration.sql");
const moduleSource = read("../src/modules/medication-reminders/medication-reminders.module.ts");
const api = read("../../../packages/mobile_core/lib/carepoint_api.dart");
const mobile = read("../../../packages/mobile_core/lib/patient_medication_reminders.dart");
const main = read("../../../apps/patient-mobile/lib/main.dart");

assert.match(schema, /model MedicationReminder/);
assert.match(schema, /sourceKind\s+String/);
assert.match(schema, /sourceId\s+String/);
assert.match(schema, /localTimes\s+Json/);
assert.match(schema, /timeZone\s+String/);
assert.doesNotMatch(schema, /medicationName|dose|dosage|ciphertext|clinicalPayload/);
assert.match(migration, /CLINICAL_PROFILE_ENTRY/);
assert.match(migration, /PRESCRIPTION_ORDER/);
assert.match(migration, /MedicationReminder_patientId_fkey/);
assert.doesNotMatch(migration, /DROP TABLE|DROP COLUMN/);

assert.match(moduleSource, /@Controller\("patient\/medication-reminders"\)/);
assert.match(moduleSource, /PATIENT_MANAGE_CLINICAL_PROFILE/);
assert.match(moduleSource, /principal\.role !== "PATIENT"/);
assert.match(moduleSource, /resolveEffectivePatient\(principal, "CLINICAL_READ"\)/);
assert.match(moduleSource, /resolveEffectivePatient\(principal, "CLINICAL_WRITE"\)/);
assert.match(moduleSource, /row\.kind === "MEDICATION" && row\.status === "ACTIVE"/);
assert.match(moduleSource, /row\.type === "PRESCRIPTION" && row\.status === "SIGNED"/);
assert.match(moduleSource, /prescriptionMutationAllowed: false/);
assert.match(moduleSource, /MEDICATION_REMINDER_AUTO_DISABLED/);
assert.match(moduleSource, /notification\.medication_reminder\.title/);
assert.match(moduleSource, /dedupeKey: .*medication-reminder:/);
assert.doesNotMatch(moduleSource, /medicationName|dosageInstruction|strength/);

assert.match(api, /patientMedicationReminders/);
assert.match(api, /createPatientMedicationReminder/);
assert.match(api, /updatePatientMedicationReminder/);
assert.match(api, /\/patient\/medication-reminders/);

assert.match(mobile, /patientClinicalProfileEntries\(kind: 'MEDICATION'\)/);
assert.match(mobile, /patientClinicalOrders\(\)/);
assert.match(mobile, /PRESCRIPTION_ORDER/);
assert.match(mobile, /CLINICAL_PROFILE_ENTRY/);
assert.match(mobile, /patient-medication-reminder-create-/);
assert.match(mobile, /patient-medication-reminder-toggle-/);
assert.match(mobile, /patient-medication-reminder-edit-/);
assert.doesNotMatch(mobile, /updatePatientClinicalProfileEntry|cancelClinicalOrder|createPrescription/);
assert.match(main, /patient-medication-reminders-entry/);

for (const locale of ["CarePointLocale.en","CarePointLocale.ar","CarePointLocale.fr","CarePointLocale.es"]) {
  assert.ok(mobile.includes(locale), `Missing medication-reminder locale ${locale}`);
}

console.log("PAT-129 Patient medication reminders acceptance passed");

function read(relative) {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}
