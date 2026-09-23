import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const schema = read("../prisma/v2_observation.prisma");
const migration = read("../prisma/migrations/20260923013000_v2_observation_corrections/migration.sql");
const moduleSource = read("../src/modules/observation/observation.module.ts");
const correctionService = read("../src/modules/observation/observation-correction.service.ts");
const observationService = read("../src/modules/observation/observation.service.ts");
const api = read("../../../packages/mobile_core/lib/carepoint_api.dart");
const ui = read("../../../packages/mobile_core/lib/patient_observation_stats.dart");

assert.match(schema, /model ObservationCorrectionRevision/);
assert.match(schema, /correctionRevisions\s+ObservationCorrectionRevision\[\]/);
assert.match(schema, /@@unique\(\[observationId, sequence\]\)/);
assert.match(migration, /ObservationCorrectionRevision_append_only/);
assert.match(migration, /BEFORE UPDATE OR DELETE/);
assert.match(migration, /REVOKE UPDATE, DELETE/);
assert.doesNotMatch(migration, /DROP TABLE|DROP COLUMN/);

assert.match(moduleSource, /@Get\(":observationId\/corrections"\)/);
assert.match(moduleSource, /@Post\(":observationId\/corrections"\)/);
assert.match(moduleSource, /PATIENT_MANAGE_OBSERVATIONS/);

assert.match(correctionService, /principal\.role !== "PATIENT"/);
assert.match(correctionService, /sourceType !== "MANUAL"/);
assert.match(correctionService, /Only MANUAL observations can be corrected/);
assert.match(correctionService, /expectedSequence !== currentSequence/);
assert.match(correctionService, /convertMeasurement/);
assert.match(correctionService, /assertCanonicalRange/);
assert.match(correctionService, /encryptRecord/);
assert.match(correctionService, /decryptRecord/);
assert.match(correctionService, /observationCorrectionRevision\.create/);
assert.doesNotMatch(correctionService, /observation\.(?:update|delete|updateMany|deleteMany)\s*\(/);
assert.doesNotMatch(correctionService, /observationCorrectionRevision\.(?:update|delete|updateMany|deleteMany)\s*\(/);
assert.match(correctionService, /OBSERVATION_CORRECTED/);
assert.match(correctionService, /reasonPresent: true/);
assert.match(correctionService, /originalPreserved: true/);
assert.doesNotMatch(correctionService, /metadata:[\s\S]{0,300}reason,/);

assert.match(observationService, /correctionRevisions: \{ orderBy: \{ sequence: "desc" \}, take: 1 \}/);
assert.match(observationService, /value: correction\?\.value \?\? payload\.originalValue/);
assert.match(observationService, /originalValue: payload\.originalValue/);
assert.match(observationService, /correctionSequence:/);
assert.match(observationService, /originalPreserved: true/);

assert.match(api, /patientObservationCorrections/);
assert.match(api, /correctPatientObservation/);
assert.match(api, /'POST', '\/patient\/observations\/\$observationId\/corrections'/);

assert.match(ui, /patient-observation-correction-/);
assert.match(ui, /item\['sourceType'\] == 'MANUAL'/);
assert.match(ui, /expectedSequence: currentSequence/);
assert.match(ui, /originalPreserved/);
assert.match(ui, /correctionReason/);
for (const locale of ["CarePointLocale.en","CarePointLocale.ar","CarePointLocale.fr","CarePointLocale.es"]) {
  assert.ok(ui.includes(locale), `Missing PAT-121 locale ${locale}`);
}

console.log("PAT-121 audited manual Observation correction acceptance passed");

function read(relative) {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}
