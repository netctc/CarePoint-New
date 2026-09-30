-- CarePoint V2 / BE-029:
-- immutable version identity and append-only evidence for encrypted clinical media.

ALTER TYPE "ClinicalMediaStatus" ADD VALUE IF NOT EXISTS 'SUPERSEDED';

ALTER TABLE "ClinicalMedia"
  ADD COLUMN "logicalMediaId" TEXT,
  ADD COLUMN "mediaVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "effectiveDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "sourceType" TEXT,
  ADD COLUMN "sourceRef" TEXT,
  ADD COLUMN "supersedesMediaId" TEXT;

UPDATE "ClinicalMedia"
SET
  "logicalMediaId" = "id",
  "mediaVersion" = 1,
  "effectiveDate" = "createdAt",
  "sourceType" = CASE WHEN "providerId" IS NULL THEN 'PATIENT_UPLOAD' ELSE 'PROVIDER_CAPTURE' END
WHERE "logicalMediaId" IS NULL;

ALTER TABLE "ClinicalMedia"
  ALTER COLUMN "logicalMediaId" SET NOT NULL,
  ALTER COLUMN "sourceType" SET NOT NULL,
  ADD CONSTRAINT "ClinicalMedia_media_version_check" CHECK ("mediaVersion" > 0),
  ADD CONSTRAINT "ClinicalMedia_source_type_check" CHECK ("sourceType" IN ('PATIENT_UPLOAD', 'PROVIDER_CAPTURE')),
  ADD CONSTRAINT "ClinicalMedia_supersedesMediaId_fkey"
    FOREIGN KEY ("supersedesMediaId") REFERENCES "ClinicalMedia"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE UNIQUE INDEX "ClinicalMedia_logicalMediaId_mediaVersion_key"
  ON "ClinicalMedia"("logicalMediaId", "mediaVersion");
CREATE INDEX "ClinicalMedia_logicalMediaId_mediaVersion_idx"
  ON "ClinicalMedia"("logicalMediaId", "mediaVersion");

