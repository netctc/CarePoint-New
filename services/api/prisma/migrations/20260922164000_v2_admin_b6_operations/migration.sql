CREATE TABLE "AuditExportJob" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "filter" JSONB NOT NULL,
  "filterDigest" TEXT NOT NULL,
  "objectKey" TEXT,
  "mediaType" TEXT,
  "byteLength" INTEGER,
  "contentDigest" TEXT,
  "algorithm" TEXT NOT NULL DEFAULT '',
  "keyId" TEXT NOT NULL DEFAULT '',
  "wrappedKey" TEXT NOT NULL DEFAULT '',
  "iv" TEXT NOT NULL DEFAULT '',
  "errorCode" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "cleanedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AuditExportJob_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AuditExportJob_status_check" CHECK ("status" IN ('PENDING','PROCESSING','READY','FAILED','EXPIRED')),
  CONSTRAINT "AuditExportJob_filter_digest_check" CHECK (length("filterDigest") = 64),
  CONSTRAINT "AuditExportJob_content_digest_check" CHECK ("contentDigest" IS NULL OR length("contentDigest") = 64),
  CONSTRAINT "AuditExportJob_byte_length_check" CHECK ("byteLength" IS NULL OR "byteLength" >= 0),
  CONSTRAINT "AuditExportJob_ready_check" CHECK (
    "status" <> 'READY'
    OR (
      "objectKey" IS NOT NULL
      AND "mediaType" = 'application/x-ndjson'
      AND "byteLength" IS NOT NULL
      AND "contentDigest" IS NOT NULL
      AND "algorithm" <> ''
      AND "keyId" <> ''
      AND "wrappedKey" <> ''
      AND "iv" <> ''
      AND "completedAt" IS NOT NULL
    )
  )
);

CREATE TABLE "AuditExportDownloadGrant" (
  "id" TEXT NOT NULL,
  "exportJobId" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditExportDownloadGrant_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AuditExportDownloadGrant_token_hash_check" CHECK (length("tokenHash") = 64)
);

CREATE UNIQUE INDEX "AuditExportJob_objectKey_key" ON "AuditExportJob"("objectKey");
CREATE INDEX "AuditExportJob_accountId_createdAt_idx" ON "AuditExportJob"("accountId","createdAt");
CREATE INDEX "AuditExportJob_status_createdAt_idx" ON "AuditExportJob"("status","createdAt");
CREATE INDEX "AuditExportJob_status_expiresAt_idx" ON "AuditExportJob"("status","expiresAt");
CREATE UNIQUE INDEX "AuditExportDownloadGrant_tokenHash_key" ON "AuditExportDownloadGrant"("tokenHash");
CREATE INDEX "AuditExportDownloadGrant_job_account_expiry_idx" ON "AuditExportDownloadGrant"("exportJobId","accountId","expiresAt");
CREATE INDEX "AuditExportDownloadGrant_expiry_consumed_idx" ON "AuditExportDownloadGrant"("expiresAt","consumedAt");

ALTER TABLE "AuditExportJob"
  ADD CONSTRAINT "AuditExportJob_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AuditExportDownloadGrant"
  ADD CONSTRAINT "AuditExportDownloadGrant_exportJobId_fkey"
  FOREIGN KEY ("exportJobId") REFERENCES "AuditExportJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AuditExportDownloadGrant"
  ADD CONSTRAINT "AuditExportDownloadGrant_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION carepoint_reject_audit_export_job_delete()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit export evidence cannot be deleted';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION carepoint_reject_audit_export_grant_delete()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit export download-grant evidence cannot be deleted';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AuditExportJob_no_delete"
BEFORE DELETE ON "AuditExportJob"
FOR EACH ROW EXECUTE FUNCTION carepoint_reject_audit_export_job_delete();

CREATE TRIGGER "AuditExportDownloadGrant_no_delete"
BEFORE DELETE ON "AuditExportDownloadGrant"
FOR EACH ROW EXECUTE FUNCTION carepoint_reject_audit_export_grant_delete();

REVOKE DELETE ON "AuditExportJob" FROM PUBLIC;
REVOKE DELETE ON "AuditExportDownloadGrant" FROM PUBLIC;
