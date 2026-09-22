CREATE OR REPLACE FUNCTION carepoint_reject_clinical_document_version_identity_change()
RETURNS trigger AS $$
DECLARE
  retention_tombstone boolean;
BEGIN
  retention_tombstone :=
    NEW."status" = 'REMOVED'
    AND NEW."objectKey" IS NULL
    AND NEW."contentDigest" IS NULL
    AND NEW."metadataAlgorithm" = 'RETENTION_PURGED'
    AND NEW."metadataKeyId" = 'RETENTION_PURGED'
    AND NEW."metadataWrappedKey" = 'RETENTION_PURGED'
    AND NEW."metadataIv" = 'RETENTION_PURGED'
    AND NEW."metadataCiphertext" = 'RETENTION_PURGED';

  IF NEW."logicalDocumentId" IS DISTINCT FROM OLD."logicalDocumentId"
     OR NEW."documentVersion" IS DISTINCT FROM OLD."documentVersion"
     OR NEW."effectiveDate" IS DISTINCT FROM OLD."effectiveDate"
     OR NEW."sourceType" IS DISTINCT FROM OLD."sourceType"
     OR NEW."sourceRef" IS DISTINCT FROM OLD."sourceRef"
     OR NEW."supersedesDocumentId" IS DISTINCT FROM OLD."supersedesDocumentId"
     OR (
       NEW."contentDigest" IS DISTINCT FROM OLD."contentDigest"
       AND NOT retention_tombstone
     ) THEN
    RAISE EXCEPTION 'clinical document version identity is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION carepoint_reject_clinical_document_version_identity_change() IS
  'Preserves immutable document-version identity while allowing the governed retention engine to erase live-document content material after immutable DocumentVersion evidence has been captured.';
