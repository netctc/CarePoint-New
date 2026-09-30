CREATE TABLE "OnboardingCredentialDocument" (
  "id" TEXT NOT NULL,
  "credentialId" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "mediaType" TEXT NOT NULL DEFAULT 'application/pdf',
  "byteLength" INTEGER NOT NULL,
  "contentDigest" TEXT NOT NULL,
  "storageProvider" TEXT NOT NULL,
  "objectKey" TEXT NOT NULL,
  "blobAlgorithm" TEXT NOT NULL,
  "blobKeyId" TEXT NOT NULL,
  "blobWrappedKey" TEXT NOT NULL,
  "blobIv" TEXT NOT NULL,
  "createdByAccountId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "OnboardingCredentialDocument_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OnboardingCredentialDocument_objectKey_key"
  ON "OnboardingCredentialDocument"("objectKey");

CREATE INDEX "OnboardingCredentialDocument_credentialId_createdAt_idx"
  ON "OnboardingCredentialDocument"("credentialId", "createdAt");

ALTER TABLE "OnboardingCredentialDocument"
  ADD CONSTRAINT "OnboardingCredentialDocument_credentialId_fkey"
  FOREIGN KEY ("credentialId") REFERENCES "OnboardingCredential"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
