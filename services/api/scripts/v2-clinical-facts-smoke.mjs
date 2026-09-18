import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  normalizeClinicalFactKind,
  normalizeClinicalFactPayload,
  mergeClinicalFactPayload,
  normalizeDoctorVerification,
  normalizeMedicationReconciliation,
} = require("../dist/modules/clinical-facts/clinical-fact.engine.js");

test("clinical fact kinds are controlled", () => {
  assert.equal(normalizeClinicalFactKind(" allergy "), "ALLERGY");
  assert.throws(() => normalizeClinicalFactKind("free-text-kind"), /Unsupported clinical fact kind/);
});

test("allergy payload is normalized without inference", () => {
  const row = normalizeClinicalFactPayload("ALLERGY", {
    label: " Penicillin ",
    category: "medication",
    reaction: "Rash",
    severity: "moderate",
  });
  assert.deepEqual(row, {
    label: "Penicillin",
    category: "MEDICATION",
    reaction: "Rash",
    severity: "MODERATE",
  });
});

test("medication payload and reconciliation statuses are deterministic", () => {
  const row = normalizeClinicalFactPayload("MEDICATION", {
    name: "Metformin",
    strength: "500 mg",
    schedule: "Twice daily",
  });
  assert.equal(row.name, "Metformin");
  assert.equal(normalizeMedicationReconciliation("confirmed"), "CONFIRMED");
  assert.equal(normalizeDoctorVerification("verified"), "VERIFIED");
  assert.throws(() => normalizeMedicationReconciliation("probably"), /Unsupported reconciliationStatus/);
});

test("problem updates expose changed field names only", () => {
  const current = normalizeClinicalFactPayload("PROBLEM", {
    label: "Hypertension",
    clinicalStatus: "ACTIVE",
    onsetDate: "2025-01-01",
  });
  const changed = mergeClinicalFactPayload("PROBLEM", current, {
    clinicalStatus: "RESOLVED",
  });
  assert.deepEqual(changed.changedFields, ["clinicalStatus"]);
  assert.equal(changed.payload.label, "Hypertension");
  assert.equal(changed.payload.clinicalStatus, "RESOLVED");
});

test("unsupported or malformed clinical content is rejected", () => {
  assert.throws(
    () => normalizeClinicalFactPayload("PROBLEM", { label: "Condition", diagnosisConfidence: 0.9 }),
    /Unsupported PROBLEM field/,
  );
  assert.throws(
    () => normalizeClinicalFactPayload("PROCEDURE", { label: "Procedure", occurredDate: "2026-02-30" }),
    /occurredDate is invalid/,
  );
});

console.log("V2 clinical facts engine acceptance passed");
