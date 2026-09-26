import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  normalizeClinicalProfileKind,
  normalizeClinicalProfileStatus,
  normalizeClinicalProfilePayload,
  changedClinicalProfileFields,
} = require("../dist/modules/clinical-profile/clinical-profile.engine.js");

assert.equal(normalizeClinicalProfileKind("allergy"), "ALLERGY");
assert.equal(normalizeClinicalProfileStatus(undefined), "ACTIVE");

const allergy = normalizeClinicalProfilePayload("ALLERGY", {
  substance: "Penicillin",
  reaction: "Rash",
  severity: "moderate",
});
assert.deepEqual(allergy, {
  kind: "ALLERGY",
  classification: "ALLERGY",
  substance: "Penicillin",
  reaction: "Rash",
  severity: "MODERATE",
});

const intolerance = normalizeClinicalProfilePayload("ALLERGY", {
  classification: "intolerance",
  substance: "Synthetic ingredient",
});
assert.equal(intolerance.classification, "INTOLERANCE");

const condition = normalizeClinicalProfilePayload("CONDITION", {
  display: "Hypertension",
  codeSystem: "ICD-10",
  code: "I10",
  clinicalStatus: "active",
  onsetDate: "2024-02-01",
});

const linkedCondition = normalizeClinicalProfilePayload("CONDITION", {
  display: "Hypertension",
  clinicalStatus: "active",
  encounterId: "enc-1",
  documentIds: ["doc-1", "doc-1", "doc-2"],
  carePlanIds: ["plan-1"],
});
assert.equal(linkedCondition.kind, "CONDITION");
assert.equal(linkedCondition.encounterId, "enc-1");
assert.deepEqual(linkedCondition.documentIds, ["doc-1", "doc-2"]);
assert.deepEqual(linkedCondition.carePlanIds, ["plan-1"]);
const updatedCondition = normalizeClinicalProfilePayload("CONDITION", {
  clinicalStatus: "resolved",
}, condition);
assert.equal(updatedCondition.display, "Hypertension");
assert.equal(updatedCondition.clinicalStatus, "RESOLVED");
assert.deepEqual(changedClinicalProfileFields(condition, updatedCondition), ["clinicalStatus"]);

const medication = normalizeClinicalProfilePayload("MEDICATION", {
  name: "Synthetic medicine",
  dose: "10 mg",
  medicationStatus: "active",
  startedOn: "2026-01-01",
});
assert.equal(medication.kind, "MEDICATION");
assert.equal(medication.medicationStatus, "ACTIVE");

assert.throws(
  () => normalizeClinicalProfilePayload("ALLERGY", { substance: "A", secretExtra: "x" }),
  /Unsupported clinical profile field/,
);
assert.throws(
  () => normalizeClinicalProfilePayload("ALLERGY", { classification: "sensitivity", substance: "A" }),
  /classification is invalid/,
);
assert.throws(
  () => normalizeClinicalProfilePayload("CONDITION", { display: "" }),
  /display is invalid/,
);
assert.throws(
  () => normalizeClinicalProfilePayload("CONDITION", { display: "X", documentIds: ["bad id with spaces"] }),
  /documentIds\[0\] is invalid/,
);
assert.throws(
  () => normalizeClinicalProfileStatus("deleted"),
  /Unsupported clinical profile entry status/,
);

console.log("V2 longitudinal clinical-profile entry validation passed");

await import("./v2-clinical-history-smoke.mjs");
await import("./v2-emergency-access-smoke.mjs");

await import("./v2-patient-extended-clinical-profile-smoke.mjs");

await import("./v2-medication-reconciliation-smoke.mjs");
await import("./v2-allergy-reconciliation-smoke.mjs");
await import("./v2-problem-list-smoke.mjs");
