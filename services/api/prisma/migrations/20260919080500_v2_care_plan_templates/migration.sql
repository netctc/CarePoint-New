-- CarePoint V2 / ADM-083:
-- Versioned reusable Care Plan templates. Templates contain no patient-specific data.

CREATE TABLE "CarePlanTemplate" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "labels" JSONB NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CarePlanTemplate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CarePlanTemplateVersion" (
  "id" TEXT NOT NULL,
  "templateId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "schema" JSONB NOT NULL,
  "createdByActorId" TEXT,
  "activatedAt" TIMESTAMP(3),
  "retiredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CarePlanTemplateVersion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CarePlanTemplate_code_key" ON "CarePlanTemplate"("code");
CREATE INDEX "CarePlanTemplate_active_code_idx" ON "CarePlanTemplate"("active", "code");
CREATE UNIQUE INDEX "CarePlanTemplateVersion_templateId_version_key" ON "CarePlanTemplateVersion"("templateId", "version");
CREATE INDEX "CarePlanTemplateVersion_status_activatedAt_idx" ON "CarePlanTemplateVersion"("status", "activatedAt");

ALTER TABLE "CarePlanTemplateVersion"
ADD CONSTRAINT "CarePlanTemplateVersion_templateId_fkey"
FOREIGN KEY ("templateId") REFERENCES "CarePlanTemplate"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
