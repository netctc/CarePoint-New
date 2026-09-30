import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = read("../src/modules/admin-analytics/admin-analytics.module.ts");
const schema = read("../prisma/v2_analytics_pipeline.prisma");
const migration = read("../prisma/migrations/20260925110000_v2_pseudonymized_analytics_pipeline/migration.sql");
const page = read("../../../apps/admin/app/analytics/population/page.tsx");
const bff = read("../../../apps/admin/app/api/admin/analytics/population/route.ts");
const ui = read("../../../apps/admin/components/PopulationAnalytics.tsx");

// BE-047 — analytics has a dedicated pseudonymized fact stream + materialized population store.
assert.match(schema, /model AnalyticsFact/);
assert.match(schema, /model PopulationMetric/);
const factModel = schema.match(/model AnalyticsFact \{[\s\S]*?\n\}/)?.[0] ?? "";
assert.ok(factModel);
assert.match(factModel, /subjectKey\s+String/);
assert.match(factModel, /sourceEventKey\s+String\s+@unique/);
assert.match(factModel, /schemaVersion\s+Int/);
assert.doesNotMatch(factModel, /patientId|providerId|accountId|email|phone/);

assert.match(migration, /carepoint_analytics_hash/);
assert.match(migration, /sha256\(convert_to\(raw_value, 'UTF8'\)\)/);
assert.match(migration, /carepoint_emit_analytics_fact/);
for (const type of ["OBSERVATION","RPM_ALERT","CARE_PLAN","QUESTIONNAIRE","LABORATORY_RESULT"]) {
  assert.match(migration, new RegExp(type));
}
assert.match(migration, /AFTER INSERT ON "Observation"/);
assert.match(migration, /AFTER INSERT ON "ClinicalAlert"/);
assert.match(migration, /AFTER INSERT ON "CarePlan"/);
assert.match(migration, /AFTER INSERT ON "QuestionnaireResponse"/);
assert.match(migration, /AFTER INSERT OR UPDATE OF "status","releasedAt" ON "LaboratoryResult"/);
assert.match(migration, /COUNT\(DISTINCT "subjectKey"\)::INTEGER/);
assert.match(migration, /AnalyticsFact_no_update/);
assert.match(migration, /AnalyticsFact_no_delete/);
assert.match(migration, /REVOKE UPDATE, DELETE ON "AnalyticsFact" FROM PUBLIC/);

// Historical OLTP access exists only in the one-time migration backfill, never in the dashboard runtime.
assert.match(migration, /FROM "Observation"/);
assert.match(migration, /FROM "CarePlan"/);
assert.match(migration, /FROM "QuestionnaireResponse"/);
assert.match(migration, /FROM "LaboratoryResult"/);
const population = source.match(/async population[\s\S]*?\n  private async periodSnapshot/)?.[0] ?? "";
assert.ok(population);
assert.match(population, /this\.prisma\.populationMetric\.findMany/);
assert.match(population, /store: "PSEUDONYMIZED_ANALYTICS"/);
assert.match(population, /runtimeOltpReads: false/);
assert.match(population, /directIdentifiersStoredInAnalytics: false/);
assert.doesNotMatch(population, /\$queryRaw|FROM "Observation"|FROM "CarePlan"|FROM "QuestionnaireResponse"|FROM "LaboratoryResult"/);

assert.match(source, /MIN_POPULATION_CELL_SIZE = 5/);
assert.match(source, /@Get\("population"\)/);
assert.match(source, /DATA_GOVERNANCE_MANAGE/);
assert.match(source, /row\.patientCount\) >= MIN_POPULATION_CELL_SIZE/);
assert.match(source, /suppressedCellsOmitted: true/);
assert.match(source, /patientIdentifiersReturned: false/);
assert.match(source, /providerIdentifiersReturned: false/);
assert.match(source, /drillDownEnabled: false/);

assert.match(bff, /admin\/operations\/analytics\/population/);
assert.match(page, /PopulationAnalytics/);
assert.match(ui, /minimumCellSize/);
assert.match(ui, /rpmAlerts/);
assert.match(ui, /suppressedCellCount/);
assert.doesNotMatch(ui, /\bpatientId\b|\bproviderId\b|patientIds|providerIds/);
assert.match(ui, /drillDownEnabled: false/);
for (const locale of ["en:", "ar:", "fr:", "es:"]) assert.match(ui, new RegExp(locale));

console.log("ADM-099 / BE-047 pseudonymized population analytics pipeline acceptance passed");

function read(relative) { return readFileSync(new URL(relative, import.meta.url), "utf8"); }
