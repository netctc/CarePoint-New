import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const engine = require("../dist/modules/observation/observation-trend.engine.js");

const reading = (id, at, value, unit, canonicalValue, canonicalUnit, sourceType = "MANUAL") => ({
  id,
  observedAt: new Date(at),
  value,
  unitCode: unit,
  canonicalValue,
  canonicalUnitCode: canonicalUnit,
  sourceType,
  sourceId: sourceType === "PROVIDER" ? "provider-1" : null,
  verificationStatus: sourceType === "PROVIDER" ? "PROVIDER_VERIFIED" : "PATIENT_DECLARED",
});

test("trend projection orders readings and computes canonical statistics", () => {
  const result = engine.buildObservationTrend([
    reading("b", "2026-09-19T10:00:00.000Z", 72, "BPM", 72, "BPM"),
    reading("a", "2026-09-18T10:00:00.000Z", 68, "BPM", 68, "BPM"),
  ]);
  assert.equal(result.state, "READY");
  assert.equal(result.series.length, 1);
  assert.equal(result.series[0].minimum, 68);
  assert.equal(result.series[0].maximum, 72);
  assert.equal(result.series[0].average, 70);
  assert.equal(result.table[0].observationId, "a");
});

test("trend projection never averages incompatible canonical units together", () => {
  const result = engine.buildObservationTrend([
    reading("a", "2026-09-18T10:00:00.000Z", 100, "MG_DL", 100, "MG_DL"),
    reading("b", "2026-09-19T10:00:00.000Z", 5.6, "MMOL_L", 5.6, "MMOL_L"),
  ]);
  assert.equal(result.unitConsistency, false);
  assert.equal(result.series.length, 2);
  assert.deepEqual(result.series.map((series) => series.canonicalUnitCode).sort(), ["MG_DL", "MMOL_L"]);
});

test("trend source filter is explicit and preserves provenance in accessible table", () => {
  const result = engine.buildObservationTrend([
    reading("patient", "2026-09-18T10:00:00.000Z", 70, "BPM", 70, "BPM", "MANUAL"),
    reading("provider", "2026-09-19T10:00:00.000Z", 72, "BPM", 72, "BPM", "PROVIDER"),
  ], "PROVIDER");
  assert.equal(result.table.length, 1);
  assert.equal(result.table[0].observationId, "provider");
  assert.equal(result.table[0].sourceType, "PROVIDER");
  assert.equal(result.table[0].sourceId, "provider-1");
  assert.equal(result.table[0].verificationStatus, "PROVIDER_VERIFIED");
  assert.equal(result.automatedDiagnosis, false);
});

test("trend source filter rejects unsupported provenance values", () => {
  assert.equal(engine.normalizeTrendSourceType(undefined), null);
  assert.equal(engine.normalizeTrendSourceType("device"), "DEVICE");
  assert.throws(() => engine.normalizeTrendSourceType("imported"), /MANUAL, DEVICE or PROVIDER/);
});

test("empty trend is explicit and carries no inferred normality", () => {
  const result = engine.buildObservationTrend([], null);
  assert.equal(result.state, "EMPTY");
  assert.deepEqual(result.series, []);
  assert.deepEqual(result.table, []);
  assert.equal(result.automatedDiagnosis, false);
});

console.log("V2 observation trend acceptance passed");
