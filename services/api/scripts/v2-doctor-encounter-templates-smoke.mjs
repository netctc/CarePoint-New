import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const schema = read("../prisma/v2_encounter_templates.prisma");
const migration = read("../prisma/migrations/20260923010000_v2_encounter_templates/migration.sql");
const moduleSource = read("../src/modules/encounter-templates/encounter-templates.module.ts");
const app = read("../src/app.module.ts");
const api = read("../../../packages/mobile_core/lib/carepoint_api.dart");
const record = read("../../../packages/mobile_core/lib/clinical_record.dart");

assert.match(schema, /model EncounterTemplate/);
assert.match(schema, /model EncounterTemplateVersion/);
assert.match(schema, /@@unique\(\[templateId, version\]\)/);
assert.match(migration, /EncounterTemplateVersion_status_check/);
assert.match(migration, /DRAFT/);
assert.match(migration, /PUBLISHED/);
assert.match(migration, /RETIRED/);
assert.doesNotMatch(migration, /DROP TABLE|DROP COLUMN/);

assert.match(moduleSource, /@Controller\("admin\/encounter-templates"\)/);
assert.match(moduleSource, /CATALOG_MANAGE/);
assert.match(moduleSource, /@Post\(":templateId\/versions"\)/);
assert.match(moduleSource, /@Post\(":templateId\/versions\/:version\/publish"\)/);
assert.match(moduleSource, /Only DRAFT encounter template versions can be published/);
assert.match(moduleSource, /status: "RETIRED"/);

assert.match(moduleSource, /@Controller\("provider\/encounter-templates"\)/);
assert.match(moduleSource, /CLINICAL_RECORD_READ/);
assert.match(moduleSource, /principal\.role !== "DOCTOR"/);
assert.match(moduleSource, /provider\.class !== "DOCTOR"/);
assert.match(moduleSource, /provider\.status !== "ACTIVE"/);
assert.match(moduleSource, /providerId: provider\.id/);
assert.match(moduleSource, /status: \{ in: \["CONFIRMED", "COMPLETED"\] \}/);
assert.match(moduleSource, /serviceMatch/);
assert.match(moduleSource, /specialtyMatch/);
assert.match(moduleSource, /Cache-Control/);

assert.match(moduleSource, /Unsupported section key .*templates may define structure\/guidance only/);
assert.match(moduleSource, /clinicalContentPrefilled: false/);
assert.match(moduleSource, /Every serviceId must reference an active service/);
assert.match(moduleSource, /Every specialtyCode must reference an active medical specialty/);
for (const field of ["CHIEF_COMPLAINT","SUBJECTIVE","OBJECTIVE","ASSESSMENT","PLAN","VITALS"]) {
  assert.match(moduleSource, new RegExp(field));
}
for (const locale of ["en","ar","fr","es"]) {
  assert.match(moduleSource, new RegExp(`"${locale}"`));
}
assert.match(app, /EncounterTemplatesModule/);

assert.match(api, /doctorEncounterTemplates/);
assert.match(api, /\/provider\/encounter-templates/);
assert.match(record, /doctor-encounter-template-selector/);
assert.match(record, /_structuredClinicalFields/);
assert.match(record, /_missingRequiredTemplateField/);
assert.match(record, /clinicalContentPrefilled|No clinical content is inserted automatically/);
assert.match(record, /onChanged: \(value\) => setState\(\(\) => selectedEncounterTemplateId = value\)/);
assert.doesNotMatch(record, /selectedEncounterTemplateId[\s\S]{0,400}\.text\s*=/);
for (const locale of ["CarePointLocale.en","CarePointLocale.ar","CarePointLocale.fr","CarePointLocale.es"]) {
  assert.ok(record.includes(locale), `Missing encounter-template locale ${locale}`);
}

console.log("DOC-080 encounter templates acceptance passed");

function read(relative) {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}
