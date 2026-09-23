import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  normalizeQuestionnaireSchema,
  normalizeActivationRules,
  normalizeQuestionnaireAnswers,
  diffQuestionnaireAnswers,
  evaluateQuestionnaireActivation,
} = require("../dist/modules/questionnaire/questionnaire.engine.js");

const schema = normalizeQuestionnaireSchema({
  schemaVersion: 1,
  questions: [
    { id: "health_changed", type: "BOOLEAN", required: true, labels: { en: "Has your health changed?" } },
    { id: "pain_score", type: "NUMBER", required: true, min: 0, max: 10, labels: { en: "Pain score" } },
    {
      id: "symptoms",
      type: "MULTI_CHOICE",
      labels: { en: "Symptoms" },
      options: [
        { value: "FATIGUE", labels: { en: "Fatigue" } },
        { value: "COUGH", labels: { en: "Cough" } },
      ],
    },
    { id: "notes", type: "TEXT", maxLength: 120, labels: { en: "Notes" } },
  ],
});

const first = normalizeQuestionnaireAnswers(schema, {
  health_changed: false,
  pain_score: 1,
  symptoms: ["COUGH", "FATIGUE"],
  notes: " Stable ",
});
assert.deepEqual(first.symptoms, ["FATIGUE", "COUGH"]);
assert.equal(first.notes, "Stable");

const second = normalizeQuestionnaireAnswers(schema, {
  health_changed: true,
  pain_score: 4,
  symptoms: ["FATIGUE"],
  notes: "New discomfort",
});
const diff = diffQuestionnaireAnswers(first, second);
assert.deepEqual(diff.changedQuestionIds, ["health_changed", "notes", "pain_score", "symptoms"]);
assert.equal(diff.changes.length, 4);

assert.throws(
  () => normalizeQuestionnaireAnswers(schema, { health_changed: true, pain_score: 11 }),
  /above its maximum/,
);
assert.throws(
  () => normalizeQuestionnaireSchema({ schemaVersion: 1, questions: [
    { id: "duplicate", type: "BOOLEAN", labels: { en: "One" } },
    { id: "duplicate", type: "BOOLEAN", labels: { en: "Two" } },
  ] }),
  /duplicate questionnaire question id/,
);

const rules = normalizeActivationRules({ dueIfNoResponse: true, repeatDays: 30, askHealthChanged: true });
assert.deepEqual(
  evaluateQuestionnaireActivation(rules, null, new Date("2026-09-19T00:00:00Z")),
  { due: true, reason: "NO_RESPONSE", askHealthChanged: false },
);
const periodic = evaluateQuestionnaireActivation(
  rules,
  new Date("2026-08-01T00:00:00Z"),
  new Date("2026-09-19T00:00:00Z"),
);
assert.equal(periodic.due, true);
assert.equal(periodic.reason, "PERIODIC_REVIEW");
assert.equal(periodic.askHealthChanged, true);

const recent = evaluateQuestionnaireActivation(
  rules,
  new Date("2026-09-10T00:00:00Z"),
  new Date("2026-09-19T00:00:00Z"),
);
assert.equal(recent.due, false);
assert.equal(recent.askHealthChanged, true);

const complianceSource = readFileSync(
  new URL("../src/modules/admin-questionnaire-compliance/admin-questionnaire-compliance.module.ts", import.meta.url),
  "utf8",
);
assert.match(complianceSource, /aggregateOnly:\s*true/);
assert.match(complianceSource, /encryptedQuestionnairePayloadNotRead:\s*true/);
assert.match(complianceSource, /Cache-Control/);
assert.match(complianceSource, /ADMIN_QUESTIONNAIRE_COMPLIANCE_READ/);
assert.doesNotMatch(complianceSource, /\.ciphertext\b|decryptResponse|ClinicalEnvelopeService/);
assert.doesNotMatch(complianceSource, /firstName|lastName|email/);

const monitorSource = readFileSync(
  new URL("../../../apps/admin/components/QuestionnaireComplianceMonitor.tsx", import.meta.url),
  "utf8",
);
assert.match(monitorSource, /\/api\/admin\/analytics\/questionnaires/);
assert.match(monitorSource, /Questionnaire compliance monitor/);

console.log("V2 questionnaire engine + ADM-077 compliance acceptance passed");

await import("./v2-doctor-questionnaire-request-ui-smoke.mjs");

await import("./v2-patient-questionnaire-status-ui-smoke.mjs");
