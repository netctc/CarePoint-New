-- CarePoint V2 PAT-130 — patient-reported medication intake events.
-- Events are append-only and never mutate medication statements, reminders, or prescriptions.

CREATE TABLE "MedicationIntake" (
  "id" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "reminderId" TEXT NOT NULL,
  "sourceKind" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "scheduledFor" TIMESTAMP(3) NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sourceType" TEXT NOT NULL DEFAULT 'PATIENT_REPORTED',
  "reasonCode" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "requestDigest" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MedicationIntake_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MedicationIntake_sourceKind_check"
    CHECK ("sourceKind" IN ('CLINICAL_PROFILE_ENTRY', 'PRESCRIPTION_ORDER')),
  CONSTRAINT "MedicationIntake_status_check"
    CHECK ("status" IN ('TAKEN', 'OMITTED', 'POSTPONED')),
  CONSTRAINT "MedicationIntake_sourceType_check"
    CHECK ("sourceType" = 'PATIENT_REPORTED'),
  CONSTRAINT "MedicationIntake_reasonCode_check"
    CHECK ("reasonCode" IS NULL OR "reasonCode" ~ '^[A-Z][A-Z0-9_:-]{1,63}$')
);

CREATE UNIQUE INDEX "MedicationIntake_accountId_patientId_idempotencyKey_key"
ON "MedicationIntake"("accountId", "patientId", "idempotencyKey");

CREATE INDEX "MedicationIntake_accountId_patientId_occurredAt_idx"
ON "MedicationIntake"("accountId", "patientId", "occurredAt");

CREATE INDEX "MedicationIntake_reminderId_scheduledFor_idx"
ON "MedicationIntake"("reminderId", "scheduledFor");

CREATE INDEX "MedicationIntake_sourceKind_sourceId_occurredAt_idx"
ON "MedicationIntake"("sourceKind", "sourceId", "occurredAt");

ALTER TABLE "MedicationIntake"
ADD CONSTRAINT "MedicationIntake_patientId_fkey"
FOREIGN KEY ("patientId") REFERENCES "PatientProfile"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MedicationIntake"
ADD CONSTRAINT "MedicationIntake_reminderId_fkey"
FOREIGN KEY ("reminderId") REFERENCES "MedicationReminder"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "carepoint_medication_intake_append_only"()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'MedicationIntake is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "MedicationIntake_append_only_trigger"
BEFORE UPDATE OR DELETE ON "MedicationIntake"
FOR EACH ROW EXECUTE FUNCTION "carepoint_medication_intake_append_only"();
