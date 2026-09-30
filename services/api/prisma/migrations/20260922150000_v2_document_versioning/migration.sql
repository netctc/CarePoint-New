ALTER TABLE "ClinicalDocument"
  ADD COLUMN "logicalDocumentId" TEXT,
  ADD COLUMN "documentVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "effectiveDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "sourceType" TEXT NOT NULL DEFAULT 'AUTO',
  ADD COLUMN "sourceRef" TEXT,
  ADD COLUMN "supersedesDocumentId" TEXT;

UPDATE "ClinicalDocument"
SET
  "logicalDocumentId" = "id",
  "sourceType" = CASE
    WHEN "kind" = 'PATIENT_UPLOAD' THEN 'PATIENT_UPLOAD'
    WHEN "storageMode" = 'EXTERNAL_REFERENCE' THEN 'EXTERNAL_REFERENCE'
    WHEN "providerId" IS NOT NULL THEN 'PROVIDER_UPLOAD'
    ELSE 'SYSTEM_CAPTURED'
  END,
  "sourceRef" = COALESCE("encounterRef", "orderId")
WHERE "logicalDocumentId" IS NULL;

ALTER TABLE "ClinicalDocument"
  ALTER COLUMN "logicalDocumentId" SET NOT NULL,
  ADD CONSTRAINT "ClinicalDocument_documentVersion_check" CHECK ("documentVersion" >= 1),
  ADD CONSTRAINT "ClinicalDocument_sourceType_check" CHECK ("sourceType" IN ('AUTO','PATIENT_UPLOAD','PROVIDER_UPLOAD','EXTERNAL_REFERENCE','IMPORTED','SYSTEM_CAPTURED'));

CREATE UNIQUE INDEX "ClinicalDocument_logicalDocumentId_documentVersion_key"
  ON "ClinicalDocument"("logicalDocumentId", "documentVersion");
CREATE INDEX "ClinicalDocument_logicalDocumentId_documentVersion_idx"
  ON "ClinicalDocument"("logicalDocumentId", "documentVersion");
CREATE INDEX "ClinicalDocument_supersedesDocumentId_idx"
  ON "ClinicalDocument"("supersedesDocumentId");

ALTER TABLE "ClinicalDocument"
  ADD CONSTRAINT "ClinicalDocument_supersedesDocumentId_fkey"
  FOREIGN KEY ("supersedesDocumentId") REFERENCES "ClinicalDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "DocumentVersion" (
  "id" TEXT NOT NULL,
  "logicalDocumentId" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "documentType" TEXT NOT NULL,
  "effectiveDate" TIMESTAMP(3) NOT NULL,
  "sourceType" TEXT NOT NULL,
  "sourceRef" TEXT,
  "hashAlgorithm" TEXT NOT NULL,
  "versionHash" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "providerId" TEXT,
  "encounterRef" TEXT,
  "orderId" TEXT,
  "supersedesDocumentId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DocumentVersion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DocumentVersion_version_check" CHECK ("version" >= 1),
  CONSTRAINT "DocumentVersion_hash_check" CHECK (length("versionHash") IN (32, 64)),
  CONSTRAINT "DocumentVersion_hash_algorithm_check" CHECK ("hashAlgorithm" IN ('SHA-256','MD5-METADATA'))
);

CREATE UNIQUE INDEX "DocumentVersion_documentId_key" ON "DocumentVersion"("documentId");
CREATE UNIQUE INDEX "DocumentVersion_logicalDocumentId_version_key" ON "DocumentVersion"("logicalDocumentId", "version");
CREATE INDEX "DocumentVersion_logicalDocumentId_version_idx" ON "DocumentVersion"("logicalDocumentId", "version");
CREATE INDEX "DocumentVersion_patientId_effectiveDate_idx" ON "DocumentVersion"("patientId", "effectiveDate");
CREATE INDEX "DocumentVersion_providerId_effectiveDate_idx" ON "DocumentVersion"("providerId", "effectiveDate");
CREATE INDEX "DocumentVersion_encounterRef_documentType_idx" ON "DocumentVersion"("encounterRef", "documentType");
CREATE INDEX "DocumentVersion_orderId_documentType_idx" ON "DocumentVersion"("orderId", "documentType");

ALTER TABLE "DocumentVersion"
  ADD CONSTRAINT "DocumentVersion_documentId_fkey"
  FOREIGN KEY ("documentId") REFERENCES "ClinicalDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DocumentVersion"
  ADD CONSTRAINT "DocumentVersion_patientId_fkey"
  FOREIGN KEY ("patientId") REFERENCES "PatientProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "DocumentVersion" (
  "id", "logicalDocumentId", "documentId", "version", "documentType", "effectiveDate",
  "sourceType", "sourceRef", "hashAlgorithm", "versionHash", "patientId", "providerId",
  "encounterRef", "orderId", "supersedesDocumentId", "createdAt"
)
SELECT
  'dv:' || "id",
  "logicalDocumentId",
  "id",
  "documentVersion",
  "kind"::text,
  "effectiveDate",
  "sourceType",
  "sourceRef",
  CASE WHEN "contentDigest" IS NOT NULL THEN 'SHA-256' ELSE 'MD5-METADATA' END,
  COALESCE("contentDigest", md5(COALESCE("metadataCiphertext", '') || ':' || "id")),
  "patientId",
  "providerId",
  "encounterRef",
  "orderId",
  "supersedesDocumentId",
  "createdAt"
