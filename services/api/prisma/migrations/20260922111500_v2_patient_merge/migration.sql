CREATE TABLE "PatientMergeJob" (
  "id" TEXT NOT NULL,
  "sourcePatientId" TEXT NOT NULL,
  "targetPatientId" TEXT NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'PREVIEWED',
  "planVersion" TEXT NOT NULL DEFAULT 'patient-merge-v1',
  "planDigest" TEXT NOT NULL,
  "domainCount" INTEGER NOT NULL,
  "recordCount" INTEGER NOT NULL,
  "blockingConflictCount" INTEGER NOT NULL,
  "createdByActorId" TEXT NOT NULL,
  "executedByActorId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "executedAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PatientMergeJob_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PatientMergeJob_state_check" CHECK ("state" IN ('PREVIEWED','EXECUTED','SUPERSEDED','FAILED')),
  CONSTRAINT "PatientMergeJob_distinct_patients_check" CHECK ("sourcePatientId" <> "targetPatientId"),
  CONSTRAINT "PatientMergeJob_plan_digest_check" CHECK ("planDigest" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "PatientMergeJob_counts_check" CHECK ("domainCount" >= 0 AND "recordCount" >= 0 AND "blockingConflictCount" >= 0)
);

CREATE TABLE "PatientMergeConflict" (
  "id" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "domain" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "blocking" BOOLEAN NOT NULL DEFAULT true,
  "sourceCount" INTEGER NOT NULL,
  "targetCount" INTEGER NOT NULL,
  "structuralEvidence" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PatientMergeConflict_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PatientMergeConflict_counts_check" CHECK ("sourceCount" >= 0 AND "targetCount" >= 0)
);

CREATE TABLE "PatientAlias" (
  "id" TEXT NOT NULL,
  "aliasPatientId" TEXT NOT NULL,
  "canonicalPatientId" TEXT NOT NULL,
  "mergeJobId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PatientAlias_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PatientAlias_distinct_check" CHECK ("aliasPatientId" <> "canonicalPatientId")
);

CREATE UNIQUE INDEX "PatientAlias_aliasPatientId_key" ON "PatientAlias"("aliasPatientId");
CREATE INDEX "PatientAlias_canonicalPatientId_createdAt_idx" ON "PatientAlias"("canonicalPatientId", "createdAt");
CREATE INDEX "PatientMergeJob_sourcePatientId_createdAt_idx" ON "PatientMergeJob"("sourcePatientId", "createdAt");
CREATE INDEX "PatientMergeJob_targetPatientId_createdAt_idx" ON "PatientMergeJob"("targetPatientId", "createdAt");
CREATE INDEX "PatientMergeJob_state_createdAt_idx" ON "PatientMergeJob"("state", "createdAt");
CREATE INDEX "PatientMergeConflict_jobId_blocking_domain_idx" ON "PatientMergeConflict"("jobId", "blocking", "domain");

ALTER TABLE "PatientMergeJob"
  ADD CONSTRAINT "PatientMergeJob_sourcePatientId_fkey" FOREIGN KEY ("sourcePatientId") REFERENCES "PatientProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PatientMergeJob"
  ADD CONSTRAINT "PatientMergeJob_targetPatientId_fkey" FOREIGN KEY ("targetPatientId") REFERENCES "PatientProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PatientMergeConflict"
  ADD CONSTRAINT "PatientMergeConflict_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "PatientMergeJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PatientAlias"
  ADD CONSTRAINT "PatientAlias_mergeJobId_fkey" FOREIGN KEY ("mergeJobId") REFERENCES "PatientMergeJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION carepoint_guard_patient_merge_job_update()
RETURNS trigger AS $$
BEGIN
  IF NEW."sourcePatientId" IS DISTINCT FROM OLD."sourcePatientId"
     OR NEW."targetPatientId" IS DISTINCT FROM OLD."targetPatientId"
     OR NEW."planVersion" IS DISTINCT FROM OLD."planVersion"
     OR NEW."planDigest" IS DISTINCT FROM OLD."planDigest"
     OR NEW."domainCount" IS DISTINCT FROM OLD."domainCount"
     OR NEW."recordCount" IS DISTINCT FROM OLD."recordCount"
     OR NEW."blockingConflictCount" IS DISTINCT FROM OLD."blockingConflictCount"
     OR NEW."createdByActorId" IS DISTINCT FROM OLD."createdByActorId"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'patient merge preview evidence is immutable';
  END IF;
  IF OLD."state" = 'EXECUTED' AND NEW."state" IS DISTINCT FROM OLD."state" THEN
    RAISE EXCEPTION 'executed patient merge is terminal';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "PatientMergeJob_guard_preview_evidence"
BEFORE UPDATE ON "PatientMergeJob"
FOR EACH ROW EXECUTE FUNCTION carepoint_guard_patient_merge_job_update();

CREATE OR REPLACE FUNCTION carepoint_reject_patient_merge_evidence_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'patient merge evidence is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "PatientMergeConflict_append_only"
BEFORE UPDATE OR DELETE ON "PatientMergeConflict"
FOR EACH ROW EXECUTE FUNCTION carepoint_reject_patient_merge_evidence_mutation();
CREATE TRIGGER "PatientAlias_append_only"
BEFORE UPDATE OR DELETE ON "PatientAlias"
FOR EACH ROW EXECUTE FUNCTION carepoint_reject_patient_merge_evidence_mutation();

REVOKE DELETE ON "PatientMergeJob", "PatientMergeConflict", "PatientAlias" FROM PUBLIC;
REVOKE UPDATE ON "PatientMergeConflict", "PatientAlias" FROM PUBLIC;
