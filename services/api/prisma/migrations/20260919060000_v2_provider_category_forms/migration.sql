-- CarePoint V2 / BE-030, ADM-106, PRV-091.
-- Versioned Other Provider category forms with encrypted response payloads.

CREATE TABLE "ProviderCategoryFormDefinition" (
  "id" TEXT NOT NULL,
  "categoryId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "labels" JSONB NOT NULL,
  "purpose" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProviderCategoryFormDefinition_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProviderCategoryFormVersion" (
  "id" TEXT NOT NULL,
  "formDefinitionId" TEXT NOT NULL,
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
  "formDefinitionId" TEXT NOT NULL,
  "formVersionId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "patientId" TEXT,
  "contextType" TEXT NOT NULL,
  "contextId" TEXT,
  "algorithm" TEXT NOT NULL,
  "keyId" TEXT NOT NULL,
  "wrappedKey" TEXT NOT NULL,
  "iv" TEXT NOT NULL,
  "ciphertext" TEXT NOT NULL,
  "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProviderCategoryFormResponse_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProviderCategoryFormDefinition_categoryId_code_key" ON "ProviderCategoryFormDefinition"("categoryId", "code");
CREATE INDEX "ProviderCategoryFormDefinition_categoryId_active_idx" ON "ProviderCategoryFormDefinition"("categoryId", "active");
CREATE UNIQUE INDEX "ProviderCategoryFormVersion_formDefinitionId_version_key" ON "ProviderCategoryFormVersion"("formDefinitionId", "version");
CREATE INDEX "ProviderCategoryFormVersion_status_activatedAt_idx" ON "ProviderCategoryFormVersion"("status", "activatedAt");
CREATE INDEX "ProviderCategoryFormResponse_providerId_submittedAt_idx" ON "ProviderCategoryFormResponse"("providerId", "submittedAt");
CREATE INDEX "ProviderCategoryFormResponse_patientId_submittedAt_idx" ON "ProviderCategoryFormResponse"("patientId", "submittedAt");
CREATE INDEX "ProviderCategoryFormResponse_contextType_contextId_idx" ON "ProviderCategoryFormResponse"("contextType", "contextId");

ALTER TABLE "ProviderCategoryFormDefinition"
ADD CONSTRAINT "ProviderCategoryFormDefinition_categoryId_fkey"
FOREIGN KEY ("categoryId") REFERENCES "ProviderCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProviderCategoryFormVersion"
ADD CONSTRAINT "ProviderCategoryFormVersion_formDefinitionId_fkey"
FOREIGN KEY ("formDefinitionId") REFERENCES "ProviderCategoryFormDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProviderCategoryFormResponse"
ADD CONSTRAINT "ProviderCategoryFormResponse_formDefinitionId_fkey"
FOREIGN KEY ("formDefinitionId") REFERENCES "ProviderCategoryFormDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProviderCategoryFormResponse"
ADD CONSTRAINT "ProviderCategoryFormResponse_formVersionId_fkey"
FOREIGN KEY ("formVersionId") REFERENCES "ProviderCategoryFormVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProviderCategoryFormResponse"
ADD CONSTRAINT "ProviderCategoryFormResponse_providerId_fkey"
FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProviderCategoryFormResponse"
ADD CONSTRAINT "ProviderCategoryFormResponse_patientId_fkey"
FOREIGN KEY ("patientId") REFERENCES "PatientProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
