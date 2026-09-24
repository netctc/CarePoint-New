import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  convertMeasurement,
  assertCanonicalRange,
  calculateBmi,
  normalizeObservedAt,
} = require("../dist/modules/observation/observation.engine.js");

await import("./v2-lab-series-smoke.mjs");

const conversions = [
  { fromUnitCode: "LB", toUnitCode: "KG", multiplier: 0.45359237, offset: 0 },
  { fromUnitCode: "DEG_F", toUnitCode: "CEL", multiplier: 5 / 9, offset: -17.7777777778 },
  { fromUnitCode: "MMOL_L", toUnitCode: "MG_DL", multiplier: 18.0182, offset: 0 },
];

const weight = convertMeasurement(220.462, "LB", "KG", 2, conversions);
assert.equal(weight.canonicalUnitCode, "KG");
assert.equal(weight.canonicalValue, 100);

const temp = convertMeasurement(98.6, "DEG_F", "CEL", 1, conversions);
assert.equal(temp.canonicalValue, 37);

const glucose = convertMeasurement(5.5, "MMOL_L", "MG_DL", 0, conversions);
assert.equal(glucose.canonicalValue, 99);

const reverseWeight = convertMeasurement(100, "KG", "LB", 2, conversions);
assert.ok(Math.abs(reverseWeight.canonicalValue - 220.46) < 0.01);

assert.doesNotThrow(() => assertCanonicalRange(98, 30, 100));
assert.throws(() => assertCanonicalRange(101, 30, 100), /above the configured clinical range/);

assert.equal(calculateBmi(70, 175), 22.9);
assert.throws(() => calculateBmi(70, 0), /heightCm is invalid/);

const observed = normalizeObservedAt("2026-09-19T00:00:00.000Z", new Date("2026-09-19T00:04:00.000Z"));
assert.equal(observed.toISOString(), "2026-09-19T00:00:00.000Z");
assert.throws(
  () => normalizeObservedAt("2026-09-19T00:10:00.000Z", new Date("2026-09-19T00:00:00.000Z")),
  /five minutes in the future/,
);

console.log("V2 observation conversion and validation acceptance passed");

await import("./v2-terminology-smoke.mjs");

await import("./v2-admin-clinical-metrics-ui-smoke.mjs");
