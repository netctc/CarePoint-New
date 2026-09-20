import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const engine = require("../dist/modules/refill/refill.engine.js");

test("refill allowance is deterministic and bounded by the source prescription", () => {
  assert.deepEqual(engine.refillAllowance(2, 0), { refillsAllowed: 2, approvedCount: 0, remaining: 2, eligible: true });
  assert.deepEqual(engine.refillAllowance(2, 2), { refillsAllowed: 2, approvedCount: 2, remaining: 0, eligible: false });
});

test("approval requires explicit confirmation", () => {
  assert.throws(() => engine.normalizeRefillReviewInput({ action: "APPROVE", expectedVersion: 1 }), /confirm=true/);
  assert.equal(engine.normalizeRefillReviewInput({ action: "APPROVE", expectedVersion: 1, confirm: true }).action, "APPROVE");
});

test("decline requires a patient-visible reason", () => {
  assert.throws(() => engine.normalizeRefillReviewInput({ action: "DECLINE", expectedVersion: 1 }), /reason/);
  const result = engine.normalizeRefillReviewInput({ action: "DECLINE", expectedVersion: 1, reason: "Not clinically appropriate at this time." });
  assert.equal(result.action, "DECLINE");
  assert.equal(result.reason, "Not clinically appropriate at this time.");
});

test("patient refill request reason remains optional", () => {
  assert.deepEqual(engine.normalizeRefillRequestInput({}), { reason: null });
});

console.log("V2 refill workflow acceptance passed");