CREATE TABLE "ClinicalMediaVersion" (
  "id" TEXT NOT NULL,
  "logicalMediaId" TEXT NOT NULL,
  "mediaId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "mediaType" TEXT NOT NULL,
  "effectiveDate" TIMESTAMP(3) NOT NULL,
  "sourceType" TEXT NOT NULL,
  "sourceRef" TEXT,
  "contentDigest" TEXT NOT NULL,
  "thumbnailContentDigest" TEXT,
  "patientId" TEXT NOT NULL,
  "providerId" TEXT,
  "consentEvidenceId" TEXT NOT NULL,
  "supersedesMediaId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ClinicalMediaVersion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ClinicalMediaVersion_mediaId_key" ON "ClinicalMediaVersion"("mediaId");
CREATE UNIQUE INDEX "ClinicalMediaVersion_logicalMediaId_version_key"
  ON "ClinicalMediaVersion"("logicalMediaId", "version");
CREATE INDEX "ClinicalMediaVersion_patientId_effectiveDate_idx"
  ON "ClinicalMediaVersion"("patientId", "effectiveDate");
CREATE INDEX "ClinicalMediaVersion_providerId_effectiveDate_idx"
  ON "ClinicalMediaVersion"("providerId", "effectiveDate");

ALTER TABLE "ClinicalMediaVersion"
  ADD CONSTRAINT "ClinicalMediaVersion_version_check" CHECK ("version" > 0),
  ADD CONSTRAINT "ClinicalMediaVersion_digest_check" CHECK ("contentDigest" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "ClinicalMediaVersion_thumbnail_digest_check"
    CHECK ("thumbnailContentDigest" IS NULL OR "thumbnailContentDigest" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "ClinicalMediaVersion_source_type_check"
    CHECK ("sourceType" IN ('PATIENT_UPLOAD', 'PROVIDER_CAPTURE')),
  ADD CONSTRAINT "ClinicalMediaVersion_mediaId_fkey"
    FOREIGN KEY ("mediaId") REFERENCES "ClinicalMedia"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "ClinicalMediaVersion_patientId_fkey"
    FOREIGN KEY ("patientId") REFERENCES "PatientProfile"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "ClinicalMediaVersion_providerId_fkey"
    FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "ClinicalMediaVersion_consentEvidenceId_fkey"
    FOREIGN KEY ("consentEvidenceId") REFERENCES "ConsentEvidence"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "ClinicalMediaVersion_supersedesMediaId_fkey"
    FOREIGN KEY ("supersedesMediaId") REFERENCES "ClinicalMedia"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

INSERT INTO "ClinicalMediaVersion" (
  "id", "logicalMediaId", "mediaId", "version", "mediaType", "effectiveDate",
  "sourceType", "sourceRef", "contentDigest", "thumbnailContentDigest", "patientId",
  "providerId", "consentEvidenceId", "supersedesMediaId", "createdAt"
)
SELECT
  'cmv:' || "id",
  "logicalMediaId",
  "id",
  "mediaVersion",
  "mediaType",
  "effectiveDate",
  "sourceType",
  "sourceRef",
  "contentDigest",
  "thumbnailContentDigest",
  "patientId",
  "providerId",
  "consentEvidenceId",
  "supersedesMediaId",
  "createdAt"
FROM "ClinicalMedia"
ON CONFLICT ("mediaId") DO NOTHING;

-- Backward compatibility: pre-BE-029 application writers are allowed to omit
-- version identity fields. PostgreSQL initializes them before constraints and
-- the append-only snapshot trigger run. This avoids changing the accepted
-- encrypted media capture contract while all new rows still receive canonical
-- version identity.
CREATE OR REPLACE FUNCTION carepoint_initialize_clinical_media_version_identity()
RETURNS trigger AS $$
BEGIN
  IF NEW."logicalMediaId" IS NULL THEN
    NEW."logicalMediaId" := NEW."id";
  END IF;
  IF NEW."mediaVersion" IS NULL THEN
    NEW."mediaVersion" := 1;
  END IF;
  IF NEW."effectiveDate" IS NULL THEN
    NEW."effectiveDate" := COALESCE(NEW."createdAt", CURRENT_TIMESTAMP);
  END IF;
  IF NEW."sourceType" IS NULL THEN
    NEW."sourceType" := CASE WHEN NEW."providerId" IS NULL THEN 'PATIENT_UPLOAD' ELSE 'PROVIDER_CAPTURE' END;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ClinicalMedia_version_identity_init_trigger"
BEFORE INSERT ON "ClinicalMedia"
FOR EACH ROW EXECUTE FUNCTION carepoint_initialize_clinical_media_version_identity();

CREATE OR REPLACE FUNCTION carepoint_snapshot_clinical_media_version()
RETURNS trigger AS $$
BEGIN
  INSERT INTO "ClinicalMediaVersion" (
    "id", "logicalMediaId", "mediaId", "version", "mediaType", "effectiveDate",
    "sourceType", "sourceRef", "contentDigest", "thumbnailContentDigest", "patientId",
    "providerId", "consentEvidenceId", "supersedesMediaId", "createdAt"
  ) VALUES (
    'cmv:' || NEW."id",
    NEW."logicalMediaId",
    NEW."id",
    NEW."mediaVersion",
    NEW."mediaType",
    NEW."effectiveDate",
    NEW."sourceType",
    NEW."sourceRef",
    NEW."contentDigest",
    NEW."thumbnailContentDigest",
    NEW."patientId",
    NEW."providerId",
    NEW."consentEvidenceId",
    NEW."supersedesMediaId",
    NEW."createdAt"
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ClinicalMedia_version_snapshot_trigger"
AFTER INSERT ON "ClinicalMedia"
FOR EACH ROW EXECUTE FUNCTION carepoint_snapshot_clinical_media_version();

CREATE OR REPLACE FUNCTION carepoint_protect_clinical_media_immutable_payload()
RETURNS trigger AS $$
BEGIN
  IF NEW."patientId" IS DISTINCT FROM OLD."patientId"
    OR NEW."providerId" IS DISTINCT FROM OLD."providerId"
    OR NEW."consentEvidenceId" IS DISTINCT FROM OLD."consentEvidenceId"
    OR NEW."purpose" IS DISTINCT FROM OLD."purpose"
    OR NEW."logicalMediaId" IS DISTINCT FROM OLD."logicalMediaId"
    OR NEW."mediaVersion" IS DISTINCT FROM OLD."mediaVersion"
    OR NEW."effectiveDate" IS DISTINCT FROM OLD."effectiveDate"
    OR NEW."sourceType" IS DISTINCT FROM OLD."sourceType"
    OR NEW."sourceRef" IS DISTINCT FROM OLD."sourceRef"
    OR NEW."supersedesMediaId" IS DISTINCT FROM OLD."supersedesMediaId"
    OR NEW."mediaType" IS DISTINCT FROM OLD."mediaType"
    OR NEW."byteLength" IS DISTINCT FROM OLD."byteLength"
    OR NEW."contentDigest" IS DISTINCT FROM OLD."contentDigest"
    OR NEW."storageProvider" IS DISTINCT FROM OLD."storageProvider"
    OR NEW."objectKey" IS DISTINCT FROM OLD."objectKey"
    OR NEW."blobAlgorithm" IS DISTINCT FROM OLD."blobAlgorithm"
    OR NEW."blobKeyId" IS DISTINCT FROM OLD."blobKeyId"
    OR NEW."blobWrappedKey" IS DISTINCT FROM OLD."blobWrappedKey"
    OR NEW."blobIv" IS DISTINCT FROM OLD."blobIv"
    OR NEW."metadataAlgorithm" IS DISTINCT FROM OLD."metadataAlgorithm"
    OR NEW."metadataKeyId" IS DISTINCT FROM OLD."metadataKeyId"
    OR NEW."metadataWrappedKey" IS DISTINCT FROM OLD."metadataWrappedKey"
    OR NEW."metadataIv" IS DISTINCT FROM OLD."metadataIv"
    OR NEW."metadataCiphertext" IS DISTINCT FROM OLD."metadataCiphertext"
    OR NEW."thumbnailObjectKey" IS DISTINCT FROM OLD."thumbnailObjectKey"
    OR NEW."thumbnailMediaType" IS DISTINCT FROM OLD."thumbnailMediaType"
    OR NEW."thumbnailByteLength" IS DISTINCT FROM OLD."thumbnailByteLength"
    OR NEW."thumbnailContentDigest" IS DISTINCT FROM OLD."thumbnailContentDigest"
    OR NEW."thumbnailBlobAlgorithm" IS DISTINCT FROM OLD."thumbnailBlobAlgorithm"
    OR NEW."thumbnailBlobKeyId" IS DISTINCT FROM OLD."thumbnailBlobKeyId"
    OR NEW."thumbnailBlobWrappedKey" IS DISTINCT FROM OLD."thumbnailBlobWrappedKey"
    OR NEW."thumbnailBlobIv" IS DISTINCT FROM OLD."thumbnailBlobIv"
    OR NEW."createdByAccountId" IS DISTINCT FROM OLD."createdByAccountId"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
  THEN
    RAISE EXCEPTION 'ClinicalMedia immutable payload/version identity cannot be modified; publish a new version instead';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ClinicalMedia_immutable_payload_trigger"
BEFORE UPDATE ON "ClinicalMedia"
FOR EACH ROW EXECUTE FUNCTION carepoint_protect_clinical_media_immutable_payload();

CREATE OR REPLACE FUNCTION carepoint_reject_clinical_media_version_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ClinicalMediaVersion is append-only and cannot be updated or deleted';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ClinicalMediaVersion_immutable_trigger"
BEFORE UPDATE OR DELETE ON "ClinicalMediaVersion"
FOR EACH ROW EXECUTE FUNCTION carepoint_reject_clinical_media_version_mutation();

REVOKE UPDATE, DELETE ON "ClinicalMediaVersion" FROM PUBLIC;
