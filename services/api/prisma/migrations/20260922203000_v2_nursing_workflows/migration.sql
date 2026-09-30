CREATE TABLE "MedicationAdministration" (
  "id" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "requestDigest" TEXT NOT NULL,
  "prescriptionOrderId" TEXT NOT NULL,
  "appointmentId" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "sourceActorId" TEXT NOT NULL,
  "administrationStatus" TEXT NOT NULL,
  "administeredAt" TIMESTAMP(3) NOT NULL,
  "algorithm" TEXT NOT NULL,
  "keyId" TEXT NOT NULL,
  "wrappedKey" TEXT NOT NULL,
  "iv" TEXT NOT NULL,
  "ciphertext" TEXT NOT NULL,
  "payloadDigest" TEXT NOT NULL,
  "signatureAlgorithm" TEXT NOT NULL,
  "signatureKeyId" TEXT NOT NULL,
  "signature" TEXT NOT NULL,
  "signedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MedicationAdministration_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MedicationAdministration_status_ck" CHECK ("administrationStatus" IN ('ADMINISTERED','OMITTED'))
);

CREATE UNIQUE INDEX "MedicationAdministration_idempotencyKey_key" ON "MedicationAdministration"("idempotencyKey");
CREATE INDEX "MedicationAdministration_patientId_administeredAt_idx" ON "MedicationAdministration"("patientId", "administeredAt");
CREATE INDEX "MedicationAdministration_providerId_administeredAt_idx" ON "MedicationAdministration"("providerId", "administeredAt");
CREATE INDEX "MedicationAdministration_appointmentId_administeredAt_idx" ON "MedicationAdministration"("appointmentId", "administeredAt");
CREATE INDEX "MedicationAdministration_prescriptionOrderId_administeredAt_idx" ON "MedicationAdministration"("prescriptionOrderId", "administeredAt");
ALTER TABLE "MedicationAdministration" ADD CONSTRAINT "MedicationAdministration_prescriptionOrderId_fkey" FOREIGN KEY ("prescriptionOrderId") REFERENCES "ClinicalOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MedicationAdministration" ADD CONSTRAINT "MedicationAdministration_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MedicationAdministration" ADD CONSTRAINT "MedicationAdministration_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "PatientProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MedicationAdministration" ADD CONSTRAINT "MedicationAdministration_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MedicationAdministration" ADD CONSTRAINT "MedicationAdministration_sourceActorId_fkey" FOREIGN KEY ("sourceActorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "WoundAssessment" (
  "id" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "requestDigest" TEXT NOT NULL,
  "appointmentId" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "sourceActorId" TEXT NOT NULL,
  "clinicalMediaId" TEXT,
  "assessedAt" TIMESTAMP(3) NOT NULL,
  "algorithm" TEXT NOT NULL,
  "keyId" TEXT NOT NULL,
  "wrappedKey" TEXT NOT NULL,
  "iv" TEXT NOT NULL,
  "ciphertext" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WoundAssessment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WoundAssessment_idempotencyKey_key" ON "WoundAssessment"("idempotencyKey");
CREATE INDEX "WoundAssessment_patientId_assessedAt_idx" ON "WoundAssessment"("patientId", "assessedAt");
CREATE INDEX "WoundAssessment_providerId_assessedAt_idx" ON "WoundAssessment"("providerId", "assessedAt");
CREATE INDEX "WoundAssessment_appointmentId_assessedAt_idx" ON "WoundAssessment"("appointmentId", "assessedAt");
CREATE INDEX "WoundAssessment_clinicalMediaId_idx" ON "WoundAssessment"("clinicalMediaId");
ALTER TABLE "WoundAssessment" ADD CONSTRAINT "WoundAssessment_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WoundAssessment" ADD CONSTRAINT "WoundAssessment_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "PatientProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WoundAssessment" ADD CONSTRAINT "WoundAssessment_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WoundAssessment" ADD CONSTRAINT "WoundAssessment_sourceActorId_fkey" FOREIGN KEY ("sourceActorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WoundAssessment" ADD CONSTRAINT "WoundAssessment_clinicalMediaId_fkey" FOREIGN KEY ("clinicalMediaId") REFERENCES "ClinicalMedia"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ProcedureChecklistCompletion" (
  "id" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "requestDigest" TEXT NOT NULL,
  "formId" TEXT NOT NULL,
  "formResponseId" TEXT NOT NULL,
  "appointmentId" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "sourceActorId" TEXT NOT NULL,
  "formVersion" INTEGER NOT NULL,
  "sequence" INTEGER NOT NULL,
  "requiredCount" INTEGER NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'COMPLETED',
  "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProcedureChecklistCompletion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProcedureChecklistCompletion_state_ck" CHECK ("state" = 'COMPLETED'),
  CONSTRAINT "ProcedureChecklistCompletion_requiredCount_ck" CHECK ("requiredCount" >= 0),
  CONSTRAINT "ProcedureChecklistCompletion_sequence_ck" CHECK ("sequence" > 0),
  CONSTRAINT "ProcedureChecklistCompletion_formVersion_ck" CHECK ("formVersion" > 0)
);

CREATE UNIQUE INDEX "ProcedureChecklistCompletion_idempotencyKey_key" ON "ProcedureChecklistCompletion"("idempotencyKey");
CREATE UNIQUE INDEX "ProcedureChecklistCompletion_formResponseId_key" ON "ProcedureChecklistCompletion"("formResponseId");
CREATE INDEX "ProcedureChecklistCompletion_appointmentId_completedAt_idx" ON "ProcedureChecklistCompletion"("appointmentId", "completedAt");
CREATE INDEX "ProcedureChecklistCompletion_patientId_completedAt_idx" ON "ProcedureChecklistCompletion"("patientId", "completedAt");
CREATE INDEX "ProcedureChecklistCompletion_providerId_completedAt_idx" ON "ProcedureChecklistCompletion"("providerId", "completedAt");
CREATE INDEX "ProcedureChecklistCompletion_formId_completedAt_idx" ON "ProcedureChecklistCompletion"("formId", "completedAt");
ALTER TABLE "ProcedureChecklistCompletion" ADD CONSTRAINT "ProcedureChecklistCompletion_formId_fkey" FOREIGN KEY ("formId") REFERENCES "ProviderCategoryForm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProcedureChecklistCompletion" ADD CONSTRAINT "ProcedureChecklistCompletion_formResponseId_fkey" FOREIGN KEY ("formResponseId") REFERENCES "ProviderCategoryFormResponse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProcedureChecklistCompletion" ADD CONSTRAINT "ProcedureChecklistCompletion_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProcedureChecklistCompletion" ADD CONSTRAINT "ProcedureChecklistCompletion_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "PatientProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProcedureChecklistCompletion" ADD CONSTRAINT "ProcedureChecklistCompletion_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProcedureChecklistCompletion" ADD CONSTRAINT "ProcedureChecklistCompletion_sourceActorId_fkey" FOREIGN KEY ("sourceActorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION carepoint_reject_nursing_evidence_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'nursing workflow evidence is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "MedicationAdministration_immutable_trigger"
BEFORE UPDATE OR DELETE ON "MedicationAdministration"
FOR EACH ROW EXECUTE FUNCTION carepoint_reject_nursing_evidence_mutation();

CREATE TRIGGER "WoundAssessment_immutable_trigger"
BEFORE UPDATE OR DELETE ON "WoundAssessment"
FOR EACH ROW EXECUTE FUNCTION carepoint_reject_nursing_evidence_mutation();

CREATE TRIGGER "ProcedureChecklistCompletion_immutable_trigger"
BEFORE UPDATE OR DELETE ON "ProcedureChecklistCompletion"
FOR EACH ROW EXECUTE FUNCTION carepoint_reject_nursing_evidence_mutation();

REVOKE UPDATE, DELETE ON "MedicationAdministration" FROM PUBLIC;
REVOKE UPDATE, DELETE ON "WoundAssessment" FROM PUBLIC;
REVOKE UPDATE, DELETE ON "ProcedureChecklistCompletion" FROM PUBLIC;
