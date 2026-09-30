-- CarePoint V2 / BE-054:
-- encrypted clinical media bound to immutable consent evidence and short-lived access grants.

CREATE TYPE "ClinicalMediaStatus" AS ENUM ('AVAILABLE', 'REMOVED');
CREATE TYPE "ClinicalMediaAccessVariant" AS ENUM ('ORIGINAL', 'THUMBNAIL');

CREATE TABLE "ConsentEvidence" (
  "id" TEXT NOT NULL,
  "consentId" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "providerId" TEXT,
  "scope" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "purpose" TEXT NOT NULL,
  "consentState" TEXT NOT NULL,
  "grantedAt" TIMESTAMP(3) NOT NULL,
  "expiresAt" TIMESTAMP(3),
  "evidenceHash" TEXT NOT NULL,
  "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ConsentEvidence_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ConsentEvidence_patientId_capturedAt_idx" ON "ConsentEvidence"("patientId", "capturedAt");
CREATE INDEX "ConsentEvidence_providerId_capturedAt_idx" ON "ConsentEvidence"("providerId", "capturedAt");
CREATE INDEX "ConsentEvidence_consentId_idx" ON "ConsentEvidence"("consentId");

ALTER TABLE "ConsentEvidence"
  ADD CONSTRAINT "ConsentEvidence_consentId_fkey"
  FOREIGN KEY ("consentId") REFERENCES "Consent"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "ConsentEvidence_patientId_fkey"
  FOREIGN KEY ("patientId") REFERENCES "PatientProfile"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "ConsentEvidence_providerId_fkey"
  FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "ConsentEvidence_hash_check"
  CHECK ("evidenceHash" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "ConsentEvidence_scope_check"
  CHECK ("scope" = 'CLINICAL_MEDIA_CAPTURE'),
  ADD CONSTRAINT "ConsentEvidence_version_check"
  CHECK ("version" = 'clinical-media-v1'),
  ADD CONSTRAINT "ConsentEvidence_purpose_check"
  CHECK ("purpose" = 'TREATMENT'),
  ADD CONSTRAINT "ConsentEvidence_state_check"
  CHECK ("consentState" = 'GRANTED');

CREATE TABLE "ClinicalMedia" (
  "id" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "providerId" TEXT,
  "consentEvidenceId" TEXT NOT NULL,
  "purpose" TEXT NOT NULL,
  "status" "ClinicalMediaStatus" NOT NULL DEFAULT 'AVAILABLE',
  "mediaType" TEXT NOT NULL,
  "byteLength" INTEGER NOT NULL,
  "contentDigest" TEXT NOT NULL,
  "storageProvider" TEXT NOT NULL,
  "objectKey" TEXT NOT NULL,
  "blobAlgorithm" TEXT NOT NULL,
  "blobKeyId" TEXT NOT NULL,
  "blobWrappedKey" TEXT NOT NULL,
  "blobIv" TEXT NOT NULL,
  "metadataAlgorithm" TEXT NOT NULL,
  "metadataKeyId" TEXT NOT NULL,
  "metadataWrappedKey" TEXT NOT NULL,
  "metadataIv" TEXT NOT NULL,
  "metadataCiphertext" TEXT NOT NULL,
  "thumbnailObjectKey" TEXT,
  "thumbnailMediaType" TEXT,
  "thumbnailByteLength" INTEGER,
  "thumbnailContentDigest" TEXT,
  "thumbnailBlobAlgorithm" TEXT,
  "thumbnailBlobKeyId" TEXT,
  "thumbnailBlobWrappedKey" TEXT,
  "thumbnailBlobIv" TEXT,
  "createdByAccountId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "removedAt" TIMESTAMP(3),
  CONSTRAINT "ClinicalMedia_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ClinicalMedia_consentEvidenceId_key" ON "ClinicalMedia"("consentEvidenceId");
CREATE UNIQUE INDEX "ClinicalMedia_objectKey_key" ON "ClinicalMedia"("objectKey");
CREATE UNIQUE INDEX "ClinicalMedia_thumbnailObjectKey_key" ON "ClinicalMedia"("thumbnailObjectKey");
CREATE INDEX "ClinicalMedia_patientId_status_createdAt_idx" ON "ClinicalMedia"("patientId", "status", "createdAt");
CREATE INDEX "ClinicalMedia_providerId_status_createdAt_idx" ON "ClinicalMedia"("providerId", "status", "createdAt");
CREATE INDEX "ClinicalMedia_purpose_createdAt_idx" ON "ClinicalMedia"("purpose", "createdAt");

ALTER TABLE "ClinicalMedia"
  ADD CONSTRAINT "ClinicalMedia_patientId_fkey"
  FOREIGN KEY ("patientId") REFERENCES "PatientProfile"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "ClinicalMedia_providerId_fkey"
  FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "ClinicalMedia_consentEvidenceId_fkey"
  FOREIGN KEY ("consentEvidenceId") REFERENCES "ConsentEvidence"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "ClinicalMedia_purpose_check"
  CHECK ("purpose" = 'TREATMENT'),
  ADD CONSTRAINT "ClinicalMedia_media_type_check"
  CHECK ("mediaType" IN ('image/jpeg', 'image/png', 'video/mp4')),
  ADD CONSTRAINT "ClinicalMedia_byte_length_check"
  CHECK ("byteLength" > 0 AND "byteLength" <= 8388608),
  ADD CONSTRAINT "ClinicalMedia_digest_check"
  CHECK ("contentDigest" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "ClinicalMedia_thumbnail_type_check"
  CHECK ("thumbnailMediaType" IS NULL OR "thumbnailMediaType" IN ('image/jpeg', 'image/png')),
  ADD CONSTRAINT "ClinicalMedia_thumbnail_length_check"
  CHECK ("thumbnailByteLength" IS NULL OR ("thumbnailByteLength" > 0 AND "thumbnailByteLength" <= 2097152)),
  ADD CONSTRAINT "ClinicalMedia_thumbnail_digest_check"
  CHECK ("thumbnailContentDigest" IS NULL OR "thumbnailContentDigest" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "ClinicalMedia_thumbnail_envelope_check"
  CHECK (
    ("thumbnailObjectKey" IS NULL
      AND "thumbnailMediaType" IS NULL
      AND "thumbnailByteLength" IS NULL
      AND "thumbnailContentDigest" IS NULL
      AND "thumbnailBlobAlgorithm" IS NULL
      AND "thumbnailBlobKeyId" IS NULL
      AND "thumbnailBlobWrappedKey" IS NULL
      AND "thumbnailBlobIv" IS NULL)
    OR
    ("thumbnailObjectKey" IS NOT NULL
      AND "thumbnailMediaType" IS NOT NULL
      AND "thumbnailByteLength" IS NOT NULL
      AND "thumbnailContentDigest" IS NOT NULL
      AND "thumbnailBlobAlgorithm" IS NOT NULL
      AND "thumbnailBlobKeyId" IS NOT NULL
      AND "thumbnailBlobWrappedKey" IS NOT NULL
      AND "thumbnailBlobIv" IS NOT NULL)
  );

CREATE TABLE "ClinicalMediaAccessGrant" (
  "id" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "mediaId" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "variant" "ClinicalMediaAccessVariant" NOT NULL DEFAULT 'ORIGINAL',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ClinicalMediaAccessGrant_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ClinicalMediaAccessGrant_tokenHash_key" ON "ClinicalMediaAccessGrant"("tokenHash");
CREATE INDEX "ClinicalMediaAccessGrant_mediaId_accountId_expiresAt_idx" ON "ClinicalMediaAccessGrant"("mediaId", "accountId", "expiresAt");
CREATE INDEX "ClinicalMediaAccessGrant_expiresAt_consumedAt_idx" ON "ClinicalMediaAccessGrant"("expiresAt", "consumedAt");

ALTER TABLE "ClinicalMediaAccessGrant"
  ADD CONSTRAINT "ClinicalMediaAccessGrant_mediaId_fkey"
  FOREIGN KEY ("mediaId") REFERENCES "ClinicalMedia"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION carepoint_reject_consent_evidence_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ConsentEvidence is immutable and cannot be updated or deleted';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ConsentEvidence_immutable_trigger"
BEFORE UPDATE OR DELETE ON "ConsentEvidence"
FOR EACH ROW EXECUTE FUNCTION carepoint_reject_consent_evidence_mutation();

REVOKE UPDATE, DELETE ON "ConsentEvidence" FROM PUBLIC;
