import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { buildLaboratorySeries, comparableAnalyteKey } = require("../dist/modules/orders/lab-series.engine.js");

const order = ({
  orderId,
  resultId,
  status,
  observations,
  validatedAt = "2026-09-18T10:00:00.000Z",
  releasedAt = null,
  providerId = "provider-1",
}) => ({
  id: orderId,
  type: "LABORATORY",
  providerId,
  signedAt: "2026-09-18T08:00:00.000Z",
  completedAt: releasedAt,
  labResult: {
    id: resultId,
    status,
    validatedAt,
    releasedAt,
    data: { observations },
  },
});

const analyte = ({
  display = "Hemoglobin",
  codeSystem = "LOINC",
  code = "718-7",
  value = 13.5,
  unit = "g/dL",
  referenceRange = "12.0-16.0",
  flag = "NORMAL",
} = {}) => ({ display, codeSystem, code, value, unit, referenceRange, flag });

test("laboratory series excludes ENTERED results and includes validated/released results", () => {
  const result = buildLaboratorySeries([
    order({ orderId: "entered-order", resultId: "entered-result", status: "ENTERED", observations: [analyte()] }),
    order({ orderId: "validated-order", resultId: "validated-result", status: "VALIDATED", observations: [analyte()] }),
    order({
      orderId: "released-order",
      resultId: "released-result",
      status: "RELEASED",
      releasedAt: "2026-09-19T10:00:00.000Z",
      observations: [analyte({ value: 13.8 })],
    }),
  ]);

  assert.equal(result.state, "READY");
  assert.equal(result.series.length, 1);
  assert.equal(result.pointCount, 2);
  assert.deepEqual(result.series[0].points.map((point) => point.laboratoryResultId), ["validated-result", "released-result"]);
  assert.equal(result.series[0].points.some((point) => point.orderId === "entered-order"), false);
});

test("each point preserves exact source links, original range, flag and lifecycle timestamps", () => {
  const result = buildLaboratorySeries([
    order({
      orderId: "order-1",
      resultId: "result-1",
      status: "RELEASED",
      validatedAt: "2026-09-18T10:00:00.000Z",
      releasedAt: "2026-09-18T11:00:00.000Z",
      observations: [analyte({ value: "13.7", referenceRange: "12-16", flag: "H" })],
    }),
  ]);
  const point = result.series[0].points[0];
  assert.equal(point.orderId, "order-1");
  assert.equal(point.laboratoryResultId, "result-1");
  assert.equal(point.value, "13.7");
  assert.equal(point.unit, "g/dL");
  assert.equal(point.referenceRange, "12-16");
  assert.equal(point.flag, "H");
  assert.equal(point.status, "RELEASED");
  assert.equal(point.validatedAt, "2026-09-18T10:00:00.000Z");
  assert.equal(point.releasedAt, "2026-09-18T11:00:00.000Z");
  assert.equal(point.orderingProviderId, "provider-1");
});

test("structured analyte codes group comparable results while incompatible units remain separate", () => {
  const result = buildLaboratorySeries([
    order({ orderId: "order-a", resultId: "result-a", status: "VALIDATED", observations: [analyte({ unit: "g/dL", value: 13.5 })] }),
    order({ orderId: "order-b", resultId: "result-b", status: "RELEASED", observations: [analyte({ unit: "g/dL", value: 13.8 })] }),
    order({ orderId: "order-c", resultId: "result-c", status: "VALIDATED", observations: [analyte({ unit: "g/L", value: 135 })] }),
  ]);

  assert.equal(result.series.length, 2);
  const gramsPerDeciliter = result.series.find((series) => series.unit === "g/dL");
  const gramsPerLiter = result.series.find((series) => series.unit === "g/L");
  assert.equal(gramsPerDeciliter.points.length, 2);
  assert.equal(gramsPerLiter.points.length, 1);
  assert.equal(gramsPerDeciliter.analyteKey, gramsPerLiter.analyteKey);
});

test("display fallback groups uncoded analytes deterministically", () => {
  assert.equal(comparableAnalyteKey(" Serum Creatinine ", null, null), "DISPLAY:SERUM CREATININE");
  const result = buildLaboratorySeries([
    order({
      orderId: "order-a",
      resultId: "result-a",
      status: "VALIDATED",
      observations: [analyte({ display: "Serum Creatinine", codeSystem: null, code: null, unit: "mg/dL", value: 1.0 })],
    }),
    order({
      orderId: "order-b",
      resultId: "result-b",
      status: "VALIDATED",
      observations: [analyte({ display: "  serum   creatinine ", codeSystem: null, code: null, unit: "mg/dL", value: 1.1 })],
    }),
  ]);
  assert.equal(result.series.length, 1);
  assert.equal(result.series[0].points.length, 2);
});

test("laboratory points are chronological and empty input is explicit", () => {
  const result = buildLaboratorySeries([
    order({
      orderId: "later",
      resultId: "later-result",
      status: "RELEASED",
      validatedAt: "2026-09-19T10:00:00.000Z",
      releasedAt: "2026-09-19T11:00:00.000Z",
      observations: [analyte()],
    }),
    order({
      orderId: "earlier",
      resultId: "earlier-result",
      status: "VALIDATED",
      validatedAt: "2026-09-18T10:00:00.000Z",
      observations: [analyte()],
    }),
  ]);
  assert.deepEqual(result.series[0].points.map((point) => point.orderId), ["earlier", "later"]);

  const empty = buildLaboratorySeries([]);
  assert.equal(empty.state, "EMPTY");
  assert.equal(empty.pointCount, 0);
  assert.deepEqual(empty.series, []);
  assert.equal(empty.automatedClinicalInference, false);
});

console.log("V2 validated laboratory series acceptance passed");
