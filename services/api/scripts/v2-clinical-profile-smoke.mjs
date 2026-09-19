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

const allergyAnnotationModel = readFileSync(
  new URL("../prisma/v2_clinical_profile_revision_annotations.prisma", import.meta.url),
  "utf8",
);
const allergyMigration = readFileSync(
  new URL("../prisma/migrations/20260919114500_v2_allergy_reconciliation/migration.sql", import.meta.url),
  "utf8",
);
const allergyService = readFileSync(
  new URL("../src/modules/clinical-profile/allergy-reconciliation.service.ts", import.meta.url),
  "utf8",
);
const allergyController = readFileSync(
  new URL("../src/modules/clinical-profile/allergy-reconciliation.controller.ts", import.meta.url),
  "utf8",
);

assert.match(allergyAnnotationModel, /@@unique\(\[entryId, entryVersion, domain\]\)/);
assert.match(allergyMigration, /ALLERGY_RECONCILIATION/);
assert.match(allergyMigration, /FOREIGN KEY \("entryId"\) REFERENCES "ClinicalProfileEntry"\("id"\)/);
assert.doesNotMatch(allergyMigration, /\bDROP\b/i);
assert.match(allergyService, /listForDoctor\(principal, patientId, "ALLERGY"\)/);
assert.match(allergyService, /clinicalProfileEntryRevision\.findMany/);
assert.match(allergyService, /classification:\s*payload\.classification \?\? "ALLERGY"/);
assert.match(allergyService, /clinicalProfileRevisionAnnotation\.create/);
assert.doesNotMatch(allergyService, /clinicalProfileEntryRevision\.update/);
assert.doesNotMatch(allergyService, /clinicalProfileEntry\.delete/);
assert.match(allergyController, /@Get\(":patientId\/allergies"\)/);
assert.match(allergyController, /@Post\(":patientId\/allergies"\)/);
assert.match(allergyController, /@Patch\(":patientId\/allergies\/:entryId"\)/);
assert.match(allergyController, /@Post\(":patientId\/allergies\/:entryId\/verify"\)/);

console.log("V2 longitudinal clinical profile, medication reconciliation and allergy reconciliation validation passed");
