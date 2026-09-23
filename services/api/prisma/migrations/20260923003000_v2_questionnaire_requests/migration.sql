-- CarePoint V2 DOC-084: extend the existing appointment-continuity QuestionnaireRequest.
-- The row stores coordination metadata only; answers remain encrypted in QuestionnaireResponse.

ALTER TABLE "QuestionnaireRequest"
  ADD COLUMN "idempotencyKey" TEXT,
  ADD COLUMN "context" TEXT,
  ADD COLUMN "completedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "QuestionnaireRequest_idempotencyKey_key"
ON "QuestionnaireRequest"("idempotencyKey");

CREATE INDEX "QuestionnaireRequest_providerId_patientId_createdAt_idx"
ON "QuestionnaireRequest"("providerId", "patientId", "createdAt");

ALTER TABLE "QuestionnaireRequest"
ADD CONSTRAINT "QuestionnaireRequest_context_check"
CHECK ("context" IS NULL OR "context" IN ('PRE_VISIT', 'POST_VISIT', 'FOLLOW_UP'));

ALTER TABLE "QuestionnaireRequest"
ADD CONSTRAINT "QuestionnaireRequest_status_check"
CHECK ("status" IN ('REQUESTED', 'COMPLETED'));
