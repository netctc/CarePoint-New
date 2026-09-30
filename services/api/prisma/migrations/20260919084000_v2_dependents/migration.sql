-- CarePoint V2 / BE-023, PAT-133, PAT-134, PAT-135:
-- verified dependent relationships, legal-authority evidence and explicit session patient context.

CREATE TABLE "DependentRelation" (
  "id" TEXT NOT NULL,
  "guardianAccountId" TEXT NOT NULL,
  "dependentPatientId" TEXT NOT NULL,
  "relationshipType" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
  "scopes" JSONB NOT NULL,
  "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "validUntil" TIMESTAMP(3),
  "verifiedAt" TIMESTAMP(3),
  "verifiedByActorId" TEXT,
  "revokedAt" TIMESTAMP(3),
  "reasonCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DependentRelation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LegalAuthorityEvidence" (
  "id" TEXT NOT NULL,
  "relationId" TEXT NOT NULL,
  "evidenceType" TEXT NOT NULL,
  "referenceId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "issuedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  "reviewedAt" TIMESTAMP(3),
  "reviewedByActorId" TEXT,
  "reasonCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LegalAuthorityEvidence_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PatientContextSession" (
  "sessionId" TEXT NOT NULL,
  "guardianAccountId" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "relationId" TEXT,
  "mode" TEXT NOT NULL,
  "selectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PatientContextSession_pkey" PRIMARY KEY ("sessionId")
);

CREATE UNIQUE INDEX "DependentRelation_guardianAccountId_dependentPatientId_key"
ON "DependentRelation"("guardianAccountId", "dependentPatientId");
CREATE INDEX "DependentRelation_guardianAccountId_status_validUntil_idx"
ON "DependentRelation"("guardianAccountId", "status", "validUntil");
CREATE INDEX "DependentRelation_dependentPatientId_status_validUntil_idx"
ON "DependentRelation"("dependentPatientId", "status", "validUntil");
CREATE INDEX "LegalAuthorityEvidence_relationId_status_idx"
ON "LegalAuthorityEvidence"("relationId", "status");
CREATE INDEX "LegalAuthorityEvidence_referenceId_idx"
ON "LegalAuthorityEvidence"("referenceId");
CREATE INDEX "PatientContextSession_guardianAccountId_expiresAt_idx"
ON "PatientContextSession"("guardianAccountId", "expiresAt");
CREATE INDEX "PatientContextSession_patientId_expiresAt_idx"
ON "PatientContextSession"("patientId", "expiresAt");
CREATE INDEX "PatientContextSession_relationId_idx"
ON "PatientContextSession"("relationId");

ALTER TABLE "DependentRelation"
ADD CONSTRAINT "DependentRelation_guardianAccountId_fkey"
FOREIGN KEY ("guardianAccountId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DependentRelation"
ADD CONSTRAINT "DependentRelation_dependentPatientId_fkey"
FOREIGN KEY ("dependentPatientId") REFERENCES "PatientProfile"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LegalAuthorityEvidence"
ADD CONSTRAINT "LegalAuthorityEvidence_relationId_fkey"
FOREIGN KEY ("relationId") REFERENCES "DependentRelation"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PatientContextSession"
ADD CONSTRAINT "PatientContextSession_guardianAccountId_fkey"
FOREIGN KEY ("guardianAccountId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PatientContextSession"
ADD CONSTRAINT "PatientContextSession_patientId_fkey"
FOREIGN KEY ("patientId") REFERENCES "PatientProfile"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PatientContextSession"
ADD CONSTRAINT "PatientContextSession_relationId_fkey"
FOREIGN KEY ("relationId") REFERENCES "DependentRelation"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
