CREATE TABLE "PatientClinicalExportJob" (
  "id" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "requestDigest" TEXT NOT NULL,
  "format" TEXT NOT NULL,
  "scopes" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'QUEUED',
  "snapshotAt" TIMESTAMP(3) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "storageProvider" TEXT,
  "objectKey" TEXT,
  "mediaType" TEXT,
  "byteLength" INTEGER,
  "contentDigest" TEXT,
  "blobAlgorithm" TEXT,
  "blobKeyId" TEXT,
  "blobWrappedKey" TEXT,
  "blobIv" TEXT,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseOwner" TEXT,
  "leaseUntil" TIMESTAMP(3),
  "errorCode" TEXT,
  "readyAt" TIMESTAMP(3),
  "expiredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PatientClinicalExportJob_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PatientClinicalExportJob_format_check" CHECK ("format" IN ('JSON','PDF')),
  CONSTRAINT "PatientClinicalExportJob_status_check" CHECK ("status" IN ('QUEUED','PROCESSING','READY','FAILED','EXPIRED')),
  CONSTRAINT "PatientClinicalExportJob_digest_check" CHECK ("requestDigest" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "PatientClinicalExportJob_content_digest_check" CHECK ("contentDigest" IS NULL OR "contentDigest" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "PatientClinicalExportJob_attempt_count_check" CHECK ("attemptCount" >= 0),
  CONSTRAINT "PatientClinicalExportJob_expiry_check" CHECK ("expiresAt" > "snapshotAt")
);

CREATE TABLE "PatientClinicalExportDownloadGrant" (
  "id" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PatientClinicalExportDownloadGrant_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PatientClinicalExportJob_accountId_idempotencyKey_key" ON "PatientClinicalExportJob"("accountId", "idempotencyKey");
CREATE UNIQUE INDEX "PatientClinicalExportJob_objectKey_key" ON "PatientClinicalExportJob"("objectKey");
CREATE INDEX "PatientClinicalExportJob_accountId_createdAt_idx" ON "PatientClinicalExportJob"("accountId", "createdAt");
CREATE INDEX "PatientClinicalExportJob_patientId_status_createdAt_idx" ON "PatientClinicalExportJob"("patientId", "status", "createdAt");
CREATE INDEX "PatientClinicalExportJob_status_availableAt_idx" ON "PatientClinicalExportJob"("status", "availableAt");
CREATE INDEX "PatientClinicalExportJob_leaseUntil_idx" ON "PatientClinicalExportJob"("leaseUntil");
CREATE INDEX "PatientClinicalExportJob_expiresAt_status_idx" ON "PatientClinicalExportJob"("expiresAt", "status");
CREATE UNIQUE INDEX "PatientClinicalExportDownloadGrant_tokenHash_key" ON "PatientClinicalExportDownloadGrant"("tokenHash");
CREATE INDEX "PatientClinicalExportDownloadGrant_jobId_accountId_expiresAt_idx" ON "PatientClinicalExportDownloadGrant"("jobId", "accountId", "expiresAt");
CREATE INDEX "PatientClinicalExportDownloadGrant_expiresAt_consumedAt_idx" ON "PatientClinicalExportDownloadGrant"("expiresAt", "consumedAt");

ALTER TABLE "PatientClinicalExportJob" ADD CONSTRAINT "PatientClinicalExportJob_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "PatientProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PatientClinicalExportJob" ADD CONSTRAINT "PatientClinicalExportJob_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PatientClinicalExportDownloadGrant" ADD CONSTRAINT "PatientClinicalExportDownloadGrant_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "PatientClinicalExportJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PatientClinicalExportDownloadGrant" ADD CONSTRAINT "PatientClinicalExportDownloadGrant_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION carepoint_guard_patient_export_identity()
RETURNS trigger AS $$
BEGIN
  IF NEW."patientId" IS DISTINCT FROM OLD."patientId"
     OR NEW."accountId" IS DISTINCT FROM OLD."accountId"
     OR NEW."idempotencyKey" IS DISTINCT FROM OLD."idempotencyKey"
     OR NEW."requestDigest" IS DISTINCT FROM OLD."requestDigest"
     OR NEW."format" IS DISTINCT FROM OLD."format"
     OR NEW."scopes" IS DISTINCT FROM OLD."scopes"
     OR NEW."snapshotAt" IS DISTINCT FROM OLD."snapshotAt"
     OR NEW."expiresAt" IS DISTINCT FROM OLD."expiresAt"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'patient export request identity is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "PatientClinicalExportJob_guard_identity"
BEFORE UPDATE ON "PatientClinicalExportJob"
FOR EACH ROW EXECUTE FUNCTION carepoint_guard_patient_export_identity();

CREATE OR REPLACE FUNCTION carepoint_reject_patient_export_grant_mutation()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'patient export grants cannot be deleted';
  END IF;
  IF NEW."jobId" IS DISTINCT FROM OLD."jobId"
     OR NEW."accountId" IS DISTINCT FROM OLD."accountId"
     OR NEW."tokenHash" IS DISTINCT FROM OLD."tokenHash"
     OR NEW."expiresAt" IS DISTINCT FROM OLD."expiresAt"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'patient export grant identity is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "PatientClinicalExportDownloadGrant_guard"
BEFORE UPDATE OR DELETE ON "PatientClinicalExportDownloadGrant"
FOR EACH ROW EXECUTE FUNCTION carepoint_reject_patient_export_grant_mutation();

REVOKE DELETE ON "PatientClinicalExportJob", "PatientClinicalExportDownloadGrant" FROM PUBLIC;
