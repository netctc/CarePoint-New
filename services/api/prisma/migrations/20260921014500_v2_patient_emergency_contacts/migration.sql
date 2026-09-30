-- CarePoint V2 / PAT-099:
-- patient-owned emergency contacts with explicit priority and soft revocation.

CREATE TYPE "EmergencyContactStatus" AS ENUM ('ACTIVE', 'REVOKED');

CREATE TABLE "EmergencyContact" (
  "id" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "relationship" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "priority" INTEGER NOT NULL,
  "status" "EmergencyContactStatus" NOT NULL DEFAULT 'ACTIVE',
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EmergencyContact_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EmergencyContact_patientId_status_priority_idx"
ON "EmergencyContact"("patientId", "status", "priority");

CREATE INDEX "EmergencyContact_patientId_updatedAt_idx"
ON "EmergencyContact"("patientId", "updatedAt");

CREATE UNIQUE INDEX "EmergencyContact_patientId_active_priority_key"
ON "EmergencyContact"("patientId", "priority")
WHERE "status" = 'ACTIVE';

ALTER TABLE "EmergencyContact"
ADD CONSTRAINT "EmergencyContact_patientId_fkey"
FOREIGN KEY ("patientId") REFERENCES "PatientProfile"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EmergencyContact"
ADD CONSTRAINT "EmergencyContact_priority_positive_check"
CHECK ("priority" >= 1 AND "priority" <= 10);
