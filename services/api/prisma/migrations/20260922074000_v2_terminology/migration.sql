CREATE TABLE "CodingSystem" (
  "id" TEXT NOT NULL,
  "uri" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CodingSystem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TerminologyConcept" (
  "id" TEXT NOT NULL,
  "codingSystemId" TEXT NOT NULL,
  "system" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "currentVersion" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TerminologyConcept_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TerminologyConcept_status_check" CHECK ("status" IN ('ACTIVE', 'INACTIVE')),
  CONSTRAINT "TerminologyConcept_version_check" CHECK ("currentVersion" >= 1)
);

CREATE TABLE "TerminologyConceptVersion" (
  "id" TEXT NOT NULL,
  "conceptId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "system" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "display" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "effectiveFrom" TIMESTAMP(3) NOT NULL,
  "retiredAt" TIMESTAMP(3),
  "createdByActorId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TerminologyConceptVersion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TerminologyConceptVersion_status_check" CHECK ("status" IN ('ACTIVE', 'INACTIVE')),
  CONSTRAINT "TerminologyConceptVersion_version_check" CHECK ("version" >= 1),
  CONSTRAINT "TerminologyConceptVersion_interval_check" CHECK ("retiredAt" IS NULL OR "retiredAt" >= "effectiveFrom")
);

CREATE TABLE "ExternalCatalogMapping" (
  "id" TEXT NOT NULL,
  "sourceSystem" TEXT NOT NULL,
  "sourceCode" TEXT NOT NULL,
  "targetConceptId" TEXT NOT NULL,
  "targetSystem" TEXT NOT NULL,
  "targetCode" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "effectiveFrom" TIMESTAMP(3) NOT NULL,
  "retiredAt" TIMESTAMP(3),
  "createdByActorId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ExternalCatalogMapping_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ExternalCatalogMapping_status_check" CHECK ("status" IN ('ACTIVE', 'INACTIVE')),
  CONSTRAINT "ExternalCatalogMapping_version_check" CHECK ("version" >= 1),
  CONSTRAINT "ExternalCatalogMapping_interval_check" CHECK ("retiredAt" IS NULL OR "retiredAt" >= "effectiveFrom")
);

CREATE UNIQUE INDEX "CodingSystem_uri_key" ON "CodingSystem"("uri");
CREATE INDEX "CodingSystem_active_name_idx" ON "CodingSystem"("active", "name");
CREATE UNIQUE INDEX "TerminologyConcept_system_code_key" ON "TerminologyConcept"("system", "code");
CREATE INDEX "TerminologyConcept_codingSystemId_status_code_idx" ON "TerminologyConcept"("codingSystemId", "status", "code");
CREATE INDEX "TerminologyConcept_system_status_code_idx" ON "TerminologyConcept"("system", "status", "code");
CREATE UNIQUE INDEX "TerminologyConceptVersion_conceptId_version_key" ON "TerminologyConceptVersion"("conceptId", "version");
CREATE INDEX "TerminologyConceptVersion_system_code_version_idx" ON "TerminologyConceptVersion"("system", "code", "version");
CREATE INDEX "TerminologyConceptVersion_conceptId_createdAt_idx" ON "TerminologyConceptVersion"("conceptId", "createdAt");
CREATE UNIQUE INDEX "ExternalCatalogMapping_sourceSystem_sourceCode_version_key" ON "ExternalCatalogMapping"("sourceSystem", "sourceCode", "version");
CREATE INDEX "ExternalCatalogMapping_sourceSystem_sourceCode_status_version_idx" ON "ExternalCatalogMapping"("sourceSystem", "sourceCode", "status", "version");
CREATE INDEX "ExternalCatalogMapping_targetConceptId_status_idx" ON "ExternalCatalogMapping"("targetConceptId", "status");

ALTER TABLE "TerminologyConcept" ADD CONSTRAINT "TerminologyConcept_codingSystemId_fkey"
  FOREIGN KEY ("codingSystemId") REFERENCES "CodingSystem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TerminologyConceptVersion" ADD CONSTRAINT "TerminologyConceptVersion_conceptId_fkey"
  FOREIGN KEY ("conceptId") REFERENCES "TerminologyConcept"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TerminologyConceptVersion" ADD CONSTRAINT "TerminologyConceptVersion_createdByActorId_fkey"
  FOREIGN KEY ("createdByActorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ExternalCatalogMapping" ADD CONSTRAINT "ExternalCatalogMapping_targetConceptId_fkey"
  FOREIGN KEY ("targetConceptId") REFERENCES "TerminologyConcept"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ExternalCatalogMapping" ADD CONSTRAINT "ExternalCatalogMapping_createdByActorId_fkey"
  FOREIGN KEY ("createdByActorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION carepoint_reject_terminology_version_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'terminology versions are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "TerminologyConceptVersion_append_only"
BEFORE UPDATE OR DELETE ON "TerminologyConceptVersion"
FOR EACH ROW EXECUTE FUNCTION carepoint_reject_terminology_version_mutation();

CREATE TRIGGER "ExternalCatalogMapping_append_only"
BEFORE UPDATE OR DELETE ON "ExternalCatalogMapping"
FOR EACH ROW EXECUTE FUNCTION carepoint_reject_terminology_version_mutation();

REVOKE UPDATE, DELETE ON "TerminologyConceptVersion" FROM PUBLIC;
REVOKE UPDATE, DELETE ON "ExternalCatalogMapping" FROM PUBLIC;
