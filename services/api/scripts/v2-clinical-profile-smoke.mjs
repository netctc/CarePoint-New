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
  substance: "Penicillin",
  reaction: "Rash",
  severity: "MODERATE",
});

const condition = normalizeClinicalProfilePayload("CONDITION", {
  display: "Hypertension",
  codeSystem: "ICD-10",
  code: "I10",
  clinicalStatus: "active",
  onsetDate: "2024-02-01",
});
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
  () => normalizeClinicalProfilePayload("CONDITION", { display: "" }),
  /display is invalid/,
);
assert.throws(
  () => normalizeClinicalProfileStatus("deleted"),
  /Unsupported clinical profile entry status/,
);

console.log("V2 longitudinal clinical-profile entry validation passed");

await import("./v2-clinical-history-smoke.mjs");
await import("./v2-emergency-access-smoke.mjs");
