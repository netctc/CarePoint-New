import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

const reconciliationModel = readFileSync(new URL("../prisma/v2_clinical_profile_entries.prisma", import.meta.url), "utf8");
const reconciliationMigration = readFileSync(
  new URL("../prisma/migrations/20260919113000_v2_medication_reconciliation/migration.sql", import.meta.url),
  "utf8",
);
const reconciliationService = readFileSync(
  new URL("../src/modules/clinical-profile/medication-reconciliation.service.ts", import.meta.url),
  "utf8",
);
const reconciliationController = readFileSync(
  new URL("../src/modules/clinical-profile/medication-reconciliation.controller.ts", import.meta.url),
  "utf8",
);

assert.match(reconciliationModel, /model MedicationReconciliationItem/);
assert.match(reconciliationModel, /payloadDigest\s+String\?/);
assert.match(reconciliationModel, /signature\s+String\?/);
assert.match(reconciliationMigration, /FOREIGN KEY \("medicationEntryId"\) REFERENCES "ClinicalProfileEntry"\("id"\)/);
assert.match(reconciliationMigration, /FOREIGN KEY \("prescriptionOrderId"\) REFERENCES "ClinicalOrder"\("id"\)/);
assert.match(reconciliationMigration, /discrepancyState.*OPEN.*RESOLVED/s);
assert.doesNotMatch(reconciliationMigration, /\bDROP\b/i);
assert.match(reconciliationService, /attestation\.attest/);
assert.match(reconciliationService, /status:\s*"SIGNED"/);
assert.match(reconciliationService, /providerPatientOrders\(principal, patientId\)/);
assert.match(reconciliationService, /discrepancyState === "OPEN"/);
assert.match(reconciliationService, /PATIENT_MEDICATION_RECONCILIATION_STATUS_READ/);
assert.doesNotMatch(reconciliationService, /clinicalOrder\.update/);
assert.match(reconciliationController, /@Post\(":patientId\/medication-reconciliation"\)/);
assert.match(reconciliationController, /@Get\("reconciliation-status"\)/);

console.log("V2 longitudinal clinical-profile and signed medication reconciliation validation passed");
