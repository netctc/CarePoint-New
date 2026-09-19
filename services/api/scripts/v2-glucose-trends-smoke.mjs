import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const engine = require("../dist/modules/observation/glucose-trend.engine.js");

test("dedicated glucose trend accepts glucose metrics and rejects unrelated metrics", () => {
  assert.equal(engine.normalizeGlucoseMetricSelection("blood_glucose"), "BLOOD_GLUCOSE");
  assert.equal(engine.normalizeGlucoseMetricSelection("capillary_glucose"), "CAPILLARY_GLUCOSE");
  assert.throws(() => engine.normalizeGlucoseMetricSelection("heart_rate"), /glucose observation metric/);
});

test("medication statement overlay preserves exact clinical-profile source and provenance", () => {
  const events = engine.buildMedicationStatementEvents([
    {
      id: "med-entry-1",
      kind: "MEDICATION",
      status: "ACTIVE",
      data: { kind: "MEDICATION", name: "Synthetic Medicine", medicationStatus: "ACTIVE" },
      verificationStatus: "PATIENT_DECLARED",
      provenance: {
        sourceType: "PATIENT",
        recordedAt: "2026-09-18T08:00:00.000Z",
        updatedAt: "2026-09-19T08:00:00.000Z",
      },
    },
  ]);
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, "MEDICATION_STATEMENT");
  assert.equal(events[0].sourceId, "med-entry-1");
  assert.equal(events[0].detailTarget, "/provider/clinical-profile/medications/med-entry-1");
  assert.equal(events[0].label, "Synthetic Medicine");
  assert.equal(events[0].status, "ACTIVE");
  assert.equal(events[0].sourceType, "PATIENT");
  assert.equal(events[0].verificationStatus, "PATIENT_DECLARED");
  assert.equal(events[0].occurredAt.toISOString(), "2026-09-19T08:00:00.000Z");
});

test("prescription overlay preserves exact order link and lifecycle events chronologically", () => {
  const events = engine.buildPrescriptionEvents([
    {
      id: "rx-1",
      type: "PRESCRIPTION",
      status: "CANCELLED",
      signedAt: "2026-09-18T08:00:00.000Z",
      cancelledAt: "2026-09-19T09:00:00.000Z",
      completedAt: null,
      data: { medication: { name: "Synthetic Prescription" } },
    },
  ]);
  assert.deepEqual(events.map((event) => event.kind), ["PRESCRIPTION_SIGNED", "PRESCRIPTION_CANCELLED"]);
  assert.equal(events[0].sourceId, "rx-1");
  assert.equal(events[0].detailTarget, "/provider/clinical-orders/rx-1");
  assert.equal(events[0].label, "Synthetic Prescription");
  assert.equal(events[0].sourceType, "CAREPOINT_PRESCRIPTION");
  assert.equal(events[1].occurredAt.toISOString(), "2026-09-19T09:00:00.000Z");
});

test("non-medication/non-prescription resources never leak into glucose overlays", () => {
  assert.deepEqual(engine.buildMedicationStatementEvents([{ id: "condition-1", kind: "CONDITION" }]), []);
  assert.deepEqual(engine.buildPrescriptionEvents([{ id: "lab-1", type: "LABORATORY" }]), []);
});

test("glucose service keeps secondary domains independently restricted and makes no causal inference", () => {
  const service = readFileSync(new URL("../src/modules/observation/glucose-trend.service.ts", import.meta.url), "utf8");
  const controller = readFileSync(new URL("../src/modules/observation/glucose-trend.controller.ts", import.meta.url), "utf8");
  assert.match(service, /state: "RESTRICTED", accessBasis: null, items: \[\]/);
  assert.match(service, /causalInference: false/);
  assert.match(service, /automatedClinicalInference: false/);
  assert.match(service, /clinicalProfile\.listForDoctor\(principal, patientId, "MEDICATION"\)/);
  assert.match(service, /orders\.providerPatientOrders\(principal, patientId\)/);
  assert.match(controller, /@Get\(":patientId\/glucose-trends"\)/);
  assert.doesNotMatch(service, /diagnos/i);
});

console.log("V2 dedicated contextual glucose trends acceptance passed");
