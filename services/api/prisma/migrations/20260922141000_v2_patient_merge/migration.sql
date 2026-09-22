CREATE TABLE "PatientMergeJob" (
  "id" TEXT NOT NULL,
  "canonicalPatientId" TEXT NOT NULL,
  "duplicatePatientId" TEXT NOT NULL,
  "duplicateUserId" TEXT NOT NULL,
  "duplicateAccountStatus" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PREVIEWED',
  "previewDigest" TEXT NOT NULL,
  "sourceRowCount" INTEGER NOT NULL DEFAULT 0,
  "conflictCount" INTEGER NOT NULL DEFAULT 0,
  "movementCount" INTEGER NOT NULL DEFAULT 0,
  "createdByActorId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "executedAt" TIMESTAMP(3),
  "rolledBackAt" TIMESTAMP(3),
  CONSTRAINT "PatientMergeJob_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PatientMergeJob_status_check" CHECK ("status" IN ('PREVIEWED','EXECUTED','ROLLED_BACK','BLOCKED','FAILED')),
  CONSTRAINT "PatientMergeJob_distinct_patients_check" CHECK ("canonicalPatientId" <> "duplicatePatientId"),
  CONSTRAINT "PatientMergeJob_counts_check" CHECK ("sourceRowCount" >= 0 AND "conflictCount" >= 0 AND "movementCount" >= 0)
);
CREATE INDEX "PatientMergeJob_status_createdAt_idx" ON "PatientMergeJob"("status", "createdAt");
CREATE INDEX "PatientMergeJob_canonicalPatientId_createdAt_idx" ON "PatientMergeJob"("canonicalPatientId", "createdAt");
CREATE INDEX "PatientMergeJob_duplicatePatientId_createdAt_idx" ON "PatientMergeJob"("duplicatePatientId", "createdAt");

CREATE TABLE "MergeConflict" (
  "id" TEXT NOT NULL,
  "mergeJobId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "domain" TEXT NOT NULL,
  "entityType" TEXT,
  "entityId" TEXT,
  "blocking" BOOLEAN NOT NULL DEFAULT true,
  "evidence" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MergeConflict_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "MergeConflict_mergeJobId_blocking_domain_idx" ON "MergeConflict"("mergeJobId", "blocking", "domain");
ALTER TABLE "MergeConflict" ADD CONSTRAINT "MergeConflict_mergeJobId_fkey"
  FOREIGN KEY ("mergeJobId") REFERENCES "PatientMergeJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "PatientAlias" (
  "id" TEXT NOT NULL,
  "aliasPatientId" TEXT NOT NULL,
  "canonicalPatientId" TEXT NOT NULL,
  "mergeJobId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reversedAt" TIMESTAMP(3),
  CONSTRAINT "PatientAlias_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PatientAlias_status_check" CHECK ("status" IN ('ACTIVE','REVERSED')),
  CONSTRAINT "PatientAlias_distinct_check" CHECK ("aliasPatientId" <> "canonicalPatientId")
);
CREATE UNIQUE INDEX "PatientAlias_aliasPatientId_key" ON "PatientAlias"("aliasPatientId");
CREATE INDEX "PatientAlias_canonicalPatientId_status_idx" ON "PatientAlias"("canonicalPatientId", "status");
CREATE INDEX "PatientAlias_mergeJobId_status_idx" ON "PatientAlias"("mergeJobId", "status");
ALTER TABLE "PatientAlias" ADD CONSTRAINT "PatientAlias_mergeJobId_fkey"
  FOREIGN KEY ("mergeJobId") REFERENCES "PatientMergeJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "PatientMergeMovement" (
  "id" TEXT NOT NULL,
  "mergeJobId" TEXT NOT NULL,
  "tableName" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "fromPatientId" TEXT NOT NULL,
  "toPatientId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'APPLIED',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "rolledBackAt" TIMESTAMP(3),
  CONSTRAINT "PatientMergeMovement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PatientMergeMovement_status_check" CHECK ("status" IN ('APPLIED','ROLLED_BACK')),
  CONSTRAINT "PatientMergeMovement_distinct_check" CHECK ("fromPatientId" <> "toPatientId")
);
CREATE UNIQUE INDEX "PatientMergeMovement_mergeJobId_tableName_entityId_key" ON "PatientMergeMovement"("mergeJobId", "tableName", "entityId");
CREATE INDEX "PatientMergeMovement_mergeJobId_status_tableName_idx" ON "PatientMergeMovement"("mergeJobId", "status", "tableName");
CREATE INDEX "PatientMergeMovement_fromPatientId_status_idx" ON "PatientMergeMovement"("fromPatientId", "status");
CREATE INDEX "PatientMergeMovement_toPatientId_status_idx" ON "PatientMergeMovement"("toPatientId", "status");
ALTER TABLE "PatientMergeMovement" ADD CONSTRAINT "PatientMergeMovement_mergeJobId_fkey"
  FOREIGN KEY ("mergeJobId") REFERENCES "PatientMergeJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION carepoint_reject_patient_merge_evidence_delete()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'patient merge evidence cannot be deleted';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "PatientMergeJob_no_delete" BEFORE DELETE ON "PatientMergeJob"
FOR EACH ROW EXECUTE FUNCTION carepoint_reject_patient_merge_evidence_delete();
CREATE TRIGGER "MergeConflict_no_delete" BEFORE DELETE ON "MergeConflict"
FOR EACH ROW EXECUTE FUNCTION carepoint_reject_patient_merge_evidence_delete();
CREATE TRIGGER "PatientAlias_no_delete" BEFORE DELETE ON "PatientAlias"
FOR EACH ROW EXECUTE FUNCTION carepoint_reject_patient_merge_evidence_delete();
CREATE TRIGGER "PatientMergeMovement_no_delete" BEFORE DELETE ON "PatientMergeMovement"
FOR EACH ROW EXECUTE FUNCTION carepoint_reject_patient_merge_evidence_delete();

CREATE OR REPLACE FUNCTION carepoint_protect_patient_merge_identity()
RETURNS trigger AS $$
BEGIN
  IF NEW."canonicalPatientId" IS DISTINCT FROM OLD."canonicalPatientId"
     OR NEW."duplicatePatientId" IS DISTINCT FROM OLD."duplicatePatientId"
     OR NEW."duplicateUserId" IS DISTINCT FROM OLD."duplicateUserId"
     OR NEW."duplicateAccountStatus" IS DISTINCT FROM OLD."duplicateAccountStatus"
     OR NEW."previewDigest" IS DISTINCT FROM OLD."previewDigest"
     OR NEW."createdByActorId" IS DISTINCT FROM OLD."createdByActorId"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'patient merge job identity/preview is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "PatientMergeJob_identity_immutable" BEFORE UPDATE ON "PatientMergeJob"
FOR EACH ROW EXECUTE FUNCTION carepoint_protect_patient_merge_identity();

REVOKE DELETE ON "PatientMergeJob" FROM PUBLIC;
REVOKE DELETE ON "MergeConflict" FROM PUBLIC;
REVOKE DELETE ON "PatientAlias" FROM PUBLIC;
REVOKE DELETE ON "PatientMergeMovement" FROM PUBLIC;
