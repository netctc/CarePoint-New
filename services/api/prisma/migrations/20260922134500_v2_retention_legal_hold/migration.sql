CREATE TABLE "RetentionPolicy" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "domain" TEXT NOT NULL,
  "jurisdiction" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "currentVersion" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RetentionPolicy_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RetentionPolicy_version_check" CHECK ("currentVersion" >= 1),
  CONSTRAINT "RetentionPolicy_domain_check" CHECK ("domain" IN ('CLINICAL_DOCUMENT','CLINICAL_MEDIA','CLINICAL_DOCUMENT_ACCESS_GRANT','CLINICAL_MEDIA_ACCESS_GRANT','AUDIT_EVENT'))
);
CREATE UNIQUE INDEX "RetentionPolicy_code_key" ON "RetentionPolicy"("code");
CREATE INDEX "RetentionPolicy_domain_jurisdiction_active_idx" ON "RetentionPolicy"("domain", "jurisdiction", "active");

CREATE TABLE "RetentionPolicyVersion" (
  "id" TEXT NOT NULL,
  "policyId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "retentionDays" INTEGER NOT NULL,
  "action" TEXT NOT NULL,
  "createdByActorId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RetentionPolicyVersion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RetentionPolicyVersion_version_check" CHECK ("version" >= 1),
  CONSTRAINT "RetentionPolicyVersion_days_check" CHECK ("retentionDays" BETWEEN 1 AND 36500),
  CONSTRAINT "RetentionPolicyVersion_action_check" CHECK ("action" IN ('SOFT_REMOVE','PURGE_EXPIRED_GRANTS','PROTECT_ONLY'))
);
CREATE UNIQUE INDEX "RetentionPolicyVersion_policyId_version_key" ON "RetentionPolicyVersion"("policyId", "version");
CREATE INDEX "RetentionPolicyVersion_policyId_createdAt_idx" ON "RetentionPolicyVersion"("policyId", "createdAt");
ALTER TABLE "RetentionPolicyVersion" ADD CONSTRAINT "RetentionPolicyVersion_policyId_fkey"
  FOREIGN KEY ("policyId") REFERENCES "RetentionPolicy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "LegalHold" (
  "id" TEXT NOT NULL,
  "domain" TEXT NOT NULL,
  "jurisdiction" TEXT NOT NULL,
  "subjectType" TEXT NOT NULL,
  "subjectId" TEXT,
  "reasonCode" TEXT NOT NULL,
  "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3),
  "releasedAt" TIMESTAMP(3),
  "createdByActorId" TEXT NOT NULL,
  "releasedByActorId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LegalHold_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LegalHold_domain_check" CHECK ("domain" IN ('CLINICAL_DOCUMENT','CLINICAL_MEDIA','AUDIT_EVENT')),
  CONSTRAINT "LegalHold_subject_type_check" CHECK ("subjectType" IN ('GLOBAL','PATIENT','ENTITY')),
  CONSTRAINT "LegalHold_subject_shape_check" CHECK (("subjectType" = 'GLOBAL' AND "subjectId" IS NULL) OR ("subjectType" <> 'GLOBAL' AND "subjectId" IS NOT NULL)),
  CONSTRAINT "LegalHold_interval_check" CHECK ("expiresAt" IS NULL OR "expiresAt" > "startsAt")
);
CREATE INDEX "LegalHold_domain_jurisdiction_releasedAt_expiresAt_idx" ON "LegalHold"("domain", "jurisdiction", "releasedAt", "expiresAt");
CREATE INDEX "LegalHold_subjectType_subjectId_releasedAt_idx" ON "LegalHold"("subjectType", "subjectId", "releasedAt");

