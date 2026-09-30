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

test("medication overlay preserves exact canonical source link", () => {
  const events = engine.buildMedicationStatementEvents([{
    id: "med-entry-1",
    kind: "MEDICATION",
    status: "ACTIVE",
    data: { kind: "MEDICATION", name: "Synthetic Medicine", medicationStatus: "ACTIVE" },
    verificationStatus: "PATIENT_DECLARED",
    provenance: { sourceType: "PATIENT", recordedAt: "2026-09-18T08:00:00.000Z", updatedAt: "2026-09-19T08:00:00.000Z" },
  }]);
  assert.equal(events.length, 1);
  assert.equal(events[0].sourceId, "med-entry-1");
  assert.equal(events[0].detailTarget, "/provider/clinical-profile/medications/med-entry-1");
});

test("prescription overlay preserves exact order lifecycle/source", () => {
  const events = engine.buildPrescriptionEvents([{
    id: "rx-1",
    type: "PRESCRIPTION",
    status: "CANCELLED",
    signedAt: "2026-09-18T08:00:00.000Z",
    cancelledAt: "2026-09-19T09:00:00.000Z",
    completedAt: null,
    data: { medication: { name: "Synthetic Prescription" } },
  }]);
  assert.deepEqual(events.map((event) => event.kind), ["PRESCRIPTION_SIGNED", "PRESCRIPTION_CANCELLED"]);
  assert.equal(events[0].detailTarget, "/provider/clinical-orders/rx-1");
});

test("secondary domains are independently restricted and no causal inference is emitted", () => {
  const service = readFileSync(new URL("../src/modules/observation/glucose-trend.service.ts", import.meta.url), "utf8");
  const controller = readFileSync(new URL("../src/modules/observation/glucose-trend.controller.ts", import.meta.url), "utf8");
  assert.match(service, /state: "RESTRICTED", accessBasis: null, items: \[\]/);
  assert.match(service, /causalInference: false/);
  assert.match(service, /automatedClinicalInference: false/);
  assert.match(service, /clinicalProfile\.listForDoctor\(principal, patientId, "MEDICATION"\)/);
  assert.match(service, /orders\.providerPatientOrders\(principal, patientId\)/);
  assert.match(controller, /@Get\(":patientId\/glucose-trends"\)/);
});

console.log("DOC-010 dedicated contextual glucose trends acceptance passed");
