import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  normalizeProviderFormPurpose,
  normalizeProviderFormContextType,
  normalizeProviderFormSchema,
  normalizeProviderFormAnswers,
  assertProviderFormPurposeContext,
} = require("../dist/modules/provider-category-forms/provider-form.engine.js");

const schema = normalizeProviderFormSchema({
  schemaVersion: 1,
  questions: [
    { id: "completed", type: "BOOLEAN", required: true, labels: { en: "Completed?" } },
    {
      id: "equipment",
      type: "MULTI_CHOICE",
      labels: { en: "Equipment" },
      options: [
        { value: "OXYGEN", labels: { en: "Oxygen" } },
        { value: "MONITORING", labels: { en: "Monitoring" } },
      ],
    },
  ],
});

test("provider form purposes and contexts are controlled", () => {
  assert.equal(normalizeProviderFormPurpose("service_completion"), "SERVICE_COMPLETION");
  assert.equal(normalizeProviderFormContextType("appointment"), "APPOINTMENT");
  assert.throws(() => normalizeProviderFormPurpose("arbitrary"), /Unsupported provider form purpose/);
});

test("provider form answers reuse deterministic questionnaire validation", () => {
  const answers = normalizeProviderFormAnswers(schema, {
    completed: true,
    equipment: ["MONITORING", "OXYGEN"],
  });
  assert.deepEqual(answers.equipment, ["OXYGEN", "MONITORING"]);
});

test("form purpose is bound to an authorized operational context", () => {
  assert.doesNotThrow(() => assertProviderFormPurposeContext("HOME_VISIT", "APPOINTMENT", "HOME_VISIT"));
  assert.throws(
    () => assertProviderFormPurposeContext("HOME_VISIT", "APPOINTMENT", "CLINIC"),
    /HOME_VISIT forms require/,
  );
  assert.throws(
    () => assertProviderFormPurposeContext("TRANSPORT_EQUIPMENT", "APPOINTMENT", "HOME_VISIT"),
    /medical transport context/,
  );
});

console.log("V2 provider category forms acceptance passed");
