-- CarePoint V2 / BE-018, PAT-124, DOC-073/074/075, ADM-080/081/082:
-- deterministic RPM alert policies, patient-specific rules and append-only alert actions.

CREATE TABLE "AlertPolicy" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "labels" JSONB NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AlertPolicy_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "AlertPolicyVersion" (
  "id" TEXT NOT NULL,
  "policyId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "config" JSONB NOT NULL,
  "createdByActorId" TEXT,
  "activatedAt" TIMESTAMP(3),
  "retiredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AlertPolicyVersion_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "CarePlanAlertRule" (
  "id" TEXT NOT NULL,
  "carePlanId" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "ownerProviderId" TEXT NOT NULL,
  "policyVersionId" TEXT NOT NULL,
  "metricCode" TEXT NOT NULL,
  "severity" TEXT NOT NULL,
  "patientActionKey" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "version" INTEGER NOT NULL DEFAULT 1,
  "effectiveFrom" TIMESTAMP(3) NOT NULL,
  "effectiveUntil" TIMESTAMP(3),
  "algorithm" TEXT NOT NULL,
  "keyId" TEXT NOT NULL,
  "wrappedKey" TEXT NOT NULL,
  "iv" TEXT NOT NULL,
  "ciphertext" TEXT NOT NULL,
  "createdByActorId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CarePlanAlertRule_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "CarePlanAlertRuleRevision" (
  "id" TEXT NOT NULL,
  "ruleId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "policyVersionId" TEXT NOT NULL,
  "severity" TEXT NOT NULL,
  "patientActionKey" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "effectiveFrom" TIMESTAMP(3) NOT NULL,
  "effectiveUntil" TIMESTAMP(3),
  "algorithm" TEXT NOT NULL,
  "keyId" TEXT NOT NULL,
  "wrappedKey" TEXT NOT NULL,
  "iv" TEXT NOT NULL,
  "ciphertext" TEXT NOT NULL,
  "authorActorId" TEXT NOT NULL,
  "reasonCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CarePlanAlertRuleRevision_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ClinicalAlert" (
  "id" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "carePlanId" TEXT NOT NULL,
  "ownerProviderId" TEXT NOT NULL,
  "assigneeProviderId" TEXT,
  "ruleId" TEXT NOT NULL,
  "ruleVersion" INTEGER NOT NULL,
  "sourceObservationId" TEXT NOT NULL,
  "metricCode" TEXT NOT NULL,
  "severity" TEXT NOT NULL,
  "patientActionKey" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "acknowledgedAt" TIMESTAMP(3),
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ClinicalAlert_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ClinicalAlertAction" (
  "id" TEXT NOT NULL,
  "alertId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "actorRole" TEXT NOT NULL,
  "reasonCode" TEXT,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ClinicalAlertAction_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AlertPolicy_code_key" ON "AlertPolicy"("code");
CREATE INDEX "AlertPolicy_active_code_idx" ON "AlertPolicy"("active", "code");
CREATE UNIQUE INDEX "AlertPolicyVersion_policyId_version_key" ON "AlertPolicyVersion"("policyId", "version");
CREATE INDEX "AlertPolicyVersion_status_activatedAt_idx" ON "AlertPolicyVersion"("status", "activatedAt");
CREATE INDEX "CarePlanAlertRule_patientId_metricCode_status_effectiveFrom_idx" ON "CarePlanAlertRule"("patientId", "metricCode", "status", "effectiveFrom");
CREATE INDEX "CarePlanAlertRule_carePlanId_status_idx" ON "CarePlanAlertRule"("carePlanId", "status");
CREATE INDEX "CarePlanAlertRule_ownerProviderId_status_idx" ON "CarePlanAlertRule"("ownerProviderId", "status");
CREATE UNIQUE INDEX "CarePlanAlertRuleRevision_ruleId_version_key" ON "CarePlanAlertRuleRevision"("ruleId", "version");
CREATE INDEX "CarePlanAlertRuleRevision_ruleId_createdAt_idx" ON "CarePlanAlertRuleRevision"("ruleId", "createdAt");
CREATE UNIQUE INDEX "ClinicalAlert_ruleId_ruleVersion_sourceObservationId_key" ON "ClinicalAlert"("ruleId", "ruleVersion", "sourceObservationId");
CREATE INDEX "ClinicalAlert_ownerProviderId_status_severity_createdAt_idx" ON "ClinicalAlert"("ownerProviderId", "status", "severity", "createdAt");
CREATE INDEX "ClinicalAlert_patientId_status_createdAt_idx" ON "ClinicalAlert"("patientId", "status", "createdAt");
CREATE INDEX "ClinicalAlert_sourceObservationId_idx" ON "ClinicalAlert"("sourceObservationId");
CREATE INDEX "ClinicalAlertAction_alertId_occurredAt_idx" ON "ClinicalAlertAction"("alertId", "occurredAt");
CREATE INDEX "ClinicalAlertAction_actorId_occurredAt_idx" ON "ClinicalAlertAction"("actorId", "occurredAt");

ALTER TABLE "AlertPolicyVersion" ADD CONSTRAINT "AlertPolicyVersion_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "AlertPolicy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CarePlanAlertRule" ADD CONSTRAINT "CarePlanAlertRule_carePlanId_fkey" FOREIGN KEY ("carePlanId") REFERENCES "CarePlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CarePlanAlertRule" ADD CONSTRAINT "CarePlanAlertRule_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "PatientProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CarePlanAlertRule" ADD CONSTRAINT "CarePlanAlertRule_ownerProviderId_fkey" FOREIGN KEY ("ownerProviderId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CarePlanAlertRule" ADD CONSTRAINT "CarePlanAlertRule_policyVersionId_fkey" FOREIGN KEY ("policyVersionId") REFERENCES "AlertPolicyVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CarePlanAlertRuleRevision" ADD CONSTRAINT "CarePlanAlertRuleRevision_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "CarePlanAlertRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CarePlanAlertRuleRevision" ADD CONSTRAINT "CarePlanAlertRuleRevision_policyVersionId_fkey" FOREIGN KEY ("policyVersionId") REFERENCES "AlertPolicyVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClinicalAlert" ADD CONSTRAINT "ClinicalAlert_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "PatientProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClinicalAlert" ADD CONSTRAINT "ClinicalAlert_carePlanId_fkey" FOREIGN KEY ("carePlanId") REFERENCES "CarePlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClinicalAlert" ADD CONSTRAINT "ClinicalAlert_ownerProviderId_fkey" FOREIGN KEY ("ownerProviderId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClinicalAlert" ADD CONSTRAINT "ClinicalAlert_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "CarePlanAlertRule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClinicalAlert" ADD CONSTRAINT "ClinicalAlert_sourceObservationId_fkey" FOREIGN KEY ("sourceObservationId") REFERENCES "Observation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClinicalAlertAction" ADD CONSTRAINT "ClinicalAlertAction_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "ClinicalAlert"("id") ON DELETE CASCADE ON UPDATE CASCADE;
