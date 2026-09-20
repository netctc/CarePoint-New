-- CarePoint V2 / BE-015, BE-016, BE-017:
-- Versioned Care Plans, encrypted goals/tasks and append-only task completion evidence.

CREATE TABLE "CarePlan" (
  "id" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "ownerProviderId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "version" INTEGER NOT NULL DEFAULT 1,
  "effectiveFrom" TIMESTAMP(3) NOT NULL,
  "effectiveUntil" TIMESTAMP(3),
  "reviewAt" TIMESTAMP(3),
  "createdByActorId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CarePlan_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CarePlanRevision" (
  "id" TEXT NOT NULL,
  "carePlanId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "algorithm" TEXT NOT NULL,
  "keyId" TEXT NOT NULL,
  "wrappedKey" TEXT NOT NULL,
  "iv" TEXT NOT NULL,
  "ciphertext" TEXT NOT NULL,
  "authorActorId" TEXT NOT NULL,
  "reasonCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CarePlanRevision_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CarePlanGoal" (
  "id" TEXT NOT NULL,
  "carePlanId" TEXT NOT NULL,
  "ownerProviderId" TEXT NOT NULL,
  "metricCode" TEXT,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "version" INTEGER NOT NULL DEFAULT 1,
  "periodStart" TIMESTAMP(3) NOT NULL,
  "periodEnd" TIMESTAMP(3),
  "algorithm" TEXT NOT NULL,
  "keyId" TEXT NOT NULL,
  "wrappedKey" TEXT NOT NULL,
  "iv" TEXT NOT NULL,
  "ciphertext" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CarePlanGoal_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CarePlanGoalRevision" (
  "id" TEXT NOT NULL,
  "goalId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "algorithm" TEXT NOT NULL,
  "keyId" TEXT NOT NULL,
  "wrappedKey" TEXT NOT NULL,
  "iv" TEXT NOT NULL,
  "ciphertext" TEXT NOT NULL,
  "authorActorId" TEXT NOT NULL,
  "reasonCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CarePlanGoalRevision_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CareTask" (
  "id" TEXT NOT NULL,
  "carePlanId" TEXT NOT NULL,
  "ownerProviderId" TEXT NOT NULL,
  "assigneeType" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "version" INTEGER NOT NULL DEFAULT 1,
  "dueAt" TIMESTAMP(3),
  "recurrence" JSONB,
  "algorithm" TEXT NOT NULL,
  "keyId" TEXT NOT NULL,
  "wrappedKey" TEXT NOT NULL,
  "iv" TEXT NOT NULL,
  "ciphertext" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CareTask_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CareTaskCompletion" (
  "id" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "occurrenceKey" TEXT NOT NULL,
  "outcome" TEXT NOT NULL,
  "reasonCode" TEXT,
  "actorId" TEXT NOT NULL,
  "actorRole" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CareTaskCompletion_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CarePlan_patientId_status_effectiveFrom_idx" ON "CarePlan"("patientId", "status", "effectiveFrom");
CREATE INDEX "CarePlan_ownerProviderId_status_reviewAt_idx" ON "CarePlan"("ownerProviderId", "status", "reviewAt");
CREATE UNIQUE INDEX "CarePlanRevision_carePlanId_version_key" ON "CarePlanRevision"("carePlanId", "version");
CREATE INDEX "CarePlanRevision_carePlanId_createdAt_idx" ON "CarePlanRevision"("carePlanId", "createdAt");
CREATE INDEX "CarePlanGoal_carePlanId_status_idx" ON "CarePlanGoal"("carePlanId", "status");
CREATE INDEX "CarePlanGoal_metricCode_status_idx" ON "CarePlanGoal"("metricCode", "status");
CREATE UNIQUE INDEX "CarePlanGoalRevision_goalId_version_key" ON "CarePlanGoalRevision"("goalId", "version");
CREATE INDEX "CarePlanGoalRevision_goalId_createdAt_idx" ON "CarePlanGoalRevision"("goalId", "createdAt");
CREATE INDEX "CareTask_carePlanId_status_dueAt_idx" ON "CareTask"("carePlanId", "status", "dueAt");
CREATE INDEX "CareTask_assigneeType_status_dueAt_idx" ON "CareTask"("assigneeType", "status", "dueAt");
CREATE UNIQUE INDEX "CareTaskCompletion_taskId_occurrenceKey_key" ON "CareTaskCompletion"("taskId", "occurrenceKey");
CREATE INDEX "CareTaskCompletion_taskId_occurredAt_idx" ON "CareTaskCompletion"("taskId", "occurredAt");

ALTER TABLE "CarePlan" ADD CONSTRAINT "CarePlan_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "PatientProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CarePlan" ADD CONSTRAINT "CarePlan_ownerProviderId_fkey" FOREIGN KEY ("ownerProviderId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CarePlanRevision" ADD CONSTRAINT "CarePlanRevision_carePlanId_fkey" FOREIGN KEY ("carePlanId") REFERENCES "CarePlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CarePlanGoal" ADD CONSTRAINT "CarePlanGoal_carePlanId_fkey" FOREIGN KEY ("carePlanId") REFERENCES "CarePlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CarePlanGoal" ADD CONSTRAINT "CarePlanGoal_ownerProviderId_fkey" FOREIGN KEY ("ownerProviderId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CarePlanGoalRevision" ADD CONSTRAINT "CarePlanGoalRevision_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "CarePlanGoal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CareTask" ADD CONSTRAINT "CareTask_carePlanId_fkey" FOREIGN KEY ("carePlanId") REFERENCES "CarePlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CareTask" ADD CONSTRAINT "CareTask_ownerProviderId_fkey" FOREIGN KEY ("ownerProviderId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CareTaskCompletion" ADD CONSTRAINT "CareTaskCompletion_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "CareTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
