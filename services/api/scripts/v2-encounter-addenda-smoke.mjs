import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const engine = require("../dist/modules/clinical/encounter-addendum.engine.js");

await import("./v2-data-corrections-smoke.mjs");

test("encounter addendum requires explicit reason and clinical text", () => {
  assert.deepEqual(engine.normalizeEncounterAddendumInput({
    reason: "Correct a documented date after chart review.",
    text: "The procedure date in the finalized note should read 2026-09-18.",
  }), {
    reason: "Correct a documented date after chart review.",
    text: "The procedure date in the finalized note should read 2026-09-18.",
  });
  assert.throws(() => engine.normalizeEncounterAddendumInput({ text: "Correction." }), /reason/);
  assert.throws(() => engine.normalizeEncounterAddendumInput({ reason: "Correction." }), /text/);
});

test("encounter addendum trims input without silently accepting empty text", () => {
  assert.deepEqual(engine.normalizeEncounterAddendumInput({
    reason: "  Clarification requested.  ",
    text: "  Follow-up instructions were clarified.  ",
  }), {
    reason: "Clarification requested.",
    text: "Follow-up instructions were clarified.",
  });
  assert.throws(() => engine.normalizeEncounterAddendumInput({ reason: " ", text: "Valid" }), /reason/);
  assert.throws(() => engine.normalizeEncounterAddendumInput({ reason: "Valid", text: " " }), /text/);
});

test("encounter addendum bounds reason and clinical text", () => {
  assert.throws(() => engine.normalizeEncounterAddendumInput({
    reason: "r".repeat(1001),
    text: "Valid clinical addendum.",
  }), /reason/);
  assert.throws(() => engine.normalizeEncounterAddendumInput({
    reason: "Correction.",
    text: "x".repeat(20001),
  }), /text/);
});

console.log("V2 encounter addendum acceptance passed");
