-- CarePoint V2 / ADM-073:
-- versioned, governed clinical profile schemas. Published versions are immutable.

CREATE TYPE "ClinicalProfileSchemaStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'RETIRED');

CREATE TABLE "ClinicalProfileSchema" (
  "id" TEXT NOT NULL,
  "jurisdiction" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "status" "ClinicalProfileSchemaStatus" NOT NULL DEFAULT 'DRAFT',
  "definition" JSONB NOT NULL,
  "createdByActorId" TEXT NOT NULL,
  "publishedByActorId" TEXT,
  "retiredByActorId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "publishedAt" TIMESTAMP(3),
  "retiredAt" TIMESTAMP(3),
  CONSTRAINT "ClinicalProfileSchema_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ClinicalProfileSchema_jurisdiction_version_key"
  ON "ClinicalProfileSchema"("jurisdiction", "version");
CREATE INDEX "ClinicalProfileSchema_jurisdiction_status_version_idx"
  ON "ClinicalProfileSchema"("jurisdiction", "status", "version");
CREATE INDEX "ClinicalProfileSchema_status_updatedAt_idx"
  ON "ClinicalProfileSchema"("status", "updatedAt");

ALTER TABLE "ClinicalProfileSchema"
  ADD CONSTRAINT "ClinicalProfileSchema_jurisdiction_check"
  CHECK ("jurisdiction" ~ '^[A-Z][A-Z0-9_-]{1,31}$'),
  ADD CONSTRAINT "ClinicalProfileSchema_version_check"
  CHECK ("version" >= 1),
  ADD CONSTRAINT "ClinicalProfileSchema_definition_object_check"
  CHECK (jsonb_typeof("definition") = 'object'),
  ADD CONSTRAINT "ClinicalProfileSchema_state_timestamp_check"
  CHECK (
    ("status" = 'DRAFT' AND "publishedAt" IS NULL AND "retiredAt" IS NULL)
    OR ("status" = 'PUBLISHED' AND "publishedAt" IS NOT NULL AND "retiredAt" IS NULL)
    OR ("status" = 'RETIRED' AND "publishedAt" IS NOT NULL AND "retiredAt" IS NOT NULL)
  );

CREATE UNIQUE INDEX "ClinicalProfileSchema_one_published_per_jurisdiction"
  ON "ClinicalProfileSchema"("jurisdiction")
  WHERE "status" = 'PUBLISHED';

CREATE OR REPLACE FUNCTION carepoint_protect_published_clinical_profile_schema()
RETURNS trigger AS $$
BEGIN
  IF OLD."status" = 'PUBLISHED' THEN
    IF NEW."definition" IS DISTINCT FROM OLD."definition"
       OR NEW."version" IS DISTINCT FROM OLD."version"
       OR NEW."jurisdiction" IS DISTINCT FROM OLD."jurisdiction"
       OR NEW."createdByActorId" IS DISTINCT FROM OLD."createdByActorId"
       OR NEW."publishedAt" IS DISTINCT FROM OLD."publishedAt"
       OR NEW."publishedByActorId" IS DISTINCT FROM OLD."publishedByActorId"
    THEN
      RAISE EXCEPTION 'Published ClinicalProfileSchema content is immutable';
    END IF;
    IF NEW."status" NOT IN ('PUBLISHED', 'RETIRED') THEN
      RAISE EXCEPTION 'Published ClinicalProfileSchema may only transition to RETIRED';
    END IF;
  END IF;
  IF OLD."status" = 'RETIRED' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'Retired ClinicalProfileSchema is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ClinicalProfileSchema_publish_immutability_trigger"
BEFORE UPDATE ON "ClinicalProfileSchema"
FOR EACH ROW EXECUTE FUNCTION carepoint_protect_published_clinical_profile_schema();

CREATE OR REPLACE FUNCTION carepoint_reject_clinical_profile_schema_delete()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ClinicalProfileSchema history cannot be deleted';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ClinicalProfileSchema_no_delete_trigger"
BEFORE DELETE ON "ClinicalProfileSchema"
FOR EACH ROW EXECUTE FUNCTION carepoint_reject_clinical_profile_schema_delete();
