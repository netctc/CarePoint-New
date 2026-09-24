import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  normalizeWorkflowReasonCode,
  normalizeTransportEquipmentConfirmation,
} = require("../dist/modules/provider-workflow/provider-workflow.engine.js");
const {
  specimenCustodyEventHash,
  verifySpecimenCustodyChain,
} = require("../dist/modules/orders/specimen-custody.engine.js");

test("transport rejection reason is a structured token", () => {
  assert.equal(normalizeWorkflowReasonCode("not_available"), "NOT_AVAILABLE");
  assert.throws(() => normalizeWorkflowReasonCode("free text reason"), /reasonCode is invalid/);
});

test("transport equipment confirmation must exactly match requirements", () => {
  assert.deepEqual(
    normalizeTransportEquipmentConfirmation(
      ["OXYGEN", "MONITORING"],
      ["MONITORING", "OXYGEN"],
    ),
    ["MONITORING", "OXYGEN"],
  );
  assert.throws(
    () => normalizeTransportEquipmentConfirmation(["OXYGEN"], []),
    /exactly match/,
  );
  assert.throws(
    () => normalizeTransportEquipmentConfirmation(["OXYGEN"], ["INVALID"]),
    /Unsupported equipment value/,
  );
});

test("PRV-065/066 custody history is deterministic and tamper evident", () => {
  const first = {
    specimenId: "specimen-1",
    sequence: 1,
    eventType: "COLLECTED",
    actorProviderId: "provider-1",
    receiverRef: null,
    occurredAt: "2026-09-21T10:00:00.000Z",
    location: "LAB_A",
    conditionCode: "ACCEPTABLE",
    previousHash: null,
  };
  const firstHash = specimenCustodyEventHash(first);
  const second = {
    specimenId: "specimen-1",
    sequence: 2,
    eventType: "TRANSFERRED",
    actorProviderId: "provider-1",
    receiverRef: "LAB_B_RECEIVING",
    occurredAt: "2026-09-21T10:15:00.000Z",
    location: "LAB_B",
    conditionCode: "ACCEPTABLE",
    previousHash: firstHash,
  };
  const secondHash = specimenCustodyEventHash(second);
  const valid = verifySpecimenCustodyChain([
    { ...first, eventHash: firstHash },
    { ...second, eventHash: secondHash },
  ]);
  assert.equal(valid.verified, true);
  assert.equal(valid.eventCount, 2);
  assert.equal(valid.headHash, secondHash);

  const tampered = verifySpecimenCustodyChain([
    { ...first, eventHash: firstHash },
    { ...second, location: "UNRECORDED_LOCATION", eventHash: secondHash },
  ]);
  assert.equal(tampered.verified, false);
  assert.equal(tampered.reason, "EVENT_HASH_MISMATCH");
});

