-- CarePoint V2 / BE-020, BE-026:
-- provider-bound temporary clinical sharing backed by granular expiring consents.

CREATE TABLE "TemporaryClinicalShare" (
  "id" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "scopes" JSONB NOT NULL,
  "consentIds" JSONB NOT NULL,
  "purpose" TEXT NOT NULL DEFAULT 'TREATMENT',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "createdByActorId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TemporaryClinicalShare_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TemporaryClinicalShare_patientId_createdAt_idx"
ON "TemporaryClinicalShare"("patientId", "createdAt");

CREATE INDEX "TemporaryClinicalShare_providerId_expiresAt_revokedAt_idx"
ON "TemporaryClinicalShare"("providerId", "expiresAt", "revokedAt");

ALTER TABLE "TemporaryClinicalShare"
ADD CONSTRAINT "TemporaryClinicalShare_patientId_fkey"
FOREIGN KEY ("patientId") REFERENCES "PatientProfile"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TemporaryClinicalShare"
ADD CONSTRAINT "TemporaryClinicalShare_providerId_fkey"
FOREIGN KEY ("providerId") REFERENCES "Provider"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
