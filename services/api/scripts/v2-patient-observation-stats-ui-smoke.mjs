import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const moduleSource = read("../src/modules/observation/observation.module.ts");
const service = read("../src/modules/observation/observation-trend.service.ts");
const engine = read("../src/modules/observation/observation-trend.engine.ts");
const api = read("../../../packages/mobile_core/lib/carepoint_api.dart");
const ui = read("../../../packages/mobile_core/lib/patient_observation_stats.dart");
const main = read("../../../apps/patient-mobile/lib/main.dart");

assert.match(moduleSource, /@Get\("stats"\)/);
assert.match(moduleSource, /PATIENT_MANAGE_OBSERVATIONS/);
assert.match(moduleSource, /this\.trends\.patientStats/);

assert.match(service, /async patientStats/);
assert.match(service, /historyMine\(principal, code, from, to, 500\)/);
assert.match(service, /buildObservationTrend\(history\.items, null\)/);
assert.match(service, /OBSERVATION_STATS_READ/);
assert.match(service, /measurementCount: projection\.table\.length/);
assert.match(service, /automatedClinicalInference: false/);
assert.match(service, /automatedDiagnosis: false/);

assert.match(engine, /minimum: Math\.min/);
assert.match(engine, /maximum: Math\.max/);
assert.match(engine, /average:/);
assert.match(engine, /unitConsistency/);

assert.match(api, /patientObservationCatalog/);
assert.match(api, /patientObservationStats/);
assert.match(api, /\/patient\/observations\/stats/);
assert.match(main, /patient-observation-stats-entry/);
assert.match(main, /PatientObservationStatsPage/);

for (const token of ["'7D'","'30D'","'3M'","'6M'","'1Y'","'ALL'"]) assert.ok(ui.includes(token));
for (const key of ["latest","minimum","maximum","average","measurementCount"]) assert.match(ui, new RegExp(key));
assert.match(ui, /automatedClinicalInference/);
assert.match(ui, /automatedDiagnosis/);
assert.match(ui, /descriptive only/);
assert.doesNotMatch(ui, /risk score|diagnosis result|normal range classification/i);
for (const locale of ["CarePointLocale.en","CarePointLocale.ar","CarePointLocale.fr","CarePointLocale.es"]) {
  assert.ok(ui.includes(locale), `Missing PAT-119 locale ${locale}`);
}

console.log("PAT-119 Patient observation statistics acceptance passed");

function read(relative) {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}