test("PRV-065/066 persistence and mobile surface preserve custody invariants", () => {
  const migration = readFileSync(
    new URL("../prisma/migrations/20260921132000_v2_specimen_custody/migration.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /SpecimenCustodyEvent_append_only/);
  assert.match(migration, /BEFORE UPDATE OR DELETE/);
  assert.match(migration, /REVOKE UPDATE, DELETE/);
  assert.match(migration, /ClinicalOrder/);
  assert.match(migration, /PatientProfile/);

  const service = readFileSync(
    new URL("../src/modules/orders/specimens.service.ts", import.meta.url),
    "utf8",
  );
  assert.match(service, /SPECIMEN_COLLECTION/);
  assert.match(service, /Specimens require a laboratory order/);
  assert.match(service, /SPECIMEN_CUSTODY_EVENT_APPENDED/);
  assert.match(service, /verifySpecimenCustodyChain/);

  const mobile = readFileSync(
    new URL("../../../packages/mobile_core/lib/specimen_workflow.dart", import.meta.url),
    "utf8",
  );
  assert.match(mobile, /Registrar toma de muestra/);
  assert.match(mobile, /Cadena de custodia/);
  assert.match(mobile, /Integridad verificada/);
  assert.match(mobile, /'ar'/);
  assert.match(mobile, /'fr'/);
  assert.match(mobile, /'es'/);
});

test("PRV-067 functional assessment preserves versioned encrypted source evidence", () => {
  const migration = readFileSync(
    new URL("../prisma/migrations/20260921143000_v2_physio_assessments_rom/migration.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /PhysioAssessment_sourceFormResponseId_key/);
  assert.match(migration, /sourceFormVersion/);
  assert.match(migration, /sourceResponseSequence/);
  assert.match(migration, /PhysioAssessment_append_only_trg/);
  assert.match(migration, /BEFORE UPDATE OR DELETE/);

  const service = readFileSync(
    new URL("../src/modules/physiotherapy/physiotherapy.service.ts", import.meta.url),
    "utf8",
  );
  assert.match(service, /PHYSIOTHERAPY/);
  assert.match(service, /sourceFormResponseId/);
  assert.match(service, /sourceFormVersion: source\.formVersion\.version/);
  assert.match(service, /sourceResponseSequence: source\.sequence/);
  assert.match(service, /sourceResponsesEncryptedAtRest: true/);
  assert.match(service, /automatedClinicalInference: false/);
  assert.doesNotMatch(service, /\.decrypt\(/);

  const evidence = readFileSync(
    new URL("../src/modules/physiotherapy/physio-source-evidence.service.ts", import.meta.url),
    "utf8",
  );
  assert.match(evidence, /sourceResponsesEncryptedAtRest: true/);
  assert.match(evidence, /rawAnswersReturned: false/);
  assert.doesNotMatch(evidence, /ciphertext/);
});

test("PRV-068 ROM is structured, append-only and graph-ready", () => {
  const migration = readFileSync(
    new URL("../prisma/migrations/20260921143000_v2_physio_assessments_rom/migration.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /RangeOfMotionObservation_joint_ck/);
  assert.match(migration, /RangeOfMotionObservation_movement_ck/);
  assert.match(migration, /LEFT.*RIGHT.*BILATERAL.*MIDLINE/s);
  assert.match(migration, /degrees.*BETWEEN -360 AND 360/s);
  assert.match(migration, /RangeOfMotionObservation_append_only_trg/);

  const service = readFileSync(
    new URL("../src/modules/physiotherapy/physiotherapy.service.ts", import.meta.url),
    "utf8",
  );
  assert.match(service, /jointCode/);
  assert.match(service, /movementCode/);
  assert.match(service, /side/);
  assert.match(service, /degrees/);
  assert.match(service, /graphReady: true/);
  assert.match(service, /orderBy: \[\{ measuredAt: "asc" \}/);

  const catalog = readFileSync(
    new URL("../src/modules/providers/providers.module.ts", import.meta.url),
    "utf8",
  );
  assert.match(catalog, /SPECIMEN_COLLECTION/);
  assert.match(catalog, /PHYSIOTHERAPY/);

  const mobile = readFileSync(
    new URL("../../../packages/mobile_core/lib/physiotherapy.dart", import.meta.url),
    "utf8",
  );
  assert.match(mobile, /Evaluación funcional/);
  assert.match(mobile, /Rango de movimiento/);
  assert.match(mobile, /_RomTrendPainter/);
  assert.match(mobile, /sourceResponsesEncryptedAtRest|encryptedSource/);
  assert.match(mobile, /'ar'/);
  assert.match(mobile, /'fr'/);
  assert.match(mobile, /'es'/);

  const entry = readFileSync(
    new URL("../../../apps/provider-mobile/lib/physiotherapy_entry.dart", import.meta.url),
    "utf8",
  );
  assert.match(entry, /PHYSIOTHERAPY/);
  assert.match(entry, /CONFIRMED/);
  assert.match(entry, /COMPLETED/);
});

test("PRV-069 home exercise programmes reuse CareTask and patient-declared completion safely", () => {
  const migration = readFileSync(
    new URL("../prisma/migrations/20260921151500_v2_home_exercise_plan/migration.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /CREATE TABLE "HomeExercisePlan"/);
  assert.match(migration, /idempotencyKey/);
  assert.match(migration, /requestDigest/);
  assert.match(migration, /REFERENCES "CarePlan"/);
  assert.doesNotMatch(migration, /HomeExerciseCompletion/);

  const service = readFileSync(
    new URL("../src/modules/physiotherapy/home-exercise-plan.service.ts", import.meta.url),
    "utf8",
  );
  assert.match(service, /PHYSIOTHERAPY/);
  assert.match(service, /CARE_PLAN_WRITE/);
  assert.match(service, /care-plan-v1/);
  assert.match(service, /careTask\.create/);
  assert.match(service, /assigneeType: "PATIENT"/);
  assert.match(service, /encryptRecord/);
  assert.match(service, /careTaskCompletion\.findMany/);
  assert.match(service, /actorRole: "PATIENT"/);
  assert.match(service, /releasedToPatient: true/);
  assert.match(service, /CLINICAL_MEDIA/);
  assert.match(service, /requestDigest/);
  assert.match(service, /patientDeclaredCompliance: true/);
  assert.match(service, /automatedClinicalInference: false/);
  assert.doesNotMatch(service, /https?:\/\//);

  const mobile = readFileSync(
    new URL("../../../packages/mobile_core/lib/home_exercise.dart", import.meta.url),
    "utf8",
  );
  assert.match(mobile, /Programa de ejercicios domiciliarios/);
  assert.match(mobile, /ProviderHomeExercisePage/);
  assert.match(mobile, /PatientHomeExercisePage/);
  assert.match(mobile, /patient\/care-tasks/);
  assert.match(mobile, /DONE/);
  assert.match(mobile, /OMITTED/);
  assert.match(mobile, /'ar'/);
  assert.match(mobile, /'fr'/);
  assert.match(mobile, /'es'/);

  const patientEntry = readFileSync(
    new URL("../../../apps/patient-mobile/lib/main.dart", import.meta.url),
    "utf8",
  );
  assert.match(patientEntry, /patient-home-exercise-entry/);
});

test("PRV-070 nutrition anthropometry normalizes units and preserves source evidence", () => {
  const migration = readFileSync(
    new URL("../prisma/migrations/20260921212500_v2_nutrition_anthropometry/migration.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /CREATE TABLE "AnthropometricMeasurement"/);
  assert.match(migration, /sourceValue/);
  assert.match(migration, /sourceUnit/);
  assert.match(migration, /normalizedValue/);
  assert.match(migration, /normalizedUnit/);
  assert.match(migration, /AnthropometricMeasurement_append_only_trg/);
  assert.match(migration, /BEFORE UPDATE OR DELETE/);
  assert.match(migration, /REVOKE UPDATE, DELETE/);

  const service = readFileSync(
    new URL("../src/modules/nutrition/nutrition.module.ts", import.meta.url),
    "utf8",
  );
  assert.match(service, /NUTRITION/);
  assert.match(service, /0\.45359237/);
  assert.match(service, /2\.54/);
  assert.match(service, /unitsNormalized: true/);
  assert.match(service, /preservesSourceUnit: true/);
  assert.match(service, /origin: "PROVIDER_RECORDED"/);
  assert.match(service, /measuredAt/);
  assert.match(service, /requestDigest/);
  assert.match(service, /automatedClinicalInference: false/);
  assert.match(service, /NUTRITION_ANTHROPOMETRY_RECORDED/);

  const catalog = readFileSync(
    new URL("../src/modules/providers/providers.module.ts", import.meta.url),
    "utf8",
  );
  assert.match(catalog, /NUTRITION/);

  const mobile = readFileSync(
    new URL("../../../packages/mobile_core/lib/nutrition.dart", import.meta.url),
    "utf8",
  );
  assert.match(mobile, /Antropometría nutricional/);
  assert.match(mobile, /WAIST_CIRCUMFERENCE/);
  assert.match(mobile, /BODY_FAT_PERCENT/);
  assert.match(mobile, /provider\/nutrition\/anthropometrics/);
  assert.match(mobile, /'ar'/);
  assert.match(mobile, /'fr'/);
  assert.match(mobile, /'es'/);

  const entry = readFileSync(
    new URL("../../../apps/provider-mobile/lib/nutrition_entry.dart", import.meta.url),
    "utf8",
  );
  assert.match(entry, /NUTRITION/);
  assert.match(entry, /CONFIRMED/);
  assert.match(entry, /COMPLETED/);
});

console.log("V2 provider workflow + PRV-065/066 specimen custody + PRV-067/068/069 physiotherapy + PRV-070 nutrition acceptance passed");
await import("./v2-provider-secure-contact-smoke.mjs");
