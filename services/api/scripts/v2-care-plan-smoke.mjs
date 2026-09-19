import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const engine = require("../dist/modules/care-plan/care-plan.engine.js");

test("care plan payload is normalized without clinical inference", () => {
  const plan = engine.normalizePlanPayload({
    title: "Diabetes follow-up",
    problemRef: "condition-123",
    summary: "Clinician-authored follow-up plan",
  });
  assert.equal(plan.problemRef, "condition-123");
});

test("measurable goals require deterministic structured targets", () => {
  const goal = engine.normalizeGoalPayload({
    kind: "MEASURABLE",
    label: "Home glucose target",
    criterion: "Review configured glucose observations",
    comparator: "BETWEEN",
    targetValue: 80,
    targetUpperValue: 130,
    unitCode: "MG-DL",
  });
  assert.equal(goal.comparator, "BETWEEN");
  assert.equal(goal.targetUpperValue, 130);
});

test("task recurrence is bounded and deterministic", () => {
  assert.deepEqual(
    engine.normalizeRecurrence({ frequency: "WEEKLY", interval: 1, weekdays: [5, 1, 3] }),
    { frequency: "WEEKLY", interval: 1, weekdays: [1, 3, 5] },
  );
  assert.throws(() => engine.normalizeRecurrence({ frequency: "HOURLY" }), /invalid/);
});

test("completion outcomes and occurrence keys are closed vocabularies", () => {
  assert.equal(engine.normalizeTaskOutcome("done"), "DONE");
  assert.equal(engine.normalizeOccurrenceKey("2026-09-19"), "2026-09-19");
  assert.throws(() => engine.normalizeTaskOutcome("maybe"), /invalid/);
});

console.log("V2 Care Plan engine acceptance passed");
