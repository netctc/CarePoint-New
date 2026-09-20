-- CarePoint V2 / BE-001: encrypted longitudinal patient health profile.
CREATE TABLE "PatientHealthProfile" (
  "id" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "algorithm" TEXT NOT NULL,
  "keyId" TEXT NOT NULL,
  "wrappedKey" TEXT NOT NULL,
  "iv" TEXT NOT NULL,
  "ciphertext" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PatientHealthProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProfileRevision" (
  "id" TEXT NOT NULL,
  "profileId" TEXT NOT NULL,
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
  CONSTRAINT "ProfileRevision_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PatientHealthProfile_patientId_key" ON "PatientHealthProfile"("patientId");
CREATE INDEX "PatientHealthProfile_updatedAt_idx" ON "PatientHealthProfile"("updatedAt");
CREATE UNIQUE INDEX "ProfileRevision_profileId_version_key" ON "ProfileRevision"("profileId", "version");
CREATE INDEX "ProfileRevision_profileId_createdAt_idx" ON "ProfileRevision"("profileId", "createdAt");

ALTER TABLE "PatientHealthProfile"
ADD CONSTRAINT "PatientHealthProfile_patientId_fkey"
FOREIGN KEY ("patientId") REFERENCES "PatientProfile"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProfileRevision"
ADD CONSTRAINT "ProfileRevision_profileId_fkey"
FOREIGN KEY ("profileId") REFERENCES "PatientHealthProfile"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
