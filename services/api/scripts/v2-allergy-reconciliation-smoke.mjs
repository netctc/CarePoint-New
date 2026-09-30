import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const annotationModel = readFileSync(
  new URL("../prisma/v2_clinical_profile_revision_annotations.prisma", import.meta.url),
  "utf8",
);
const migration = readFileSync(
  new URL("../prisma/migrations/20260926053000_v2_allergy_reconciliation/migration.sql", import.meta.url),
  "utf8",
);
const service = readFileSync(
  new URL("../src/modules/clinical-profile/allergy-reconciliation.service.ts", import.meta.url),
  "utf8",
);
const controller = readFileSync(
  new URL("../src/modules/clinical-profile/allergy-reconciliation.controller.ts", import.meta.url),
  "utf8",
);
const moduleSource = readFileSync(
  new URL("../src/modules/clinical-profile/clinical-profile.module.ts", import.meta.url),
  "utf8",
);

assert.match(annotationModel, /@@unique\(\[entryId, entryVersion, domain\]\)/);
assert.match(migration, /ALLERGY_RECONCILIATION/);
assert.match(migration, /FOREIGN KEY \("entryId"\) REFERENCES "ClinicalProfileEntry"\("id"\)/);
assert.doesNotMatch(migration, /\bDROP\b/i);

assert.match(service, /listForDoctor\(principal, patientId, "ALLERGY"\)/);
assert.match(service, /clinicalProfileEntryRevision\.findMany/);
assert.match(service, /classification:\s*payload\.classification \?\? "ALLERGY"/);
assert.match(service, /clinicalProfileRevisionAnnotation\.create/);
assert.doesNotMatch(service, /clinicalProfileEntryRevision\.update/);
assert.doesNotMatch(service, /clinicalProfileEntry\.delete/);

assert.match(controller, /@Controller\("doctor\/patients"\)/);
assert.match(controller, /@Get\(":patientId\/clinical-profile\/allergies"\)/);
assert.match(controller, /@Post\(":patientId\/clinical-profile\/allergies"\)/);
assert.match(controller, /@Patch\(":patientId\/clinical-profile\/allergies\/:entryId"\)/);
assert.match(controller, /@Post\(":patientId\/clinical-profile\/allergies\/:entryId\/verify"\)/);
assert.match(moduleSource, /DoctorAllergyReconciliationController/);
assert.match(moduleSource, /AllergyReconciliationService/);

console.log("V2 allergy reconciliation validation passed");
