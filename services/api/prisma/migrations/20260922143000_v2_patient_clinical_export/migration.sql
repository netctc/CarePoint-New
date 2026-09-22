CREATE TYPE "PatientClinicalExportFormat" AS ENUM ('JSON', 'PDF');
CREATE TYPE "PatientClinicalExportStatus" AS ENUM ('PENDING', 'PROCESSING', 'READY', 'FAILED', 'EXPIRED');

CREATE TABLE "PatientClinicalExportJob" (
  "id" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "format" "PatientClinicalExportFormat" NOT NULL,
  "scope" TEXT NOT NULL DEFAULT 'PATIENT_CLINICAL_PORTABILITY',
  "status" "PatientClinicalExportStatus" NOT NULL DEFAULT 'PENDING',
  "clientRequestId" TEXT NOT NULL,
  "requestDigest" TEXT NOT NULL,
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
  CONSTRAINT "PatientClinicalExportJob_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PatientClinicalExportJob_scope_check" CHECK ("scope" = 'PATIENT_CLINICAL_PORTABILITY'),
  CONSTRAINT "PatientClinicalExportJob_request_digest_check" CHECK (length("requestDigest") = 64),
  CONSTRAINT "PatientClinicalExportJob_digest_check" CHECK ("contentDigest" IS NULL OR length("contentDigest") = 64),
  CONSTRAINT "PatientClinicalExportJob_byte_length_check" CHECK ("byteLength" IS NULL OR "byteLength" >= 0),
  CONSTRAINT "PatientClinicalExportJob_ready_complete_check" CHECK (
    "status" <> 'READY'
    OR (
      "objectKey" IS NOT NULL
      AND "mediaType" IS NOT NULL
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

CREATE TABLE "PatientClinicalExportDownloadGrant" (
  "id" TEXT NOT NULL,
  "exportJobId" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PatientClinicalExportDownloadGrant_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PatientClinicalExportDownloadGrant_token_hash_check" CHECK (length("tokenHash") = 64)
);

CREATE UNIQUE INDEX "PatientClinicalExportJob_accountId_clientRequestId_key"
  ON "PatientClinicalExportJob"("accountId", "clientRequestId");
CREATE UNIQUE INDEX "PatientClinicalExportJob_objectKey_key"
  ON "PatientClinicalExportJob"("objectKey");
CREATE INDEX "PatientClinicalExportJob_accountId_createdAt_idx"
  ON "PatientClinicalExportJob"("accountId", "createdAt");
CREATE INDEX "PatientClinicalExportJob_status_createdAt_idx"
  ON "PatientClinicalExportJob"("status", "createdAt");
CREATE INDEX "PatientClinicalExportJob_status_expiresAt_idx"
  ON "PatientClinicalExportJob"("status", "expiresAt");
CREATE UNIQUE INDEX "PatientClinicalExportDownloadGrant_tokenHash_key"
  ON "PatientClinicalExportDownloadGrant"("tokenHash");
CREATE INDEX "PatientClinicalExportDownloadGrant_job_account_expiry_idx"
  ON "PatientClinicalExportDownloadGrant"("exportJobId", "accountId", "expiresAt");
CREATE INDEX "PatientClinicalExportDownloadGrant_expiry_consumed_idx"
  ON "PatientClinicalExportDownloadGrant"("expiresAt", "consumedAt");

ALTER TABLE "PatientClinicalExportJob"
  ADD CONSTRAINT "PatientClinicalExportJob_patientId_fkey"
  FOREIGN KEY ("patientId") REFERENCES "PatientProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PatientClinicalExportJob"
  ADD CONSTRAINT "PatientClinicalExportJob_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PatientClinicalExportDownloadGrant"
  ADD CONSTRAINT "PatientClinicalExportDownloadGrant_exportJobId_fkey"
  FOREIGN KEY ("exportJobId") REFERENCES "PatientClinicalExportJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PatientClinicalExportDownloadGrant"
  ADD CONSTRAINT "PatientClinicalExportDownloadGrant_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION carepoint_reject_patient_export_grant_delete()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'patient clinical export download-grant evidence cannot be deleted';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "PatientClinicalExportDownloadGrant_no_delete"
BEFORE DELETE ON "PatientClinicalExportDownloadGrant"
FOR EACH ROW EXECUTE FUNCTION carepoint_reject_patient_export_grant_delete();

REVOKE DELETE ON "PatientClinicalExportDownloadGrant" FROM PUBLIC;
