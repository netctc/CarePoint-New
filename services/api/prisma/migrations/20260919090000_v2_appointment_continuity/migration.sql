-- CarePoint V2 / PAT-138, PAT-139, DOC-083, DOC-084, BE-038:
-- appointment preparation, questionnaire requests and versioned post-encounter follow-up.

CREATE TABLE "AppointmentPrepTask" (
  "id" TEXT NOT NULL,
  "appointmentId" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "taskType" TEXT NOT NULL,
  "required" BOOLEAN NOT NULL DEFAULT false,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "sourceRef" TEXT,
  "dueAt" TIMESTAMP(3),
  "createdByActorId" TEXT,
  "completedByActorId" TEXT,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AppointmentPrepTask_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "QuestionnaireRequest" (
  "id" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "appointmentId" TEXT,
  "questionnaireVersionId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'REQUESTED',
  "dueAt" TIMESTAMP(3),
  "responseId" TEXT,
  "createdByActorId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "QuestionnaireRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EncounterFollowUp" (
  "id" TEXT NOT NULL,
  "appointmentId" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "algorithm" TEXT NOT NULL,
  "keyId" TEXT NOT NULL,
  "wrappedKey" TEXT NOT NULL,
  "iv" TEXT NOT NULL,
  "ciphertext" TEXT NOT NULL,
  "releasedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EncounterFollowUp_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EncounterFollowUpRevision" (
  "id" TEXT NOT NULL,
  "followUpId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "algorithm" TEXT NOT NULL,
  "keyId" TEXT NOT NULL,
  "wrappedKey" TEXT NOT NULL,
  "iv" TEXT NOT NULL,
  "ciphertext" TEXT NOT NULL,
  "authorActorId" TEXT NOT NULL,
  "reasonCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EncounterFollowUpRevision_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AppointmentPrepTask_appointmentId_code_key" ON "AppointmentPrepTask"("appointmentId", "code");
CREATE INDEX "AppointmentPrepTask_patientId_status_dueAt_idx" ON "AppointmentPrepTask"("patientId", "status", "dueAt");
CREATE INDEX "AppointmentPrepTask_providerId_appointmentId_status_idx" ON "AppointmentPrepTask"("providerId", "appointmentId", "status");
CREATE INDEX "QuestionnaireRequest_patientId_status_dueAt_idx" ON "QuestionnaireRequest"("patientId", "status", "dueAt");
CREATE INDEX "QuestionnaireRequest_providerId_status_createdAt_idx" ON "QuestionnaireRequest"("providerId", "status", "createdAt");
CREATE INDEX "QuestionnaireRequest_appointmentId_status_idx" ON "QuestionnaireRequest"("appointmentId", "status");
CREATE INDEX "QuestionnaireRequest_questionnaireVersionId_idx" ON "QuestionnaireRequest"("questionnaireVersionId");
CREATE UNIQUE INDEX "EncounterFollowUp_appointmentId_key" ON "EncounterFollowUp"("appointmentId");
CREATE INDEX "EncounterFollowUp_patientId_status_releasedAt_idx" ON "EncounterFollowUp"("patientId", "status", "releasedAt");
CREATE INDEX "EncounterFollowUp_providerId_status_updatedAt_idx" ON "EncounterFollowUp"("providerId", "status", "updatedAt");
CREATE UNIQUE INDEX "EncounterFollowUpRevision_followUpId_version_key" ON "EncounterFollowUpRevision"("followUpId", "version");
CREATE INDEX "EncounterFollowUpRevision_followUpId_createdAt_idx" ON "EncounterFollowUpRevision"("followUpId", "createdAt");

ALTER TABLE "AppointmentPrepTask" ADD CONSTRAINT "AppointmentPrepTask_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AppointmentPrepTask" ADD CONSTRAINT "AppointmentPrepTask_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "PatientProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AppointmentPrepTask" ADD CONSTRAINT "AppointmentPrepTask_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "QuestionnaireRequest" ADD CONSTRAINT "QuestionnaireRequest_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "PatientProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "QuestionnaireRequest" ADD CONSTRAINT "QuestionnaireRequest_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "QuestionnaireRequest" ADD CONSTRAINT "QuestionnaireRequest_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "QuestionnaireRequest" ADD CONSTRAINT "QuestionnaireRequest_questionnaireVersionId_fkey" FOREIGN KEY ("questionnaireVersionId") REFERENCES "QuestionnaireVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "QuestionnaireRequest" ADD CONSTRAINT "QuestionnaireRequest_responseId_fkey" FOREIGN KEY ("responseId") REFERENCES "QuestionnaireResponse"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EncounterFollowUp" ADD CONSTRAINT "EncounterFollowUp_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EncounterFollowUp" ADD CONSTRAINT "EncounterFollowUp_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "PatientProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EncounterFollowUp" ADD CONSTRAINT "EncounterFollowUp_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EncounterFollowUpRevision" ADD CONSTRAINT "EncounterFollowUpRevision_followUpId_fkey" FOREIGN KEY ("followUpId") REFERENCES "EncounterFollowUp"("id") ON DELETE CASCADE ON UPDATE CASCADE;
