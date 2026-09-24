-- CarePoint V2 ADM-076 — deterministic questionnaire trigger orchestration.
-- Trigger rows contain orchestration metadata only; questionnaire answers remain in encrypted QuestionnaireResponse.
CREATE TABLE "QuestionnaireTriggerRule" (
  "id" TEXT NOT NULL, "code" TEXT NOT NULL, "labels" JSONB NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "QuestionnaireTriggerRule_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "QuestionnaireTriggerRuleVersion" (
  "id" TEXT NOT NULL, "ruleId" TEXT NOT NULL, "version" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT', "questionnaireVersionId" TEXT NOT NULL,
  "triggerType" TEXT NOT NULL, "config" JSONB NOT NULL, "createdByActorId" TEXT,
  "lastSimulatedAt" TIMESTAMP(3), "simulationDigest" TEXT, "activatedAt" TIMESTAMP(3),
  "retiredAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "QuestionnaireTriggerRuleVersion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "QuestionnaireTriggerRuleVersion_version_check" CHECK ("version" > 0),
  CONSTRAINT "QuestionnaireTriggerRuleVersion_status_check" CHECK ("status" IN ('DRAFT','ACTIVE','RETIRED')),
  CONSTRAINT "QuestionnaireTriggerRuleVersion_type_check" CHECK ("triggerType" IN ('ONBOARDING','PERIODIC','POST_INTERVENTION','PRE_VISIT','MANUAL'))
);
CREATE TABLE "QuestionnaireTriggerDispatch" (
  "id" TEXT NOT NULL, "ruleVersionId" TEXT NOT NULL, "patientId" TEXT NOT NULL,
  "eventId" TEXT NOT NULL, "eventType" TEXT NOT NULL, "questionnaireVersionId" TEXT NOT NULL,
  "appointmentId" TEXT, "sourceRef" TEXT, "status" TEXT NOT NULL DEFAULT 'PENDING',
  "reason" TEXT NOT NULL, "dueAt" TIMESTAMP(3) NOT NULL, "completedResponseId" TEXT,
  "completedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "QuestionnaireTriggerDispatch_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "QuestionnaireTriggerDispatch_status_check" CHECK ("status" IN ('PENDING','COMPLETED'))
);
CREATE UNIQUE INDEX "QuestionnaireTriggerRule_code_key" ON "QuestionnaireTriggerRule"("code");
CREATE INDEX "QuestionnaireTriggerRule_active_code_idx" ON "QuestionnaireTriggerRule"("active","code");
CREATE UNIQUE INDEX "QuestionnaireTriggerRuleVersion_ruleId_version_key" ON "QuestionnaireTriggerRuleVersion"("ruleId","version");
CREATE INDEX "QuestionnaireTriggerRuleVersion_status_triggerType_activatedAt_idx" ON "QuestionnaireTriggerRuleVersion"("status","triggerType","activatedAt");
CREATE INDEX "QuestionnaireTriggerRuleVersion_questionnaireVersionId_status_idx" ON "QuestionnaireTriggerRuleVersion"("questionnaireVersionId","status");
CREATE UNIQUE INDEX "QuestionnaireTriggerDispatch_ruleVersionId_patientId_eventId_key" ON "QuestionnaireTriggerDispatch"("ruleVersionId","patientId","eventId");
CREATE INDEX "QuestionnaireTriggerDispatch_patientId_status_dueAt_idx" ON "QuestionnaireTriggerDispatch"("patientId","status","dueAt");
CREATE INDEX "QuestionnaireTriggerDispatch_questionnaireVersionId_patientId_status_idx" ON "QuestionnaireTriggerDispatch"("questionnaireVersionId","patientId","status");
CREATE INDEX "QuestionnaireTriggerDispatch_appointmentId_status_idx" ON "QuestionnaireTriggerDispatch"("appointmentId","status");
ALTER TABLE "QuestionnaireTriggerRuleVersion" ADD CONSTRAINT "QuestionnaireTriggerRuleVersion_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "QuestionnaireTriggerRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "QuestionnaireTriggerRuleVersion" ADD CONSTRAINT "QuestionnaireTriggerRuleVersion_questionnaireVersionId_fkey" FOREIGN KEY ("questionnaireVersionId") REFERENCES "QuestionnaireVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "QuestionnaireTriggerDispatch" ADD CONSTRAINT "QuestionnaireTriggerDispatch_ruleVersionId_fkey" FOREIGN KEY ("ruleVersionId") REFERENCES "QuestionnaireTriggerRuleVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "QuestionnaireTriggerDispatch" ADD CONSTRAINT "QuestionnaireTriggerDispatch_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "PatientProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "QuestionnaireTriggerDispatch" ADD CONSTRAINT "QuestionnaireTriggerDispatch_questionnaireVersionId_fkey" FOREIGN KEY ("questionnaireVersionId") REFERENCES "QuestionnaireVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "QuestionnaireTriggerDispatch" ADD CONSTRAINT "QuestionnaireTriggerDispatch_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "QuestionnaireTriggerDispatch" ADD CONSTRAINT "QuestionnaireTriggerDispatch_completedResponseId_fkey" FOREIGN KEY ("completedResponseId") REFERENCES "QuestionnaireResponse"("id") ON DELETE SET NULL ON UPDATE CASCADE;
