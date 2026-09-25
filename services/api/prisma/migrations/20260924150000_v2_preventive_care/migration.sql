-- PAT-140 — configurable preventive-care reminders.
-- Rules are structural policy. Patient actions are append-only preference events.

CREATE TABLE "PreventiveCareRule" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PreventiveCareRule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PreventiveCareRuleVersion" (
  "id" TEXT NOT NULL,
  "ruleId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "labels" JSONB NOT NULL,
  "descriptionLabels" JSONB NOT NULL,
  "sourceLabels" JSONB NOT NULL,
  "sourceReference" TEXT NOT NULL,
  "jurisdiction" TEXT NOT NULL DEFAULT 'GLOBAL',
  "triggerType" TEXT NOT NULL,
  "minAgeYears" INTEGER,
  "maxAgeYears" INTEGER,
  "vaccineCodeSystem" TEXT,
  "vaccineCode" TEXT,
  "intervalDays" INTEGER,
  "allowDismiss" BOOLEAN NOT NULL DEFAULT true,
  "allowPostpone" BOOLEAN NOT NULL DEFAULT true,
  "maxPostponeDays" INTEGER NOT NULL DEFAULT 365,
  "createdByActorId" TEXT,
  "publishedAt" TIMESTAMP(3),
  "retiredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PreventiveCareRuleVersion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PreventiveCareRuleVersion_status_check" CHECK ("status" IN ('DRAFT','PUBLISHED','RETIRED')),
  CONSTRAINT "PreventiveCareRuleVersion_trigger_check" CHECK ("triggerType" IN ('AGE_WINDOW','IMMUNIZATION_INTERVAL')),
  CONSTRAINT "PreventiveCareRuleVersion_age_check" CHECK (
    ("minAgeYears" IS NULL OR ("minAgeYears" >= 0 AND "minAgeYears" <= 130))
    AND ("maxAgeYears" IS NULL OR ("maxAgeYears" >= 0 AND "maxAgeYears" <= 130))
    AND ("minAgeYears" IS NULL OR "maxAgeYears" IS NULL OR "minAgeYears" <= "maxAgeYears")
  ),
  CONSTRAINT "PreventiveCareRuleVersion_interval_check" CHECK ("intervalDays" IS NULL OR ("intervalDays" >= 1 AND "intervalDays" <= 36500)),
  CONSTRAINT "PreventiveCareRuleVersion_postpone_check" CHECK ("maxPostponeDays" >= 1 AND "maxPostponeDays" <= 3650)
);

CREATE TABLE "PreventiveCareAction" (
  "id" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "actorAccountId" TEXT NOT NULL,
  "ruleVersionId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "postponedUntil" TIMESTAMP(3),
  "idempotencyKey" TEXT NOT NULL,
  "requestDigest" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PreventiveCareAction_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PreventiveCareAction_action_check" CHECK ("action" IN ('DISMISSED','POSTPONED'))
);

CREATE UNIQUE INDEX "PreventiveCareRule_code_key" ON "PreventiveCareRule"("code");
CREATE INDEX "PreventiveCareRule_active_code_idx" ON "PreventiveCareRule"("active","code");
CREATE UNIQUE INDEX "PreventiveCareRuleVersion_ruleId_version_key" ON "PreventiveCareRuleVersion"("ruleId","version");
CREATE INDEX "PreventiveCareRuleVersion_status_jurisdiction_publishedAt_idx" ON "PreventiveCareRuleVersion"("status","jurisdiction","publishedAt");
CREATE UNIQUE INDEX "PreventiveCareAction_patientId_idempotencyKey_key" ON "PreventiveCareAction"("patientId","idempotencyKey");
CREATE INDEX "PreventiveCareAction_patientId_ruleVersionId_createdAt_idx" ON "PreventiveCareAction"("patientId","ruleVersionId","createdAt");

ALTER TABLE "PreventiveCareRuleVersion"
ADD CONSTRAINT "PreventiveCareRuleVersion_ruleId_fkey"
FOREIGN KEY ("ruleId") REFERENCES "PreventiveCareRule"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
