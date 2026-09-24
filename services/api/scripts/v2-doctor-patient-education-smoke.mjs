import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const schema=read("../prisma/v2_patient_education.prisma");
const migration=read("../prisma/migrations/20260924040000_v2_patient_education/migration.sql");
const moduleSource=read("../src/modules/patient-education/patient-education.module.ts");
const app=read("../src/app.module.ts");
const api=read("../../../packages/mobile_core/lib/carepoint_api.dart");
const mobile=read("../../../packages/mobile_core/lib/patient_education.dart");
const record=read("../../../packages/mobile_core/lib/clinical_record.dart");
const patientMain=read("../../../apps/patient-mobile/lib/main.dart");

assert.match(schema,/model EducationContent/);
assert.match(schema,/model EducationContentVersion/);
assert.match(schema,/model PatientEducationAssignment/);
assert.match(schema,/idempotencyKey\s+String\s+@unique/);
assert.match(migration,/DRAFT/); assert.match(migration,/PUBLISHED/); assert.match(migration,/RETIRED/);
assert.match(migration,/ASSIGNED/); assert.match(migration,/REVOKED/);
assert.match(migration,/source_url_check/);
assert.doesNotMatch(migration,/DROP TABLE|DROP COLUMN/);

assert.match(moduleSource,/@Controller\("admin\/education-content"\)/);
assert.match(moduleSource,/CATALOG_MANAGE/);
assert.match(moduleSource,/Only DRAFT education versions can be published/);
assert.match(moduleSource,/status: "RETIRED"/);
assert.match(moduleSource,/sourceUrl must use HTTPS/);
assert.match(moduleSource,/REQUIRED_LOCALES = \["en","ar","fr","es"\]/);

assert.match(moduleSource,/@Get\("education-content"\)/);
assert.match(moduleSource,/@Post\("patients\/:patientId\/education"\)/);
assert.match(moduleSource,/@Post\("education-assignments\/:assignmentId\/revoke"\)/);
assert.match(moduleSource,/CARE_COORDINATION_MANAGE/);
assert.match(moduleSource,/principal\.role !== "DOCTOR"/);
assert.match(moduleSource,/provider\.class !== "DOCTOR"/);
assert.match(moduleSource,/provider\.status !== "ACTIVE"/);
assert.match(moduleSource,/status: \{ in: \["CONFIRMED","COMPLETED"\] \}/);
assert.match(moduleSource,/A PUBLISHED active education content version is required/);
assert.match(moduleSource,/CARE_PLAN/); assert.match(moduleSource,/CONDITION/);
assert.match(moduleSource,/patientId, kind: "CONDITION"/);
assert.match(moduleSource,/status: \{ in: \["ACTIVE","PAUSED"\] \}/);
assert.match(moduleSource,/PATIENT_EDUCATION_ASSIGNED/);
assert.match(moduleSource,/PATIENT_EDUCATION_REVOKED/);
assert.match(moduleSource,/patient\.education\.assigned\.title/);
assert.match(moduleSource,/patient\.education\.revoked\.title/);

assert.match(moduleSource,/@Controller\("patient\/education"\)/);
assert.match(moduleSource,/PATIENT_READ_CLINICAL_RECORD/);
assert.match(moduleSource,/where: \{ patientId: patient\.id, status: "ASSIGNED" \}/);
assert.match(moduleSource,/sourceVisible: true/);
assert.match(moduleSource,/clinicianAssigned: true/);
assert.match(moduleSource,/automatedClinicalInference: false/);
assert.match(app,/PatientEducationModule/);

assert.match(api,/doctorEducationCatalog/);
assert.match(api,/assignDoctorPatientEducation/);
assert.match(api,/revokeDoctorPatientEducation/);
assert.match(api,/patientEducation\(\)/);
assert.match(record,/doctor-patient-education-entry/);
assert.match(patientMain,/patient-education-entry/);
assert.match(mobile,/class DoctorPatientEducationPage/);
assert.match(mobile,/class PatientEducationPage/);
assert.match(mobile,/sourceNotice/);
assert.match(mobile,/patientNotice/);
assert.doesNotMatch(mobile,/http\.get|dio\.get|launchUrl/);
for(const locale of ["CarePointLocale.en","CarePointLocale.ar","CarePointLocale.fr","CarePointLocale.es"]){
  assert.ok(mobile.includes(locale),`Missing patient-education locale ${locale}`);
}
console.log("DOC-085 governed patient education acceptance passed");
function read(relative){return readFileSync(new URL(relative,import.meta.url),"utf8");}
