-- CarePoint V2 PAT-129 — patient-managed medication reminders.
-- Reminder rows store source references and scheduling metadata only; medication/prescription content remains in governed clinical stores.

CREATE TABLE "MedicationReminder" (
  "id" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "sourceKind" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "localTimes" JSONB NOT NULL,
  "timeZone" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MedicationReminder_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MedicationReminder_sourceKind_check"
    CHECK ("sourceKind" IN ('CLINICAL_PROFILE_ENTRY', 'PRESCRIPTION_ORDER')),
  CONSTRAINT "MedicationReminder_localTimes_check"
    CHECK (jsonb_typeof("localTimes") = 'array')
);

CREATE UNIQUE INDEX "MedicationReminder_accountId_patientId_sourceKind_sourceId_key"
ON "MedicationReminder"("accountId", "patientId", "sourceKind", "sourceId");

CREATE INDEX "MedicationReminder_accountId_patientId_enabled_idx"
ON "MedicationReminder"("accountId", "patientId", "enabled");

CREATE INDEX "MedicationReminder_enabled_updatedAt_idx"
ON "MedicationReminder"("enabled", "updatedAt");

ALTER TABLE "MedicationReminder"
ADD CONSTRAINT "MedicationReminder_patientId_fkey"
FOREIGN KEY ("patientId") REFERENCES "PatientProfile"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
