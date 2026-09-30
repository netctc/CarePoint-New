import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const observation = require("../dist/modules/observation/observation.engine.js");
const provider = require("../dist/modules/observation/provider-observation.engine.js");
const trend = require("../dist/modules/observation/observation-trend.engine.js");

test("DOC-060 recognizes glucose metrics without broadening unrelated metrics", () => {
  assert.equal(observation.isGlucoseMetricCode("glucose"), true);
  assert.equal(observation.isGlucoseMetricCode("blood_glucose"), true);
  assert.equal(observation.isGlucoseMetricCode("capillary_glucose"), true);
  assert.equal(observation.isGlucoseMetricCode("heart_rate"), false);
});

test("DOC-060 requires one explicit meal context for glucose and forbids it elsewhere", () => {
  assert.equal(observation.normalizeGlucoseContext("BLOOD_GLUCOSE", "fasting"), "FASTING");
  assert.equal(observation.normalizeGlucoseContext("GLUCOSE", "preprandial"), "PREPRANDIAL");
  assert.equal(observation.normalizeGlucoseContext("CAPILLARY_GLUCOSE", "postprandial"), "POSTPRANDIAL");
  assert.equal(observation.normalizeGlucoseContext("GLUCOSE", "random"), "RANDOM");
  assert.equal(observation.normalizeGlucoseContext("HEART_RATE", undefined), null);
  assert.throws(
    () => observation.normalizeGlucoseContext("BLOOD_GLUCOSE", undefined),
    /required for glucose/,
  );
  assert.throws(
    () => observation.normalizeGlucoseContext("BLOOD_GLUCOSE", "BEDTIME"),
    /FASTING, PREPRANDIAL, POSTPRANDIAL, or RANDOM/,
  );
  assert.throws(
    () => observation.normalizeGlucoseContext("HEART_RATE", "FASTING"),
    /only valid for glucose/,
  );
});

test("provider observation normalization applies the exact same glucose-context contract", () => {
  assert.deepEqual(provider.normalizeProviderObservationInput({
    code: "blood_glucose",
    value: 5.8,
    unitCode: "mmol_l",
    observedAt: "2026-09-19T10:00:00.000Z",
    glucoseContext: "postprandial",
  }), {
    code: "BLOOD_GLUCOSE",
    value: 5.8,
    unitCode: "MMOL_L",
    observedAt: "2026-09-19T10:00:00.000Z",
    encounterId: null,
    glucoseContext: "POSTPRANDIAL",
  });
  assert.throws(() => provider.normalizeProviderObservationInput({
    code: "BLOOD_GLUCOSE",
    value: 100,
    unitCode: "MG_DL",
    observedAt: "2026-09-19T10:00:00.000Z",
  }), /required for glucose/);
});

test("trend projection preserves exact context while keeping incompatible units separate", () => {
  const base = {
    value: 5.5,
    unitCode: "MMOL_L",
    sourceType: "MANUAL",
    sourceId: null,
    verificationStatus: "PATIENT_DECLARED",
  };
  const result = trend.buildObservationTrend([
    {
      ...base,
      id: "fasting",
      observedAt: new Date("2026-09-18T07:00:00.000Z"),
      canonicalValue: 99,
      canonicalUnitCode: "MG_DL",
      glucoseContext: "FASTING",
    },
    {
      ...base,
      id: "post",
      observedAt: new Date("2026-09-18T09:00:00.000Z"),
      canonicalValue: 130,
      canonicalUnitCode: "MG_DL",
      glucoseContext: "POSTPRANDIAL",
    },
    {
      ...base,
      id: "other-unit",
      observedAt: new Date("2026-09-18T10:00:00.000Z"),
      canonicalValue: 7.3,
      canonicalUnitCode: "MMOL_L",
      glucoseContext: "RANDOM",
    },
  ]);
  assert.equal(result.unitConsistency, false);
  assert.equal(result.table[0].glucoseContext, "FASTING");
  assert.equal(result.table[1].glucoseContext, "POSTPRANDIAL");
  assert.equal(result.series.find((item) => item.canonicalUnitCode === "MG_DL").points[0].glucoseContext, "FASTING");
});

test("historical payloads remain backward-compatible and presentation defaults context to null", () => {
  const patientService = readFileSync(new URL("../src/modules/observation/observation.service.ts", import.meta.url), "utf8");
  const providerService = readFileSync(new URL("../src/modules/observation/provider-observation.service.ts", import.meta.url), "utf8");
  assert.match(patientService, /glucoseContext: payload\.glucoseContext \?\? null/);
  assert.match(providerService, /glucoseContext: payload\.glucoseContext \?\? null/);
  assert.match(patientService, /encryptRecord\(payload\)/);
  assert.match(providerService, /encryptRecord\(payload\)/);
  assert.doesNotMatch(patientService, /glucoseContext.*audit/i);
  assert.doesNotMatch(providerService, /glucoseContext.*metadata/i);
});

console.log("DOC-060 contextual glucose observation acceptance passed");
