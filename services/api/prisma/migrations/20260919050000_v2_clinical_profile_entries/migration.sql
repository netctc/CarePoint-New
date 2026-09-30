-- CarePoint V2 A2B/A5 foundation: encrypted longitudinal clinical profile entries.

CREATE TABLE "ClinicalProfileEntry" (
  "id" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "version" INTEGER NOT NULL DEFAULT 1,
  "verificationStatus" TEXT NOT NULL DEFAULT 'PATIENT_DECLARED',
  "sourceType" TEXT NOT NULL,
  "sourceActorId" TEXT,
  "verifiedByActorId" TEXT,
  "verifiedAt" TIMESTAMP(3),
  "algorithm" TEXT NOT NULL,
  "keyId" TEXT NOT NULL,
  "wrappedKey" TEXT NOT NULL,
  "iv" TEXT NOT NULL,
  "ciphertext" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ClinicalProfileEntry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ClinicalProfileEntryRevision" (
  "id" TEXT NOT NULL,
  "entryId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "changedFields" JSONB NOT NULL,
  "verificationStatus" TEXT NOT NULL,
  "sourceType" TEXT NOT NULL,
  "sourceActorId" TEXT,
  "algorithm" TEXT NOT NULL,
  "keyId" TEXT NOT NULL,
  "wrappedKey" TEXT NOT NULL,
  "iv" TEXT NOT NULL,
  "ciphertext" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ClinicalProfileEntryRevision_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MedicationReconciliation" (
  "id" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "entryIds" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'COMPLETED',
  "createdByActorId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MedicationReconciliation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ClinicalProfileEntry_patientId_kind_status_idx"
ON "ClinicalProfileEntry"("patientId", "kind", "status");

CREATE INDEX "ClinicalProfileEntry_patientId_verificationStatus_updatedAt_idx"
ON "ClinicalProfileEntry"("patientId", "verificationStatus", "updatedAt");

CREATE UNIQUE INDEX "ClinicalProfileEntryRevision_entryId_version_key"
ON "ClinicalProfileEntryRevision"("entryId", "version");

CREATE INDEX "ClinicalProfileEntryRevision_entryId_createdAt_idx"
ON "ClinicalProfileEntryRevision"("entryId", "createdAt");

CREATE INDEX "MedicationReconciliation_patientId_createdAt_idx"
ON "MedicationReconciliation"("patientId", "createdAt");

CREATE INDEX "MedicationReconciliation_providerId_createdAt_idx"
ON "MedicationReconciliation"("providerId", "createdAt");

ALTER TABLE "ClinicalProfileEntry"
ADD CONSTRAINT "ClinicalProfileEntry_patientId_fkey"
FOREIGN KEY ("patientId") REFERENCES "PatientProfile"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ClinicalProfileEntryRevision"
ADD CONSTRAINT "ClinicalProfileEntryRevision_entryId_fkey"
FOREIGN KEY ("entryId") REFERENCES "ClinicalProfileEntry"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MedicationReconciliation"
ADD CONSTRAINT "MedicationReconciliation_patientId_fkey"
FOREIGN KEY ("patientId") REFERENCES "PatientProfile"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
