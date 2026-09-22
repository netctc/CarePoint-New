CREATE TABLE "DataQualityRule" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "currentVersion" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DataQualityRule_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DataQualityRule_current_version_check" CHECK ("currentVersion" >= 1),
  CONSTRAINT "DataQualityRule_category_check" CHECK ("category" IN ('INTEGRITY','UNITS','DUPLICATE','PROVENANCE'))
);

CREATE UNIQUE INDEX "DataQualityRule_code_key" ON "DataQualityRule"("code");
CREATE INDEX "DataQualityRule_category_active_idx" ON "DataQualityRule"("category", "active");

CREATE TABLE "DataQualityRuleVersion" (
  "id" TEXT NOT NULL,
  "ruleId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "severity" TEXT NOT NULL,
  "config" JSONB NOT NULL,
  "createdByActorId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DataQualityRuleVersion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DataQualityRuleVersion_version_check" CHECK ("version" >= 1),
  CONSTRAINT "DataQualityRuleVersion_severity_check" CHECK ("severity" IN ('LOW','MEDIUM','HIGH','CRITICAL'))
);

CREATE UNIQUE INDEX "DataQualityRuleVersion_ruleId_version_key" ON "DataQualityRuleVersion"("ruleId", "version");
CREATE INDEX "DataQualityRuleVersion_ruleId_createdAt_idx" ON "DataQualityRuleVersion"("ruleId", "createdAt");
ALTER TABLE "DataQualityRuleVersion"
  ADD CONSTRAINT "DataQualityRuleVersion_ruleId_fkey"
  FOREIGN KEY ("ruleId") REFERENCES "DataQualityRule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "DataQualityRun" (
  "id" TEXT NOT NULL,
  "triggeredByActorId" TEXT,
  "triggerType" TEXT NOT NULL DEFAULT 'MANUAL',
  "status" TEXT NOT NULL DEFAULT 'RUNNING',
  "ruleCount" INTEGER NOT NULL DEFAULT 0,
  "issueCount" INTEGER NOT NULL DEFAULT 0,
  "errorCount" INTEGER NOT NULL DEFAULT 0,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DataQualityRun_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DataQualityRun_trigger_type_check" CHECK ("triggerType" IN ('MANUAL','SCHEDULED')),
  CONSTRAINT "DataQualityRun_status_check" CHECK ("status" IN ('RUNNING','COMPLETED','FAILED')),
  CONSTRAINT "DataQualityRun_counts_check" CHECK ("ruleCount" >= 0 AND "issueCount" >= 0 AND "errorCount" >= 0)
);

CREATE INDEX "DataQualityRun_status_startedAt_idx" ON "DataQualityRun"("status", "startedAt");
CREATE INDEX "DataQualityRun_triggeredByActorId_startedAt_idx" ON "DataQualityRun"("triggeredByActorId", "startedAt");

CREATE TABLE "DataQualityIssue" (
  "id" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "ruleId" TEXT NOT NULL,
  "ruleVersion" INTEGER NOT NULL,
  "runId" TEXT,
  "sourceEntityType" TEXT NOT NULL,
  "sourceEntityId" TEXT NOT NULL,
  "relatedEntityId" TEXT,
  "severity" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "version" INTEGER NOT NULL DEFAULT 1,
  "evidence" JSONB NOT NULL,
  "firstDetectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastDetectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DataQualityIssue_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DataQualityIssue_rule_version_check" CHECK ("ruleVersion" >= 1),
  CONSTRAINT "DataQualityIssue_version_check" CHECK ("version" >= 1),
  CONSTRAINT "DataQualityIssue_status_check" CHECK ("status" IN ('OPEN','ACKNOWLEDGED','RESOLVED','DISMISSED')),
  CONSTRAINT "DataQualityIssue_severity_check" CHECK ("severity" IN ('LOW','MEDIUM','HIGH','CRITICAL'))
);

CREATE UNIQUE INDEX "DataQualityIssue_fingerprint_key" ON "DataQualityIssue"("fingerprint");
CREATE INDEX "DataQualityIssue_status_severity_lastDetectedAt_idx" ON "DataQualityIssue"("status", "severity", "lastDetectedAt");
CREATE INDEX "DataQualityIssue_ruleId_status_lastDetectedAt_idx" ON "DataQualityIssue"("ruleId", "status", "lastDetectedAt");
CREATE INDEX "DataQualityIssue_sourceEntityType_sourceEntityId_idx" ON "DataQualityIssue"("sourceEntityType", "sourceEntityId");
ALTER TABLE "DataQualityIssue"
  ADD CONSTRAINT "DataQualityIssue_ruleId_fkey"
  FOREIGN KEY ("ruleId") REFERENCES "DataQualityRule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DataQualityIssue"
  ADD CONSTRAINT "DataQualityIssue_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "DataQualityRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "DataQualityIssueAction" (
  "id" TEXT NOT NULL,
  "issueId" TEXT NOT NULL,
  "fromStatus" TEXT NOT NULL,
  "toStatus" TEXT NOT NULL,
  "reasonCode" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DataQualityIssueAction_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DataQualityIssueAction_from_status_check" CHECK ("fromStatus" IN ('OPEN','ACKNOWLEDGED','RESOLVED','DISMISSED')),
  CONSTRAINT "DataQualityIssueAction_to_status_check" CHECK ("toStatus" IN ('OPEN','ACKNOWLEDGED','RESOLVED','DISMISSED'))
);