CREATE TABLE "DeletionJob" (
  "id" TEXT NOT NULL,
  "policyId" TEXT NOT NULL,
  "policyVersion" INTEGER NOT NULL,
  "jurisdiction" TEXT NOT NULL,
  "domain" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "cutoffAt" TIMESTAMP(3) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PREVIEWED',
  "planDigest" TEXT NOT NULL,
  "candidateCount" INTEGER NOT NULL DEFAULT 0,
  "blockedCount" INTEGER NOT NULL DEFAULT 0,
  "appliedCount" INTEGER NOT NULL DEFAULT 0,
  "createdByActorId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "executedAt" TIMESTAMP(3),
  CONSTRAINT "DeletionJob_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DeletionJob_status_check" CHECK ("status" IN ('PREVIEWED','EXECUTING','COMPLETED','BLOCKED','FAILED')),
  CONSTRAINT "DeletionJob_counts_check" CHECK ("candidateCount" >= 0 AND "blockedCount" >= 0 AND "appliedCount" >= 0)
);
CREATE INDEX "DeletionJob_status_createdAt_idx" ON "DeletionJob"("status", "createdAt");
CREATE INDEX "DeletionJob_policyId_policyVersion_createdAt_idx" ON "DeletionJob"("policyId", "policyVersion", "createdAt");
ALTER TABLE "DeletionJob" ADD CONSTRAINT "DeletionJob_policyId_fkey"
  FOREIGN KEY ("policyId") REFERENCES "RetentionPolicy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "DeletionJobItem" (
  "id" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "patientId" TEXT,
  "action" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PLANNED',
  "blockReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "appliedAt" TIMESTAMP(3),
  CONSTRAINT "DeletionJobItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DeletionJobItem_status_check" CHECK ("status" IN ('PLANNED','BLOCKED','APPLIED','FAILED'))
);
CREATE UNIQUE INDEX "DeletionJobItem_jobId_entityType_entityId_key" ON "DeletionJobItem"("jobId", "entityType", "entityId");
CREATE INDEX "DeletionJobItem_jobId_status_idx" ON "DeletionJobItem"("jobId", "status");
CREATE INDEX "DeletionJobItem_patientId_status_idx" ON "DeletionJobItem"("patientId", "status");
ALTER TABLE "DeletionJobItem" ADD CONSTRAINT "DeletionJobItem_jobId_fkey"
  FOREIGN KEY ("jobId") REFERENCES "DeletionJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION carepoint_reject_retention_evidence_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'retention evidence is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "RetentionPolicyVersion_append_only"
BEFORE UPDATE OR DELETE ON "RetentionPolicyVersion"
FOR EACH ROW EXECUTE FUNCTION carepoint_reject_retention_evidence_mutation();

CREATE TRIGGER "DeletionJobItem_no_delete"
BEFORE DELETE ON "DeletionJobItem"
FOR EACH ROW EXECUTE FUNCTION carepoint_reject_retention_evidence_mutation();

CREATE OR REPLACE FUNCTION carepoint_protect_legal_hold_identity()
RETURNS trigger AS $$
BEGIN
  IF NEW."domain" IS DISTINCT FROM OLD."domain"
     OR NEW."jurisdiction" IS DISTINCT FROM OLD."jurisdiction"
     OR NEW."subjectType" IS DISTINCT FROM OLD."subjectType"
     OR NEW."subjectId" IS DISTINCT FROM OLD."subjectId"
     OR NEW."reasonCode" IS DISTINCT FROM OLD."reasonCode"
     OR NEW."startsAt" IS DISTINCT FROM OLD."startsAt"
     OR NEW."expiresAt" IS DISTINCT FROM OLD."expiresAt"
     OR NEW."createdByActorId" IS DISTINCT FROM OLD."createdByActorId"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'legal hold identity/evidence is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "LegalHold_identity_immutable"
BEFORE UPDATE ON "LegalHold"
FOR EACH ROW EXECUTE FUNCTION carepoint_protect_legal_hold_identity();
CREATE TRIGGER "LegalHold_no_delete"
BEFORE DELETE ON "LegalHold"
FOR EACH ROW EXECUTE FUNCTION carepoint_reject_retention_evidence_mutation();

REVOKE UPDATE, DELETE ON "RetentionPolicyVersion" FROM PUBLIC;
REVOKE DELETE ON "LegalHold" FROM PUBLIC;
REVOKE DELETE ON "DeletionJob" FROM PUBLIC;
REVOKE DELETE ON "DeletionJobItem" FROM PUBLIC;
