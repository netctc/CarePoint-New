-- CarePoint V2 DOC-080 — versioned encounter templates.
-- Templates contain structure/guidance only. No clinical note values are stored here.

CREATE TABLE "EncounterTemplate" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EncounterTemplate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EncounterTemplateVersion" (
  "id" TEXT NOT NULL,
  "templateId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "labels" JSONB NOT NULL,
  "serviceIds" JSONB NOT NULL,
  "specialtyCodes" JSONB NOT NULL,
  "layout" JSONB NOT NULL,
  "createdByActorId" TEXT,
  "publishedAt" TIMESTAMP(3),
  "retiredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EncounterTemplateVersion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "EncounterTemplateVersion_version_check" CHECK ("version" > 0),
  CONSTRAINT "EncounterTemplateVersion_status_check"
    CHECK ("status" IN ('DRAFT', 'PUBLISHED', 'RETIRED'))
);

CREATE UNIQUE INDEX "EncounterTemplate_code_key"
ON "EncounterTemplate"("code");

CREATE INDEX "EncounterTemplate_active_code_idx"
ON "EncounterTemplate"("active", "code");

CREATE UNIQUE INDEX "EncounterTemplateVersion_templateId_version_key"
ON "EncounterTemplateVersion"("templateId", "version");

CREATE INDEX "EncounterTemplateVersion_status_publishedAt_idx"
ON "EncounterTemplateVersion"("status", "publishedAt");

ALTER TABLE "EncounterTemplateVersion"
ADD CONSTRAINT "EncounterTemplateVersion_templateId_fkey"
FOREIGN KEY ("templateId") REFERENCES "EncounterTemplate"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
