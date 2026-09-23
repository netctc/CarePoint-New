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


const reviewModel = readFileSync(new URL("../prisma/v2_questionnaire_reviews.prisma", import.meta.url), "utf8");
const reviewMigration = readFileSync(
  new URL("../prisma/migrations/20260919111000_v2_questionnaire_reviews/migration.sql", import.meta.url),
  "utf8",
);
const reviewService = readFileSync(
  new URL("../src/modules/questionnaire/questionnaire-review.service.ts", import.meta.url),
  "utf8",
);
const questionnaireModule = readFileSync(
  new URL("../src/modules/questionnaire/questionnaire.module.ts", import.meta.url),
  "utf8",
);

assert.match(reviewModel, /@@unique\(\[responseId, providerId\]\)/);
assert.match(reviewModel, /responseSequence\s+Int/);
assert.match(reviewMigration, /FOREIGN KEY \("responseId"\) REFERENCES "QuestionnaireResponse"\("id"\)/);
assert.match(reviewMigration, /FOREIGN KEY \("patientId"\) REFERENCES "PatientProfile"\("id"\)/);
assert.match(reviewMigration, /FOREIGN KEY \("providerId"\) REFERENCES "Provider"\("id"\)/);
assert.doesNotMatch(reviewMigration, /\bDROP\b/i);
assert.match(reviewService, /questionnaireResponseReview\.upsert/);
assert.match(reviewService, /update:\s*\{\}/);
assert.match(reviewService, /responseSequence:\s*context\.response\.sequence/);
assert.match(reviewService, /QUESTIONNAIRE_RESPONSE_REVIEWED/);
assert.doesNotMatch(reviewService, /questionnaireResponse\.update/);
assert.doesNotMatch(reviewService, /\banswers\b/);
assert.doesNotMatch(reviewService, /\bciphertext\b/);
assert.match(questionnaireModule, /@Get\(":patientId\/questionnaires\/:code\/responses\/:responseId\/review"\)/);
assert.match(questionnaireModule, /@Post\(":patientId\/questionnaires\/:code\/responses\/:responseId\/review"\)/);

console.log("V2 questionnaire engine + ADM-077 compliance + immutable review acceptance passed");

await import("./v2-doctor-questionnaire-request-ui-smoke.mjs");

await import("./v2-patient-questionnaire-status-ui-smoke.mjs");
await import("./v2-patient-social-history-smoke.mjs");
