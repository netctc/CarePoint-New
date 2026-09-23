CREATE TABLE "QuestionnaireResponseReview" (
    "id" TEXT NOT NULL,
    "responseId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "responseSequence" INTEGER NOT NULL,
    "providerId" TEXT NOT NULL,
    "reviewerActorId" TEXT NOT NULL,
    "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuestionnaireResponseReview_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "QuestionnaireResponseReview_responseSequence_check" CHECK ("responseSequence" > 0)
);

CREATE UNIQUE INDEX "QuestionnaireResponseReview_responseId_providerId_key"
ON "QuestionnaireResponseReview"("responseId", "providerId");
CREATE INDEX "QuestionnaireResponseReview_patientId_reviewedAt_idx"
ON "QuestionnaireResponseReview"("patientId", "reviewedAt");
CREATE INDEX "QuestionnaireResponseReview_providerId_reviewedAt_idx"
ON "QuestionnaireResponseReview"("providerId", "reviewedAt");

ALTER TABLE "QuestionnaireResponseReview" ADD CONSTRAINT "QuestionnaireResponseReview_responseId_fkey"
FOREIGN KEY ("responseId") REFERENCES "QuestionnaireResponse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "QuestionnaireResponseReview" ADD CONSTRAINT "QuestionnaireResponseReview_patientId_fkey"
FOREIGN KEY ("patientId") REFERENCES "PatientProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "QuestionnaireResponseReview" ADD CONSTRAINT "QuestionnaireResponseReview_providerId_fkey"
FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
