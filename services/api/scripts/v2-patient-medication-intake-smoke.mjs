import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const schema=read("../prisma/v2_medication_reminders.prisma");
const migration=read("../prisma/migrations/20260924024500_v2_medication_intakes/migration.sql");
const moduleSource=read("../src/modules/medication-reminders/medication-reminders.module.ts");
const api=read("../../../packages/mobile_core/lib/carepoint_api.dart");
const mobile=read("../../../packages/mobile_core/lib/patient_medication_reminders.dart");

// PAT-130 persistence is append-only and structural.
assert.match(schema,/model MedicationIntake/);
assert.match(schema,/status\s+String/);
assert.match(schema,/sourceType\s+String\s+@default\("PATIENT_REPORTED"\)/);
assert.match(schema,/requestDigest\s+String/);
assert.doesNotMatch(schema,/notes|clinicalText|medicationName|dose/);
assert.match(migration,/TAKEN/);
assert.match(migration,/OMITTED/);
assert.match(migration,/POSTPONED/);
assert.match(migration,/PATIENT_REPORTED/);
assert.match(migration,/MedicationIntake_append_only_trigger/);
assert.match(migration,/BEFORE UPDATE OR DELETE/);
assert.doesNotMatch(migration,/DROP TABLE|DROP COLUMN/);

// API is patient-context scoped, idempotent and never mutates the clinical source.
assert.match(moduleSource,/@Controller\("patient\/medication-intakes"\)/);
assert.match(moduleSource,/PATIENT_MANAGE_CLINICAL_PROFILE/);
assert.match(moduleSource,/resolveEffectivePatient\(principal, "CLINICAL_READ"\)/);
assert.match(moduleSource,/resolveEffectivePatient\(principal, "CLINICAL_WRITE"\)/);
assert.match(moduleSource,/assertActiveSource/);
assert.match(moduleSource,/accountId_patientId_idempotencyKey/);
assert.match(moduleSource,/requestDigest/);
assert.match(moduleSource,/sourceType: "PATIENT_REPORTED"/);
assert.match(moduleSource,/prescriptionMutationAllowed: false/);
assert.match(moduleSource,/clinicalSourceModified: false/);
assert.doesNotMatch(moduleSource,/@Patch\("[^"]*intake|@Delete\("[^"]*intake/);

// Mobile exposes all three states and history without prescription mutation actions.
assert.match(api,/patientMedicationIntakes/);
assert.match(api,/recordPatientMedicationIntake/);
assert.match(api,/\/patient\/medication-intakes/);
for(const status of ["TAKEN","OMITTED","POSTPONED"])assert.match(mobile,new RegExp(status));
assert.match(mobile,/patient-medication-intake-taken-/);
assert.match(mobile,/patient-medication-intake-omitted-/);
assert.match(mobile,/patient-medication-intake-postponed-/);
assert.match(mobile,/does not change the prescription/);
assert.doesNotMatch(mobile,/cancelClinicalOrder|createPrescription|updatePatientClinicalProfileEntry/);
for(const locale of ["CarePointLocale.en","CarePointLocale.ar","CarePointLocale.fr","CarePointLocale.es"])assert.ok(mobile.includes(locale));

console.log("PAT-130 patient-reported medication intake acceptance passed");

function read(relative){return readFileSync(new URL(relative,import.meta.url),"utf8");}
