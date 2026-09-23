import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const engine = require("../dist/modules/observation/provider-observation.engine.js");

await import("./v2-observation-trends-smoke.mjs");

test("provider observation input normalizes catalog tokens and optional encounter", () => {
  assert.deepEqual(engine.normalizeProviderObservationInput({
    code: "blood_pressure_systolic",
    value: 122,
    unitCode: "mmhg",
    observedAt: "2026-09-19T10:00:00+00:00",
    encounterId: "encounter-1",
  }), {
    code: "BLOOD_PRESSURE_SYSTOLIC",
    value: 122,
    unitCode: "MMHG",
    observedAt: "2026-09-19T10:00:00.000Z",
    encounterId: "encounter-1",
  });
});

test("provider observation rejects invalid finite values and timestamps", () => {
  assert.throws(() => engine.normalizeProviderObservationInput({
    code: "HEART_RATE",
    value: Number.NaN,
    unitCode: "BPM",
    observedAt: "2026-09-19T10:00:00.000Z",
  }), /finite/);
  assert.throws(() => engine.normalizeProviderObservationInput({
    code: "HEART_RATE",
    value: 70,
    unitCode: "BPM",
    observedAt: "not-a-date",
  }), /ISO date-time/);
});

test("encounter binding requires the same patient and assigned provider", () => {
  const encounter = { id: "enc-1", patientId: "patient-1", providerId: "provider-1", status: "CONFIRMED" };
  assert.equal(engine.assertProviderEncounterBinding(encounter, "patient-1", "provider-1").id, "enc-1");
  assert.throws(() => engine.assertProviderEncounterBinding(encounter, "patient-2", "provider-1"), /target patient/);
  assert.throws(() => engine.assertProviderEncounterBinding(encounter, "patient-1", "provider-2"), /current provider/);
  assert.throws(() => engine.assertProviderEncounterBinding({ ...encounter, status: "CANCELLED" }, "patient-1", "provider-1"), /confirmed or completed/);
});

test("provider provenance is explicit and never implies an automated diagnosis", () => {
  assert.deepEqual(engine.providerObservationProvenance("provider-1", "enc-1"), {
    sourceType: "PROVIDER",
    sourceId: "provider-1",
    verificationStatus: "PROVIDER_VERIFIED",
    encounterId: "enc-1",
    automatedDiagnosis: false,
  });
});

console.log("V2 provider observation acceptance passed");

await import("./v2-other-provider-observation-panel-smoke.mjs");
