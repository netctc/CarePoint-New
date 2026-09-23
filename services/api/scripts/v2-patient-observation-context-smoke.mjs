import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const schema = read("../prisma/v2_observation.prisma");
const migration = read("../prisma/migrations/20260923011500_v2_observation_context_revisions/migration.sql");
const moduleSource = read("../src/modules/observation/observation.module.ts");
const service = read("../src/modules/observation/observation-context.service.ts");
const api = read("../../../packages/mobile_core/lib/carepoint_api.dart");
const ui = read("../../../packages/mobile_core/lib/patient_observation_stats.dart");

assert.match(schema, /model ObservationContextRevision/);
assert.match(schema, /@@unique\(\[observationId, sequence\]\)/);
assert.match(schema, /contextRevisions\s+ObservationContextRevision\[\]/);
assert.match(migration, /ObservationContextRevision_append_only/);
assert.match(migration, /BEFORE UPDATE OR DELETE/);
assert.match(migration, /REVOKE UPDATE, DELETE/);
assert.doesNotMatch(migration, /DROP TABLE|DROP COLUMN/);

assert.match(moduleSource, /@Get\(":observationId\/context"\)/);
assert.match(moduleSource, /@Patch\(":observationId\/context"\)/);
assert.match(moduleSource, /PATIENT_MANAGE_OBSERVATIONS/);

assert.match(service, /encryptRecord/);
assert.match(service, /decryptRecord/);
assert.match(service, /SELECT id FROM "Observation" WHERE id = \$\{observationId\} FOR UPDATE/);
assert.match(service, /expectedSequence !== currentSequence/);
assert.match(service, /observationContextRevision\.create/);
assert.doesNotMatch(service, /observation\.(?:update|delete|updateMany|deleteMany)\s*\(/);
assert.doesNotMatch(service, /observationContextRevision\.(?:update|delete|updateMany|deleteMany)\s*\(/);
assert.match(service, /OBSERVATION_CONTEXT_REVISED/);
assert.match(service, /valueMutated: false/);
assert.match(service, /hasContext: Boolean\(context\)/);
assert.match(service, /hasNote: Boolean\(note\)/);

assert.match(api, /patientObservationContext/);
assert.match(api, /updatePatientObservationContext/);
assert.match(api, /'PATCH', '\/patient\/observations\/\$observationId\/context'/);
assert.match(ui, /patient-observation-context-/);
assert.match(ui, /expectedSequence: currentSequence/);
assert.match(ui, /updated\['valueMutated'\] != false/);
assert.match(ui, /valueImmutable/);
for (const locale of ["CarePointLocale.en","CarePointLocale.ar","CarePointLocale.fr","CarePointLocale.es"]) {
  assert.ok(ui.includes(locale), `Missing PAT-120 locale ${locale}`);
}

console.log("PAT-120 versioned Observation context acceptance passed");

function read(relative) {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}
