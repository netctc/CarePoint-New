import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  normalizeProviderFormCode,
  normalizeProviderFormPurpose,
  normalizeProviderFormContext,
  normalizeOptionalContextId,
} = require("../dist/modules/provider-category-forms/provider-category-form.engine.js");

test("provider form identifiers and purposes are controlled", () => {
  assert.equal(normalizeProviderFormCode(" home_visit_check "), "HOME_VISIT_CHECK");
  assert.equal(normalizeProviderFormPurpose("home_visit_completion"), "HOME_VISIT_COMPLETION");
  assert.throws(() => normalizeProviderFormPurpose("arbitrary"), /Unsupported provider form purpose/);
});

test("provider form contexts require deterministic assignment identifiers", () => {
  assert.equal(normalizeProviderFormContext("transport"), "TRANSPORT");
  assert.equal(normalizeOptionalContextId("transport-123", "TRANSPORT"), "transport-123");
  assert.equal(normalizeOptionalContextId(null, "GENERAL"), null);
  assert.throws(() => normalizeOptionalContextId("unexpected", "GENERAL"), /cannot bind a contextId/);
  assert.throws(() => normalizeOptionalContextId(null, "HOME_VISIT"), /contextId is required/);
});
