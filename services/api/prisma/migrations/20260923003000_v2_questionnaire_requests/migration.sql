-- CarePoint V2 DOC-084: Doctor-requested questionnaires bound to an exact active version.
-- Request rows contain coordination metadata only. Questionnaire answers remain encrypted in QuestionnaireResponse.

CREATE TABLE "QuestionnaireRequest" (
  "id" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "questionnaireId" TEXT NOT NULL,
  "questionnaireVersionId" TEXT NOT NULL,
  "appointmentId" TEXT NOT NULL,
  "context" TEXT NOT NULL,
  "dueAt" TIMESTAMP(3) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'REQUESTED',
  "completedResponseId" TEXT,
  "requestedByActorId" TEXT NOT NULL,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "QuestionnaireRequest_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "QuestionnaireRequest_context_check"
    CHECK ("context" IN ('PRE_VISIT', 'POST_VISIT', 'FOLLOW_UP')),
  CONSTRAINT "QuestionnaireRequest_status_check"
    CHECK ("status" IN ('REQUESTED', 'COMPLETED'))
);

CREATE UNIQUE INDEX "QuestionnaireRequest_idempotencyKey_key"
ON "QuestionnaireRequest"("idempotencyKey");

CREATE INDEX "QuestionnaireRequest_patientId_status_dueAt_idx"
ON "QuestionnaireRequest"("patientId", "status", "dueAt");

CREATE INDEX "QuestionnaireRequest_providerId_patientId_requestedAt_idx"
ON "QuestionnaireRequest"("providerId", "patientId", "requestedAt");

CREATE INDEX "QuestionnaireRequest_appointmentId_status_idx"
ON "QuestionnaireRequest"("appointmentId", "status");

ALTER TABLE "QuestionnaireRequest"
ADD CONSTRAINT "QuestionnaireRequest_patientId_fkey"
FOREIGN KEY ("patientId") REFERENCES "PatientProfile"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "QuestionnaireRequest"
ADD CONSTRAINT "QuestionnaireRequest_providerId_fkey"
FOREIGN KEY ("providerId") REFERENCES "Provider"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "QuestionnaireRequest"
ADD CONSTRAINT "QuestionnaireRequest_questionnaireId_fkey"
FOREIGN KEY ("questionnaireId") REFERENCES "QuestionnaireDefinition"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "QuestionnaireRequest"
ADD CONSTRAINT "QuestionnaireRequest_questionnaireVersionId_fkey"
FOREIGN KEY ("questionnaireVersionId") REFERENCES "QuestionnaireVersion"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "QuestionnaireRequest"
ADD CONSTRAINT "QuestionnaireRequest_appointmentId_fkey"
FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "QuestionnaireRequest"
ADD CONSTRAINT "QuestionnaireRequest_completedResponseId_fkey"
FOREIGN KEY ("completedResponseId") REFERENCES "QuestionnaireResponse"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
