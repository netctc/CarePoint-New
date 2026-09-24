import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = read("../src/modules/admin-analytics/admin-analytics.module.ts");
const page = read("../../../apps/admin/app/analytics/population/page.tsx");
const bff = read("../../../apps/admin/app/api/admin/analytics/population/route.ts");
const ui = read("../../../apps/admin/components/PopulationAnalytics.tsx");

assert.match(source, /MIN_POPULATION_CELL_SIZE = 5/);
assert.match(source, /@Get\("population"\)/);
assert.match(source, /DATA_GOVERNANCE_MANAGE/);
assert.match(source, /COUNT\(DISTINCT "patientId"\)::int AS "patientCount"/);
assert.match(source, /COUNT\(DISTINCT co\."patientId"\)::int AS "patientCount"/);
assert.match(source, /FROM "Observation"/);
assert.match(source, /FROM "CarePlan"/);
assert.match(source, /FROM "QuestionnaireResponse"/);
assert.match(source, /FROM "LaboratoryResult" lr/);
assert.match(source, /row\.patientCount\) >= MIN_POPULATION_CELL_SIZE/);
assert.match(source, /suppressedCellsOmitted: true/);
assert.match(source, /patientIdentifiersReturned: false/);
assert.match(source, /providerIdentifiersReturned: false/);
assert.match(source, /drillDownEnabled: false/);
assert.doesNotMatch(source, /patientId:\s*row\./);
assert.doesNotMatch(source, /providerId:\s*row\./);

assert.match(bff, /admin\/operations\/analytics\/population/);
assert.match(page, /PopulationAnalytics/);
assert.match(ui, /minimumCellSize/);
assert.match(ui, /suppressedCellCount/);
assert.doesNotMatch(ui, /patientId|providerId|drill.?down/i);
for (const locale of ["en:", "ar:", "fr:", "es:"]) assert.match(ui, new RegExp(locale));

console.log("ADM-099 privacy-preserving population analytics acceptance passed");

function read(relative) { return readFileSync(new URL(relative, import.meta.url), "utf8"); }