FROM "ClinicalDocument";

CREATE OR REPLACE FUNCTION carepoint_prepare_clinical_document_version()
RETURNS trigger AS $$
BEGIN
  IF NEW."logicalDocumentId" IS NULL OR NEW."logicalDocumentId" = '' THEN
    NEW."logicalDocumentId" := NEW."id";
  END IF;
  IF NEW."documentVersion" IS NULL OR NEW."documentVersion" < 1 THEN
    NEW."documentVersion" := 1;
  END IF;
  IF NEW."sourceType" IS NULL OR NEW."sourceType" = 'AUTO' THEN
    NEW."sourceType" := CASE
      WHEN NEW."kind" = 'PATIENT_UPLOAD' THEN 'PATIENT_UPLOAD'
      WHEN NEW."storageMode" = 'EXTERNAL_REFERENCE' THEN 'EXTERNAL_REFERENCE'
      WHEN NEW."providerId" IS NOT NULL THEN 'PROVIDER_UPLOAD'
      ELSE 'SYSTEM_CAPTURED'
    END;
  END IF;
  IF NEW."sourceRef" IS NULL THEN
    NEW."sourceRef" := COALESCE(NEW."encounterRef", NEW."orderId");
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ClinicalDocument_prepare_version_metadata"
BEFORE INSERT ON "ClinicalDocument"
FOR EACH ROW EXECUTE FUNCTION carepoint_prepare_clinical_document_version();

CREATE OR REPLACE FUNCTION carepoint_snapshot_clinical_document_version()
RETURNS trigger AS $$
BEGIN
  INSERT INTO "DocumentVersion" (
    "id", "logicalDocumentId", "documentId", "version", "documentType", "effectiveDate",
    "sourceType", "sourceRef", "hashAlgorithm", "versionHash", "patientId", "providerId",
    "encounterRef", "orderId", "supersedesDocumentId", "createdAt"
  ) VALUES (
    'dv:' || NEW."id",
    NEW."logicalDocumentId",
    NEW."id",
    NEW."documentVersion",
    NEW."kind"::text,
    NEW."effectiveDate",
    NEW."sourceType",
    NEW."sourceRef",
    CASE WHEN NEW."contentDigest" IS NOT NULL THEN 'SHA-256' ELSE 'MD5-METADATA' END,
    COALESCE(NEW."contentDigest", md5(COALESCE(NEW."metadataCiphertext", '') || ':' || NEW."id")),
    NEW."patientId",
    NEW."providerId",
    NEW."encounterRef",
    NEW."orderId",
    NEW."supersedesDocumentId",
    NEW."createdAt"
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ClinicalDocument_snapshot_version"
AFTER INSERT ON "ClinicalDocument"
FOR EACH ROW EXECUTE FUNCTION carepoint_snapshot_clinical_document_version();

CREATE OR REPLACE FUNCTION carepoint_reject_document_version_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'document version history is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "DocumentVersion_no_update"
BEFORE UPDATE ON "DocumentVersion"
FOR EACH ROW EXECUTE FUNCTION carepoint_reject_document_version_mutation();
CREATE TRIGGER "DocumentVersion_no_delete"
BEFORE DELETE ON "DocumentVersion"
FOR EACH ROW EXECUTE FUNCTION carepoint_reject_document_version_mutation();

CREATE OR REPLACE FUNCTION carepoint_reject_clinical_document_version_identity_change()
RETURNS trigger AS $$
BEGIN
  IF NEW."logicalDocumentId" IS DISTINCT FROM OLD."logicalDocumentId"
     OR NEW."documentVersion" IS DISTINCT FROM OLD."documentVersion"
     OR NEW."effectiveDate" IS DISTINCT FROM OLD."effectiveDate"
     OR NEW."sourceType" IS DISTINCT FROM OLD."sourceType"
     OR NEW."sourceRef" IS DISTINCT FROM OLD."sourceRef"
     OR NEW."supersedesDocumentId" IS DISTINCT FROM OLD."supersedesDocumentId"
     OR NEW."contentDigest" IS DISTINCT FROM OLD."contentDigest" THEN
    RAISE EXCEPTION 'clinical document version identity is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ClinicalDocument_version_identity_immutable"
BEFORE UPDATE ON "ClinicalDocument"
FOR EACH ROW EXECUTE FUNCTION carepoint_reject_clinical_document_version_identity_change();

REVOKE UPDATE, DELETE ON "DocumentVersion" FROM PUBLIC;
