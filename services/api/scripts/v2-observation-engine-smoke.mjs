import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  convertMeasurement,
  assertCanonicalRange,
  calculateBmi,
  isGlucoseMetricCode,
  normalizeGlucoseContext,
  normalizeObservedAt,
} = require("../dist/modules/observation/observation.engine.js");

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
assert.equal(glucose.originalValue, 5.5);
assert.equal(glucose.originalUnitCode, "MMOL_L");
assert.equal(glucose.canonicalValue, 99);
assert.equal(glucose.canonicalUnitCode, "MG_DL");

assert.equal(isGlucoseMetricCode("glucose"), true);
assert.equal(isGlucoseMetricCode("blood_glucose"), true);
assert.equal(isGlucoseMetricCode("capillary_glucose"), true);
assert.equal(isGlucoseMetricCode("heart_rate"), false);
assert.equal(normalizeGlucoseContext("BLOOD_GLUCOSE", "fasting"), "FASTING");
assert.equal(normalizeGlucoseContext("GLUCOSE", "preprandial"), "PREPRANDIAL");
assert.equal(normalizeGlucoseContext("CAPILLARY_GLUCOSE", "postprandial"), "POSTPRANDIAL");
assert.equal(normalizeGlucoseContext("GLUCOSE", "random"), "RANDOM");
assert.equal(normalizeGlucoseContext("HEART_RATE", undefined), null);
assert.throws(() => normalizeGlucoseContext("BLOOD_GLUCOSE", undefined), /required for glucose/);
assert.throws(() => normalizeGlucoseContext("BLOOD_GLUCOSE", "bedtime"), /FASTING, PREPRANDIAL, POSTPRANDIAL, or RANDOM/);
assert.throws(() => normalizeGlucoseContext("HEART_RATE", "FASTING"), /only valid for glucose/);

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

console.log("V2 observation conversion, contextual glucose and validation acceptance passed");
