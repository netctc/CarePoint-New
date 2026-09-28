ALTER TABLE "ProviderCredential"
  ADD COLUMN "renewedFromCredentialId" TEXT,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "ProviderCredential"
SET "status" = 'VALID'
WHERE "status" = 'VERIFIED';

CREATE INDEX "ProviderCredential_renewedFromCredentialId_idx"
  ON "ProviderCredential"("renewedFromCredentialId");

CREATE TABLE "ProviderCredentialDocument" (
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

  CONSTRAINT "ProviderCredentialDocument_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProviderCredentialDocument_objectKey_key"
  ON "ProviderCredentialDocument"("objectKey");

CREATE INDEX "ProviderCredentialDocument_credentialId_createdAt_idx"
  ON "ProviderCredentialDocument"("credentialId", "createdAt");

ALTER TABLE "ProviderCredentialDocument"
  ADD CONSTRAINT "ProviderCredentialDocument_credentialId_fkey"
  FOREIGN KEY ("credentialId") REFERENCES "ProviderCredential"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ProviderCredentialVerification" (
  "id" TEXT NOT NULL,
  "credentialId" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "note" TEXT,
  "actorId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ProviderCredentialVerification_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProviderCredentialVerification_credentialId_createdAt_idx"
  ON "ProviderCredentialVerification"("credentialId", "createdAt");

ALTER TABLE "ProviderCredentialVerification"
  ADD CONSTRAINT "ProviderCredentialVerification_credentialId_fkey"
  FOREIGN KEY ("credentialId") REFERENCES "ProviderCredential"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ProviderGovernanceHistory" (
  "id" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "domain" TEXT NOT NULL,
  "targetId" TEXT,
  "fromStatus" TEXT,
  "toStatus" TEXT NOT NULL,
  "reason" TEXT,
  "actorId" TEXT NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ProviderGovernanceHistory_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProviderGovernanceHistory_providerId_domain_createdAt_idx"
  ON "ProviderGovernanceHistory"("providerId", "domain", "createdAt");

ALTER TABLE "ProviderGovernanceHistory"
  ADD CONSTRAINT "ProviderGovernanceHistory_providerId_fkey"
  FOREIGN KEY ("providerId") REFERENCES "Provider"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
