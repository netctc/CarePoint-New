-- CarePoint V2 PAT-098 — patient-controlled emergency health card preferences.
-- Privacy by default: every clinical category is disabled until the Patient enables it.

CREATE TABLE "EmergencyHealthCardPreference" (
  "patientId" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "includeSevereAllergies" BOOLEAN NOT NULL DEFAULT false,
  "includeActiveMedications" BOOLEAN NOT NULL DEFAULT false,
  "includeActiveConditions" BOOLEAN NOT NULL DEFAULT false,
  "emergencyContactId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EmergencyHealthCardPreference_pkey" PRIMARY KEY ("patientId"),
  CONSTRAINT "EmergencyHealthCardPreference_version_check" CHECK ("version" > 0)
);

CREATE INDEX "EmergencyHealthCardPreference_updatedAt_idx"
ON "EmergencyHealthCardPreference"("updatedAt");

ALTER TABLE "EmergencyHealthCardPreference"
ADD CONSTRAINT "EmergencyHealthCardPreference_patientId_fkey"
FOREIGN KEY ("patientId") REFERENCES "PatientProfile"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EmergencyHealthCardPreference"
ADD CONSTRAINT "EmergencyHealthCardPreference_emergencyContactId_fkey"
FOREIGN KEY ("emergencyContactId") REFERENCES "EmergencyContact"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
