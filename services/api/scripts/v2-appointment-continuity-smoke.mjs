import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const engine = require("../dist/modules/appointment-continuity/appointment-continuity.engine.js");

test("preparation readiness only blocks on explicitly required pending tasks", () => {
  assert.deepEqual(
    engine.readinessProjection([
      { code: "DEVICE_CHECK", required: true, status: "COMPLETED" },
      { code: "PREPARE_QUESTIONS", required: false, status: "PENDING" },
    ]),
    { ready: true, requiredCount: 1, completedRequiredCount: 1, missingRequiredCodes: [], completionPercent: 100 },
  );
  assert.equal(engine.readinessProjection([{ code: "VITALS", required: true, status: "PENDING" }]).ready, false);
});

test("follow-up normalization never creates an appointment implicitly", () => {
  assert.deepEqual(engine.normalizeFollowUpPayload({ recommendedAfterDays: 30, modality: "telemedicine", reasonCode: "routine_review", careTaskIds: [] }), {
    recommendedAfterDays: 30,
    modality: "TELEMEDICINE",
    reasonCode: "ROUTINE_REVIEW",
    careTaskIds: [],
  });
});

test("preparation task vocabulary is deterministic", () => {
  const item = engine.normalizePrepTask({ code: "blood_pressure", taskType: "observation", required: true });
  assert.equal(item.code, "BLOOD_PRESSURE");
  assert.equal(item.taskType, "OBSERVATION");
  assert.equal(item.required, true);
  assert.throws(() => engine.normalizePrepTask({ code: "x", taskType: "ARBITRARY" }), /invalid/);
});

console.log("V2 appointment continuity acceptance passed");
