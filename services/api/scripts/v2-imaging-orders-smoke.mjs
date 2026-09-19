import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const engine = require("../dist/modules/orders/imaging-order.engine.js");

test("imaging order normalization keeps modality and defaults priority", () => {
  const result = engine.normalizeImagingOrderInput({
    idempotencyKey: "imaging-acceptance-0001",
    modality: "MRI",
    reason: "Evaluate persistent symptoms.",
  });
  assert.equal(result.modality, "MRI");
  assert.equal(result.priority, "ROUTINE");
  assert.equal(result.appointmentId, null);
});

test("imaging order supports controlled STAT priority", () => {
  const result = engine.normalizeImagingOrderInput({
    idempotencyKey: "imaging-acceptance-0002",
    modality: "CT",
    priority: "STAT",
    reason: "Urgent diagnostic assessment.",
  });
  assert.equal(result.priority, "STAT");
});

test("imaging order rejects invalid modality and missing reason", () => {
  assert.throws(() => engine.normalizeImagingOrderInput({
    idempotencyKey: "imaging-acceptance-0003",
    modality: "UNKNOWN",
    reason: "Diagnostic assessment.",
  }), /modality/);
  assert.throws(() => engine.normalizeImagingOrderInput({
    idempotencyKey: "imaging-acceptance-0004",
    modality: "XRAY",
  }), /reason/);
});

test("imaging order idempotency key is bounded", () => {
  assert.throws(() => engine.normalizeImagingOrderInput({
    idempotencyKey: "short",
    modality: "XRAY",
    reason: "Diagnostic assessment.",
  }), /idempotencyKey/);
});

test("imaging cancellation requires optimistic concurrency version", () => {
  assert.throws(() => engine.normalizeImagingOrderAction({ action: "CANCEL" }), /expectedVersion/);
  assert.deepEqual(engine.normalizeImagingOrderAction({ action: "CANCEL", expectedVersion: 2 }), { action: "CANCEL", expectedVersion: 2 });
});

console.log("V2 imaging order acceptance passed");
