-- Credential evidence archival linkage
ALTER TABLE "ProviderCredential"
  ADD COLUMN "sourceOnboardingCredentialId" TEXT;

CREATE UNIQUE INDEX "ProviderCredential_sourceOnboardingCredentialId_key"
  ON "ProviderCredential"("sourceOnboardingCredentialId");

ALTER TABLE "ProviderCredentialDocument"
  ADD COLUMN "sourceOnboardingDocumentId" TEXT;

CREATE UNIQUE INDEX "ProviderCredentialDocument_sourceOnboardingDocumentId_key"
  ON "ProviderCredentialDocument"("sourceOnboardingDocumentId");

-- Administrative patient contact-change workflow
CREATE TABLE "PatientAdministrativeContactChange" (
  "id" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "requestedValue" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "requestedByActorId" TEXT NOT NULL,
  "verifiedByActorId" TEXT,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "verifiedAt" TIMESTAMP(3),
  CONSTRAINT "PatientAdministrativeContactChange_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PatientAdministrativeContactChange_patientId_status_requestedAt_idx"
  ON "PatientAdministrativeContactChange"("patientId", "status", "requestedAt");

ALTER TABLE "PatientAdministrativeContactChange"
  ADD CONSTRAINT "PatientAdministrativeContactChange_patientId_fkey"
  FOREIGN KEY ("patientId") REFERENCES "PatientProfile"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
