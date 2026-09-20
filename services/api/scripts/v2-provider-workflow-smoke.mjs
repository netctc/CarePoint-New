import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  normalizeWorkflowReasonCode,
  normalizeTransportEquipmentConfirmation,
} = require("../dist/modules/provider-workflow/provider-workflow.engine.js");

test("transport rejection reason is a structured token", () => {
  assert.equal(normalizeWorkflowReasonCode("not_available"), "NOT_AVAILABLE");
  assert.throws(() => normalizeWorkflowReasonCode("free text reason"), /reasonCode is invalid/);
});

test("transport equipment confirmation must exactly match requirements", () => {
  assert.deepEqual(
    normalizeTransportEquipmentConfirmation(
      ["OXYGEN", "MONITORING"],
      ["MONITORING", "OXYGEN"],
    ),
    ["MONITORING", "OXYGEN"],
  );
  assert.throws(
    () => normalizeTransportEquipmentConfirmation(["OXYGEN"], []),
    /exactly match/,
  );
  assert.throws(
    () => normalizeTransportEquipmentConfirmation(["OXYGEN"], ["INVALID"]),
    /Unsupported equipment value/,
  );
});

console.log("V2 provider workflow acceptance passed");
