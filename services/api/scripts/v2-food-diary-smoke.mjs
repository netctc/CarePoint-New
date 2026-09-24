import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const schema = read("../prisma/v2_food_diary.prisma");
const migration = read("../prisma/migrations/20260924220000_v2_food_diary/migration.sql");
const moduleSource = read("../src/modules/food-diary/food-diary.module.ts");
const service = read("../src/modules/food-diary/food-diary.service.ts");
const app = read("../src/app.module.ts");
const api = read("../../../packages/mobile_core/lib/carepoint_api.dart");
const mobile = read("../../../packages/mobile_core/lib/food_diary.dart");
const patient = read("../../../apps/patient-mobile/lib/main.dart");
const provider = read("../../../apps/provider-mobile/lib/nutrition_entry.dart");

assert.match(schema, /model FoodDiaryEntry/);
assert.match(schema, /model FoodDiaryProfessionalComment/);
assert.match(schema, /shared\s+Boolean/);
assert.match(schema, /version\s+Int/);
assert.match(schema, /ciphertext/);
assert.match(migration, /FoodDiaryEntry_mealType_check/);
assert.match(migration, /FoodDiaryProfessionalComment/);
assert.doesNotMatch(migration, /DROP TABLE|DROP COLUMN/);

// Patient owns original entry and can only mutate sharing metadata.
assert.match(moduleSource, /@Controller\("patient\/food-diary"\)/);
assert.match(moduleSource, /PATIENT_MANAGE_CLINICAL_PROFILE/);
assert.match(moduleSource, /@Post\(":entryId\/share"\)/);
assert.match(service, /principal\.role !== "PATIENT"/);
assert.match(service, /encryptRecord/);
assert.match(service, /source: "PATIENT_REPORTED"/);
assert.match(service, /Food diary sharing version conflict/);
assert.doesNotMatch(moduleSource, /@Patch\(":entryId"\)/);
assert.doesNotMatch(moduleSource, /@Delete/);

// Provider needs nutrition capability + own appointment + target consent + explicit share.
assert.match(moduleSource, /@Get\(":patientId\/food-diary"\)/);
assert.match(service, /clinicalOrderCapabilities\.has\("NUTRITION"\)/);
assert.match(service, /providerId,/);
assert.match(service, /status: \{ in: \["CONFIRMED","COMPLETED"\] \}/);
assert.match(service, /scope: HEALTH_PROFILE_SCOPE/);
assert.match(service, /version: HEALTH_PROFILE_VERSION/);
assert.match(service, /purpose: "TREATMENT"/);
assert.match(service, /state: "GRANTED"/);
assert.match(service, /shared: true/);

// Professional comments are separate encrypted append-only rows.
assert.match(moduleSource, /@Post\(":entryId\/comments"\)/);
assert.match(service, /foodDiaryProfessionalComment\.create/);
assert.match(service, /modifiesPatientEntry: false/);
assert.match(service, /appendOnly: true/);
assert.doesNotMatch(service, /foodDiaryEntry\.update\([\s\S]{0,300}comment/);
assert.match(service, /clinicalContentInAudit: false/);
assert.match(app, /FoodDiaryModule/);

// Mobile surfaces are end-to-end and localized.
assert.match(api, /patientFoodDiary/);
assert.match(api, /providerFoodDiary/);
assert.match(api, /addProviderFoodDiaryComment/);
assert.match(patient, /patient-food-diary-entry/);
assert.match(provider, /provider-food-diary-action/);
assert.match(mobile, /class PatientFoodDiaryPage/);
assert.match(mobile, /class ProviderFoodDiaryPage/);
for (const locale of ["CarePointLocale.en","CarePointLocale.ar","CarePointLocale.fr","CarePointLocale.es"]) {
  assert.ok(mobile.includes(locale), `Missing food diary locale ${locale}`);
}
assert.match(mobile, /HEALTH_PROFILE_READ/);
assert.match(mobile, /comment is append-only|comentario es append-only|commentaire est append-only|التعليق إضافي فقط/);

console.log("PRV-071 patient-owned shared food diary acceptance passed");

function read(relative){return readFileSync(new URL(relative, import.meta.url),"utf8");}
