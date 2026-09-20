-- CarePoint V2 / BE-030:
-- versioned Other Provider category forms with encrypted responses.

CREATE TABLE "ProviderCategoryForm" (
  "id" TEXT NOT NULL,
  "categoryId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "purpose" TEXT NOT NULL DEFAULT 'GENERAL',
  "labels" JSONB NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProviderCategoryForm_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProviderCategoryFormVersion" (
  "id" TEXT NOT NULL,
  "formId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "schema" JSONB NOT NULL,
  "createdByActorId" TEXT,
  "activatedAt" TIMESTAMP(3),
  "retiredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProviderCategoryFormVersion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProviderCategoryFormResponse" (
  "id" TEXT NOT NULL,
  "formId" TEXT NOT NULL,
  "formVersionId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "contextType" TEXT NOT NULL,
  "contextId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "algorithm" TEXT NOT NULL,
  "keyId" TEXT NOT NULL,
  "wrappedKey" TEXT NOT NULL,
  "iv" TEXT NOT NULL,
  "ciphertext" TEXT NOT NULL,
  "sourceActorId" TEXT,
  "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProviderCategoryFormResponse_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProviderCategoryForm_categoryId_code_key"
ON "ProviderCategoryForm"("categoryId", "code");

CREATE INDEX "ProviderCategoryForm_categoryId_active_purpose_idx"
ON "ProviderCategoryForm"("categoryId", "active", "purpose");

CREATE UNIQUE INDEX "ProviderCategoryFormVersion_formId_version_key"
ON "ProviderCategoryFormVersion"("formId", "version");

CREATE INDEX "ProviderCategoryFormVersion_status_activatedAt_idx"
ON "ProviderCategoryFormVersion"("status", "activatedAt");

CREATE UNIQUE INDEX "ProviderCategoryFormResponse_formId_providerId_contextType_contextId_sequence_key"
ON "ProviderCategoryFormResponse"("formId", "providerId", "contextType", "contextId", "sequence");

CREATE INDEX "ProviderCategoryFormResponse_providerId_contextType_contextId_submittedAt_idx"
ON "ProviderCategoryFormResponse"("providerId", "contextType", "contextId", "submittedAt");

CREATE INDEX "ProviderCategoryFormResponse_patientId_formId_submittedAt_idx"
ON "ProviderCategoryFormResponse"("patientId", "formId", "submittedAt");

ALTER TABLE "ProviderCategoryForm"
ADD CONSTRAINT "ProviderCategoryForm_categoryId_fkey"
FOREIGN KEY ("categoryId") REFERENCES "ProviderCategory"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProviderCategoryFormVersion"
ADD CONSTRAINT "ProviderCategoryFormVersion_formId_fkey"
FOREIGN KEY ("formId") REFERENCES "ProviderCategoryForm"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProviderCategoryFormResponse"
ADD CONSTRAINT "ProviderCategoryFormResponse_formId_fkey"
FOREIGN KEY ("formId") REFERENCES "ProviderCategoryForm"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProviderCategoryFormResponse"
ADD CONSTRAINT "ProviderCategoryFormResponse_formVersionId_fkey"
FOREIGN KEY ("formVersionId") REFERENCES "ProviderCategoryFormVersion"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProviderCategoryFormResponse"
ADD CONSTRAINT "ProviderCategoryFormResponse_providerId_fkey"
FOREIGN KEY ("providerId") REFERENCES "Provider"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProviderCategoryFormResponse"
ADD CONSTRAINT "ProviderCategoryFormResponse_patientId_fkey"
FOREIGN KEY ("patientId") REFERENCES "PatientProfile"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
