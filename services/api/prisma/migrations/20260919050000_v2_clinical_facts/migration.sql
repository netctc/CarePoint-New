-- CarePoint V2 / BE-002, BE-003, BE-004, BE-007, BE-019:
-- encrypted longitudinal clinical facts with immutable revisions and verification evidence.

CREATE TABLE "PatientClinicalFact" (
  "id" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "version" INTEGER NOT NULL DEFAULT 1,
  "verificationStatus" TEXT NOT NULL DEFAULT 'PATIENT_DECLARED',
  "reconciliationStatus" TEXT,
  "verifiedByProviderId" TEXT,
  "verifiedByActorId" TEXT,
  "verifiedAt" TIMESTAMP(3),
  "algorithm" TEXT NOT NULL,
  "keyId" TEXT NOT NULL,
  "wrappedKey" TEXT NOT NULL,
  "iv" TEXT NOT NULL,
  "ciphertext" TEXT NOT NULL,
  "sourceType" TEXT NOT NULL,
  "sourceActorId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PatientClinicalFact_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ClinicalFactRevision" (
  "id" TEXT NOT NULL,
  "factId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "sourceType" TEXT NOT NULL,
  "sourceActorId" TEXT,
  "changedFields" JSONB NOT NULL,
  "algorithm" TEXT NOT NULL,
  "keyId" TEXT NOT NULL,
  "wrappedKey" TEXT NOT NULL,
  "iv" TEXT NOT NULL,
  "ciphertext" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ClinicalFactRevision_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ClinicalFactVerification" (
  "id" TEXT NOT NULL,
  "factId" TEXT NOT NULL,
  "sourceVersion" INTEGER NOT NULL,
  "status" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ClinicalFactVerification_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PatientClinicalFact_patientId_kind_status_idx"
ON "PatientClinicalFact"("patientId", "kind", "status");

CREATE INDEX "PatientClinicalFact_patientId_verificationStatus_updatedAt_idx"
ON "PatientClinicalFact"("patientId", "verificationStatus", "updatedAt");

CREATE UNIQUE INDEX "ClinicalFactRevision_factId_version_key"
ON "ClinicalFactRevision"("factId", "version");

CREATE INDEX "ClinicalFactRevision_factId_createdAt_idx"
ON "ClinicalFactRevision"("factId", "createdAt");

CREATE INDEX "ClinicalFactVerification_factId_createdAt_idx"
ON "ClinicalFactVerification"("factId", "createdAt");

CREATE INDEX "ClinicalFactVerification_providerId_createdAt_idx"
ON "ClinicalFactVerification"("providerId", "createdAt");

ALTER TABLE "PatientClinicalFact"
ADD CONSTRAINT "PatientClinicalFact_patientId_fkey"
FOREIGN KEY ("patientId") REFERENCES "PatientProfile"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ClinicalFactRevision"
ADD CONSTRAINT "ClinicalFactRevision_factId_fkey"
FOREIGN KEY ("factId") REFERENCES "PatientClinicalFact"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ClinicalFactVerification"
ADD CONSTRAINT "ClinicalFactVerification_factId_fkey"
FOREIGN KEY ("factId") REFERENCES "PatientClinicalFact"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
