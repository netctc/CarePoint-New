-- CarePoint V2 / ADM-073:
-- immutable, jurisdiction-aware clinical profile schema versions managed by Admin.

CREATE TYPE "ClinicalProfileSchemaStatus" AS ENUM ('DRAFT', 'ACTIVE', 'RETIRED');

CREATE TABLE "ClinicalProfileSchema" (
  "id" TEXT NOT NULL,
  "jurisdiction" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "status" "ClinicalProfileSchemaStatus" NOT NULL DEFAULT 'DRAFT',
  "definition" JSONB NOT NULL,
  "definitionHash" TEXT NOT NULL,
  "validationErrors" JSONB,
  "validatedAt" TIMESTAMP(3),
  "publishedAt" TIMESTAMP(3),
  "retiredAt" TIMESTAMP(3),
  "supersedesSchemaId" TEXT,
  "createdByAccountId" TEXT NOT NULL,
  "updatedByAccountId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ClinicalProfileSchema_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ClinicalProfileSchema_jurisdiction_version_key"
ON "ClinicalProfileSchema"("jurisdiction", "version");

CREATE INDEX "ClinicalProfileSchema_jurisdiction_status_idx"
ON "ClinicalProfileSchema"("jurisdiction", "status");

CREATE INDEX "ClinicalProfileSchema_status_updatedAt_idx"
ON "ClinicalProfileSchema"("status", "updatedAt");

-- PostgreSQL enforces at most one active schema per jurisdiction, including under concurrent publishes.
CREATE UNIQUE INDEX "ClinicalProfileSchema_one_active_per_jurisdiction"
ON "ClinicalProfileSchema"("jurisdiction")
WHERE "status" = 'ACTIVE';
