-- CarePoint V2 A3 / BE-011..BE-014: versioned clinical questionnaire engine.

CREATE TABLE "QuestionnaireDefinition" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "labels" JSONB NOT NULL,
  "descriptionLabels" JSONB,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "QuestionnaireDefinition_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "QuestionnaireVersion" (
  "id" TEXT NOT NULL,
  "questionnaireId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "schema" JSONB NOT NULL,
  "activationRules" JSONB,
  "createdByActorId" TEXT,
  "activatedAt" TIMESTAMP(3),
  "retiredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "QuestionnaireVersion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "QuestionnaireResponse" (
  "id" TEXT NOT NULL,
  "questionnaireId" TEXT NOT NULL,
  "questionnaireVersionId" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "previousResponseId" TEXT,
  "healthChanged" BOOLEAN,
  "changedQuestionIds" JSONB NOT NULL,
  "algorithm" TEXT NOT NULL,
  "keyId" TEXT NOT NULL,
  "wrappedKey" TEXT NOT NULL,
  "iv" TEXT NOT NULL,
  "ciphertext" TEXT NOT NULL,
  "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sourceType" TEXT NOT NULL DEFAULT 'PATIENT',
  "sourceActorId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "QuestionnaireResponse_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "QuestionnaireDefinition_code_key"
ON "QuestionnaireDefinition"("code");

CREATE INDEX "QuestionnaireDefinition_active_code_idx"
ON "QuestionnaireDefinition"("active", "code");

CREATE UNIQUE INDEX "QuestionnaireVersion_questionnaireId_version_key"
ON "QuestionnaireVersion"("questionnaireId", "version");

CREATE INDEX "QuestionnaireVersion_status_activatedAt_idx"
ON "QuestionnaireVersion"("status", "activatedAt");

CREATE UNIQUE INDEX "QuestionnaireResponse_patientId_questionnaireId_sequence_key"
ON "QuestionnaireResponse"("patientId", "questionnaireId", "sequence");

CREATE INDEX "QuestionnaireResponse_patientId_questionnaireId_completedAt_idx"
ON "QuestionnaireResponse"("patientId", "questionnaireId", "completedAt");

CREATE INDEX "QuestionnaireResponse_questionnaireVersionId_completedAt_idx"
ON "QuestionnaireResponse"("questionnaireVersionId", "completedAt");

ALTER TABLE "QuestionnaireVersion"
ADD CONSTRAINT "QuestionnaireVersion_questionnaireId_fkey"
FOREIGN KEY ("questionnaireId") REFERENCES "QuestionnaireDefinition"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "QuestionnaireResponse"
ADD CONSTRAINT "QuestionnaireResponse_questionnaireId_fkey"
FOREIGN KEY ("questionnaireId") REFERENCES "QuestionnaireDefinition"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "QuestionnaireResponse"
ADD CONSTRAINT "QuestionnaireResponse_questionnaireVersionId_fkey"
FOREIGN KEY ("questionnaireVersionId") REFERENCES "QuestionnaireVersion"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "QuestionnaireResponse"
ADD CONSTRAINT "QuestionnaireResponse_patientId_fkey"
FOREIGN KEY ("patientId") REFERENCES "PatientProfile"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