CREATE INDEX "DataQualityIssueAction_issueId_createdAt_idx" ON "DataQualityIssueAction"("issueId", "createdAt");
CREATE INDEX "DataQualityIssueAction_actorId_createdAt_idx" ON "DataQualityIssueAction"("actorId", "createdAt");
ALTER TABLE "DataQualityIssueAction"
  ADD CONSTRAINT "DataQualityIssueAction_issueId_fkey"
  FOREIGN KEY ("issueId") REFERENCES "DataQualityIssue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION carepoint_reject_data_quality_append_only_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'data quality evidence is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "DataQualityRuleVersion_append_only"
BEFORE UPDATE OR DELETE ON "DataQualityRuleVersion"
FOR EACH ROW EXECUTE FUNCTION carepoint_reject_data_quality_append_only_mutation();

CREATE TRIGGER "DataQualityIssueAction_append_only"
BEFORE UPDATE OR DELETE ON "DataQualityIssueAction"
FOR EACH ROW EXECUTE FUNCTION carepoint_reject_data_quality_append_only_mutation();

CREATE OR REPLACE FUNCTION carepoint_protect_data_quality_issue_identity()
RETURNS trigger AS $$
BEGIN
  IF NEW."fingerprint" IS DISTINCT FROM OLD."fingerprint"
     OR NEW."ruleId" IS DISTINCT FROM OLD."ruleId"
     OR NEW."ruleVersion" IS DISTINCT FROM OLD."ruleVersion"
     OR NEW."sourceEntityType" IS DISTINCT FROM OLD."sourceEntityType"
     OR NEW."sourceEntityId" IS DISTINCT FROM OLD."sourceEntityId"
     OR NEW."relatedEntityId" IS DISTINCT FROM OLD."relatedEntityId"
     OR NEW."severity" IS DISTINCT FROM OLD."severity"
     OR NEW."evidence" IS DISTINCT FROM OLD."evidence"
     OR NEW."firstDetectedAt" IS DISTINCT FROM OLD."firstDetectedAt"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'data quality issue identity/evidence is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "DataQualityIssue_identity_immutable"
BEFORE UPDATE ON "DataQualityIssue"
FOR EACH ROW EXECUTE FUNCTION carepoint_protect_data_quality_issue_identity();

CREATE TRIGGER "DataQualityIssue_no_delete"
BEFORE DELETE ON "DataQualityIssue"
FOR EACH ROW EXECUTE FUNCTION carepoint_reject_data_quality_append_only_mutation();

CREATE TRIGGER "DataQualityRun_no_delete"
BEFORE DELETE ON "DataQualityRun"
FOR EACH ROW EXECUTE FUNCTION carepoint_reject_data_quality_append_only_mutation();

REVOKE UPDATE, DELETE ON "DataQualityRuleVersion" FROM PUBLIC;
REVOKE DELETE ON "DataQualityIssueAction" FROM PUBLIC;
REVOKE DELETE ON "DataQualityIssue" FROM PUBLIC;
REVOKE DELETE ON "DataQualityRun" FROM PUBLIC;

INSERT INTO "DataQualityRule" ("id", "code", "category", "active", "currentVersion", "updatedAt") VALUES
  ('dqr-hospitalization-interval', 'HOSPITALIZATION_INVALID_INTERVAL', 'INTEGRITY', true, 1, CURRENT_TIMESTAMP),
  ('dqr-observation-unit-config', 'OBSERVATION_UNIT_CONFIGURATION', 'UNITS', true, 1, CURRENT_TIMESTAMP),
  ('dqr-symptom-duplicate', 'SYMPTOM_REPORT_LOGICAL_DUPLICATE', 'DUPLICATE', true, 1, CURRENT_TIMESTAMP),
  ('dqr-provider-provenance', 'CLINICAL_PROFILE_PROVIDER_PROVENANCE', 'PROVENANCE', true, 1, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "DataQualityRuleVersion" ("id", "ruleId", "version", "severity", "config", "createdByActorId") VALUES
  ('dqrv-hospitalization-interval-v1', 'dqr-hospitalization-interval', 1, 'HIGH', '{"check":"dischargedOn>=admittedOn"}'::jsonb, 'system:v2-migration'),
  ('dqrv-observation-unit-config-v1', 'dqr-observation-unit-config', 1, 'HIGH', '{"check":"active observation type versions reference active unit definitions"}'::jsonb, 'system:v2-migration'),
  ('dqrv-symptom-duplicate-v1', 'dqr-symptom-duplicate', 1, 'MEDIUM', '{"check":"same patient/requestDigest under distinct idempotency keys"}'::jsonb, 'system:v2-migration'),
  ('dqrv-provider-provenance-v1', 'dqr-provider-provenance', 1, 'HIGH', '{"check":"provider-authored/verified entries retain actor provenance"}'::jsonb, 'system:v2-migration')
ON CONFLICT ("ruleId", "version") DO NOTHING;
