import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/modules/nursing/provider-nursing-workflows.module.ts", import.meta.url), "utf8");
const schema = readFileSync(new URL("../prisma/v2_nursing_workflows.prisma", import.meta.url), "utf8");
const migration = readFileSync(new URL("../prisma/migrations/20260922203000_v2_nursing_workflows/migration.sql", import.meta.url), "utf8");
const capabilitySource = readFileSync(new URL("../src/modules/providers/provider-category-capabilities.ts", import.meta.url), "utf8");
const formEngine = readFileSync(new URL("../src/modules/provider-category-forms/provider-form.engine.ts", import.meta.url), "utf8");
const appModule = readFileSync(new URL("../src/app.module.ts", import.meta.url), "utf8");
const mobileApi = readFileSync(new URL("../../../packages/mobile_core/lib/provider_nursing_api.dart", import.meta.url), "utf8");
const mobileEntry = readFileSync(new URL("../../../apps/provider-mobile/lib/nursing_entry.dart", import.meta.url), "utf8");
const mobileMain = readFileSync(new URL("../../../apps/provider-mobile/lib/main.dart", import.meta.url), "utf8");

// PRV-062 medication administration: operational MAR over an existing active prescription.
assert.match(source, /@Controller\("provider\/medication-administrations"\)/);
assert.match(source, /@Post\(\)/);
assert.match(source, /eligible-prescriptions/);
assert.match(source, /requireAppointmentContext\(principal, "MED_ADMIN"/);
assert.match(source, /source\.type !== "PRESCRIPTION" \|\| source\.status !== "SIGNED"/);
assert.match(source, /lockedOrder\.type !== "PRESCRIPTION" \|\| lockedOrder\.status !== "SIGNED"/);
assert.match(source, /ADMINISTERED/);
assert.match(source, /OMITTED/);
assert.match(source, /OrdersAttestationService/);
assert.match(source, /attestation\.attest/);
assert.match(source, /MEDICATION_ADMINISTRATION_RECORDED/);
assert.match(schema, /model MedicationAdministration/);
assert.match(schema, /signature\s+String/);
assert.match(schema, /prescriptionOrderId\s+String/);

// PRV-063 wound care: encrypted longitudinal assessment and consented ClinicalMedia evidence only.
assert.match(source, /@Controller\("provider\/wound-assessments"\)/);
assert.match(source, /requireAppointmentContext\(principal, "WOUND_CARE"/);
assert.match(source, /providerFieldMediaEvidence\.findFirst/);
assert.match(source, /consented encrypted field-media workflow/);
assert.match(source, /encryptRecord/);
assert.match(source, /WOUND_ASSESSMENT_RECORDED/);
assert.match(source, /automatedClinicalInference:\s*false/);
assert.match(schema, /model WoundAssessment/);
assert.match(schema, /clinicalMediaId\s+String\?/);
assert.doesNotMatch(schema, /siteCode|woundType|exudate|notes/);

// PRV-064 procedure checklist reuses the versioned Admin category-form builder.
assert.match(capabilitySource, /"MED_ADMIN"/);
assert.match(capabilitySource, /"WOUND_CARE"/);
assert.match(capabilitySource, /"PROCEDURE_CHECKLIST"/);
assert.match(formEngine, /"PROCEDURE_CHECKLIST"/);
assert.match(formEngine, /PROCEDURE_CHECKLIST.*contextType !== "APPOINTMENT"/s);
assert.match(source, /@Controller\("provider\/procedure-checklists"\)/);
assert.match(source, /configurationSource:\s*"ProviderCategoryForm"/);
assert.match(source, /assertWorkflowCapability\(principal, "PROCEDURE_CHECKLIST"\)/);
assert.match(source, /assertWorkflowCapability\(principal, "CATEGORY_FORMS"\)/);
assert.match(source, /item\.purpose === "PROCEDURE_CHECKLIST"/);
assert.match(source, /forms\.submit/);
assert.match(source, /requiredStepsValidatedServerSide:\s*true/);
assert.match(schema, /model ProcedureChecklistCompletion/);
assert.match(schema, /formResponseId\s+String\s+@unique/);

// All nursing evidence is idempotent, serializable where source state is mutated/read for write,
// append-only in PostgreSQL and bound to authenticated provider/patient appointment context.
assert.match(source, /idempotencyKey/);
assert.match(source, /requestDigest/);
assert.match(source, /TransactionIsolationLevel\.Serializable/);
assert.match(source, /FOR UPDATE/);
assert.match(source, /providerId:\s*context\.providerId/);
assert.match(migration, /MedicationAdministration_immutable_trigger/);
assert.match(migration, /WoundAssessment_immutable_trigger/);
assert.match(migration, /ProcedureChecklistCompletion_immutable_trigger/);
assert.match(migration, /BEFORE UPDATE OR DELETE/);
assert.match(migration, /REVOKE UPDATE, DELETE ON "MedicationAdministration"/);
assert.match(migration, /REVOKE UPDATE, DELETE ON "WoundAssessment"/);
assert.match(migration, /REVOKE UPDATE, DELETE ON "ProcedureChecklistCompletion"/);
assert.match(migration, /REFERENCES "User"\("id"\)/);
assert.match(appModule, /ProviderNursingWorkflowsModule/);

// Provider Mobile exposes only capability-enabled workflows and keeps photo linkage on consented media.
assert.match(mobileApi, /eligiblePrescriptions/);
assert.match(mobileApi, /recordMedicationAdministration/);
assert.match(mobileApi, /recordWoundAssessment/);
assert.match(mobileApi, /procedureChecklists/);
assert.match(mobileApi, /completeProcedureChecklist/);
assert.match(mobileEntry, /workflowCapabilities\.contains\('MED_ADMIN'\)/);
assert.match(mobileEntry, /workflowCapabilities\.contains\('WOUND_CARE'\)/);
assert.match(mobileEntry, /workflowCapabilities\.contains\('PROCEDURE_CHECKLIST'\)/);
assert.match(mobileEntry, /workflowCapabilities\.contains\('CATEGORY_FORMS'\)/);
assert.match(mobileEntry, /ProviderFieldMediaApi/);
assert.match(mobileEntry, /clinicalMediaId/);
assert.match(mobileEntry, /CarePointLocale/);
assert.match(mobileEntry, /'ar':/);
assert.match(mobileEntry, /'fr':/);
assert.match(mobileEntry, /'es':/);
assert.match(mobileMain, /ProviderNursingLauncher/);

console.log("V2 PRV-062/063/064 nursing workflow acceptance passed");
