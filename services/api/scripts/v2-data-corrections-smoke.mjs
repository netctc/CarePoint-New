import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const engine = require("../dist/modules/clinical-profile/data-correction.engine.js");

test("patient correction request binds to an exact clinical entry version", () => {
  assert.deepEqual(engine.normalizeCreateDataCorrectionInput({
    entryId: "entry-1",
    expectedEntryVersion: 3,
    reasonCode: "incorrect",
    note: "The recorded dose is incorrect.",
  }), {
    entryId: "entry-1",
    expectedEntryVersion: 3,
    reasonCode: "INCORRECT",
    note: "The recorded dose is incorrect.",
  });
  assert.throws(() => engine.normalizeCreateDataCorrectionInput({
    entryId: "entry-1",
    expectedEntryVersion: 0,
    reasonCode: "INCORRECT",
    note: "Correction requested.",
  }), /positive integer/);
});

test("provider correction decision requires optimistic versions and explicit reason", () => {
  assert.throws(() => engine.normalizeDecideDataCorrectionInput({
    requestId: "request-1",
    action: "REJECT_REQUEST",
    expectedRequestVersion: 1,
    expectedEntryVersion: 2,
  }), /reason/);
  assert.deepEqual(engine.normalizeDecideDataCorrectionInput({
    requestId: "request-1",
    action: "REQUEST_CLARIFICATION",
    expectedRequestVersion: 1,
    expectedEntryVersion: 2,
    reason: "Please confirm the source document.",
  }), {
    requestId: "request-1",
    action: "REQUEST_CLARIFICATION",
    expectedRequestVersion: 1,
    expectedEntryVersion: 2,
    reason: "Please confirm the source document.",
    correctedData: null,
    correctedStatus: null,
  });
});

test("corrected data is only accepted for resolution", () => {
  assert.throws(() => engine.normalizeDecideDataCorrectionInput({
    requestId: "request-1",
    action: "REQUEST_CLARIFICATION",
    expectedRequestVersion: 1,
    expectedEntryVersion: 2,
    reason: "Clarification required.",
    correctedData: { name: "Example" },
  }), /only allowed/);
  assert.throws(() => engine.normalizeDecideDataCorrectionInput({
    requestId: "request-1",
    action: "RESOLVE_CORRECTION",
    expectedRequestVersion: 1,
    expectedEntryVersion: 2,
    reason: "Correction accepted.",
  }), /correctedData is required/);
});

test("correction state machine is forward-only", () => {
  assert.equal(engine.targetCorrectionStatus("OPEN", "REQUEST_CLARIFICATION"), "CLARIFICATION_REQUESTED");
  assert.equal(engine.targetCorrectionStatus("CLARIFICATION_REQUESTED", "RESOLVE_CORRECTION"), "RESOLVED");
  assert.equal(engine.targetCorrectionStatus("OPEN", "REJECT_REQUEST"), "REJECTED");
  assert.throws(() => engine.targetCorrectionStatus("RESOLVED", "RESOLVE_CORRECTION"), /not allowed/);
  assert.throws(() => engine.targetCorrectionStatus("REJECTED", "REQUEST_CLARIFICATION"), /not allowed/);
});

console.log("V2 data correction acceptance passed");
