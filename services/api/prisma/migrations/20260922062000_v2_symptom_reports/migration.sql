CREATE TABLE "SymptomReport" (
  "id" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "appointmentId" TEXT,
  "carePlanId" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "requestDigest" TEXT NOT NULL,
  "sourceType" TEXT NOT NULL DEFAULT 'PATIENT_REPORTED',
  "sourceActorId" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3),
  "reportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "algorithm" TEXT NOT NULL,
  "keyId" TEXT NOT NULL,
  "wrappedKey" TEXT NOT NULL,
  "iv" TEXT NOT NULL,
  "ciphertext" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SymptomReport_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SymptomReport_source_patient_check" CHECK ("sourceType" = 'PATIENT_REPORTED')
);

CREATE UNIQUE INDEX "SymptomReport_patientId_idempotencyKey_key"
  ON "SymptomReport"("patientId", "idempotencyKey");
CREATE INDEX "SymptomReport_patientId_reportedAt_idx"
  ON "SymptomReport"("patientId", "reportedAt");
CREATE INDEX "SymptomReport_patientId_occurredAt_idx"
  ON "SymptomReport"("patientId", "occurredAt");
CREATE INDEX "SymptomReport_appointmentId_reportedAt_idx"
  ON "SymptomReport"("appointmentId", "reportedAt");
CREATE INDEX "SymptomReport_carePlanId_reportedAt_idx"
  ON "SymptomReport"("carePlanId", "reportedAt");

ALTER TABLE "SymptomReport"
  ADD CONSTRAINT "SymptomReport_patientId_fkey"
  FOREIGN KEY ("patientId") REFERENCES "PatientProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SymptomReport"
  ADD CONSTRAINT "SymptomReport_appointmentId_fkey"
  FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SymptomReport"
  ADD CONSTRAINT "SymptomReport_carePlanId_fkey"
  FOREIGN KEY ("carePlanId") REFERENCES "CarePlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION carepoint_reject_symptom_report_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'symptom reports are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "SymptomReport_append_only"
BEFORE UPDATE OR DELETE ON "SymptomReport"
FOR EACH ROW EXECUTE FUNCTION carepoint_reject_symptom_report_mutation();

REVOKE UPDATE, DELETE ON "SymptomReport" FROM PUBLIC;
