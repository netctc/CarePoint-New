-- CarePoint V2 PAT-137 — temporary, revocable, single-scope clinical shares.
-- Raw bearer tokens are never persisted. Shared PHI snapshots remain envelope-encrypted at rest.

CREATE TYPE "PatientClinicalShareScope" AS ENUM (
  'OBSERVATIONS',
  'MEDICATIONS',
  'DEVICES',
  'QUESTIONNAIRE',
  'CARE_PLAN'
);

CREATE TABLE "PatientClinicalShare" (
  "id" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "relationId" TEXT,
  "scope" "PatientClinicalShareScope" NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "algorithm" TEXT NOT NULL DEFAULT '',
  "keyId" TEXT NOT NULL DEFAULT '',
  "wrappedKey" TEXT NOT NULL DEFAULT '',
  "iv" TEXT NOT NULL DEFAULT '',
  "ciphertext" TEXT NOT NULL,
  "contentDigest" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "lastAccessedAt" TIMESTAMP(3),
  "accessCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PatientClinicalShare_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PatientClinicalShare_tokenHash_check" CHECK (length("tokenHash") = 64),
  CONSTRAINT "PatientClinicalShare_contentDigest_check" CHECK (length("contentDigest") = 64),
  CONSTRAINT "PatientClinicalShare_accessCount_check" CHECK ("accessCount" >= 0),
  CONSTRAINT "PatientClinicalShare_expiry_check" CHECK ("expiresAt" > "createdAt")
);

CREATE UNIQUE INDEX "PatientClinicalShare_tokenHash_key"
ON "PatientClinicalShare"("tokenHash");

CREATE INDEX "PatientClinicalShare_accountId_patientId_createdAt_idx"
ON "PatientClinicalShare"("accountId", "patientId", "createdAt");

CREATE INDEX "PatientClinicalShare_expiresAt_revokedAt_idx"
ON "PatientClinicalShare"("expiresAt", "revokedAt");

ALTER TABLE "PatientClinicalShare"
ADD CONSTRAINT "PatientClinicalShare_patientId_fkey"
FOREIGN KEY ("patientId") REFERENCES "PatientProfile"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

REVOKE SELECT ("tokenHash", "ciphertext", "wrappedKey", "iv") ON "PatientClinicalShare" FROM PUBLIC;
