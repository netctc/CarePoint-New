CREATE OR REPLACE FUNCTION carepoint_snapshot_clinical_document_version()
RETURNS trigger AS $$
DECLARE
  canonical_sha256 boolean;
BEGIN
  canonical_sha256 := NEW."contentDigest" IS NOT NULL
    AND NEW."contentDigest" ~ '^[0-9A-Fa-f]{64}$';

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
    CASE WHEN canonical_sha256 THEN 'SHA-256' ELSE 'MD5-METADATA' END,
    CASE
      WHEN canonical_sha256 THEN lower(NEW."contentDigest")
      ELSE md5(COALESCE(NEW."metadataCiphertext", '') || ':' || NEW."id")
    END,
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

COMMENT ON FUNCTION carepoint_snapshot_clinical_document_version() IS
  'Creates immutable document-version evidence. Canonical 64-character hexadecimal content digests are retained as SHA-256; legacy/noncanonical digests fall back to a deterministic metadata fingerprint without mutating the source ClinicalDocument.';
