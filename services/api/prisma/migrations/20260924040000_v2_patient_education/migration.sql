-- CarePoint V2 DOC-085 — governed patient education.
-- Catalog content is non-patient-specific. Assignment rows carry structural coordination metadata only.

CREATE TABLE "EducationContent" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EducationContent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EducationContentVersion" (
  "id" TEXT NOT NULL,
  "contentId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "labels" JSONB NOT NULL,
  "bodyLabels" JSONB NOT NULL,
  "sourceName" TEXT NOT NULL,
  "sourceUrl" TEXT,
  "createdByActorId" TEXT,
  "publishedAt" TIMESTAMP(3),
  "retiredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EducationContentVersion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "EducationContentVersion_version_check" CHECK ("version" > 0),
  CONSTRAINT "EducationContentVersion_status_check" CHECK ("status" IN ('DRAFT','PUBLISHED','RETIRED')),
  CONSTRAINT "EducationContentVersion_source_url_check" CHECK ("sourceUrl" IS NULL OR "sourceUrl" ~ '^https://')
);

CREATE TABLE "PatientEducationAssignment" (
  "id" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "appointmentId" TEXT NOT NULL,
  "contentVersionId" TEXT NOT NULL,
  "contextKind" TEXT,
  "contextId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'ASSIGNED',
  "assignedByActorId" TEXT NOT NULL,
  "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMP(3),
  "revokedByActorId" TEXT,
  CONSTRAINT "PatientEducationAssignment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PatientEducationAssignment_status_check" CHECK ("status" IN ('ASSIGNED','REVOKED')),
  CONSTRAINT "PatientEducationAssignment_context_check" CHECK (
    ("contextKind" IS NULL AND "contextId" IS NULL)
    OR ("contextKind" IN ('CARE_PLAN','CONDITION') AND "contextId" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "EducationContent_code_key" ON "EducationContent"("code");
CREATE INDEX "EducationContent_active_code_idx" ON "EducationContent"("active","code");
CREATE UNIQUE INDEX "EducationContentVersion_contentId_version_key" ON "EducationContentVersion"("contentId","version");
CREATE INDEX "EducationContentVersion_status_publishedAt_idx" ON "EducationContentVersion"("status","publishedAt");
CREATE UNIQUE INDEX "PatientEducationAssignment_idempotencyKey_key" ON "PatientEducationAssignment"("idempotencyKey");
CREATE INDEX "PatientEducationAssignment_patientId_status_assignedAt_idx" ON "PatientEducationAssignment"("patientId","status","assignedAt");
CREATE INDEX "PatientEducationAssignment_providerId_patientId_status_idx" ON "PatientEducationAssignment"("providerId","patientId","status");
CREATE INDEX "PatientEducationAssignment_appointmentId_assignedAt_idx" ON "PatientEducationAssignment"("appointmentId","assignedAt");

ALTER TABLE "EducationContentVersion"
ADD CONSTRAINT "EducationContentVersion_contentId_fkey"
FOREIGN KEY ("contentId") REFERENCES "EducationContent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PatientEducationAssignment"
ADD CONSTRAINT "PatientEducationAssignment_patientId_fkey"
FOREIGN KEY ("patientId") REFERENCES "PatientProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PatientEducationAssignment"
ADD CONSTRAINT "PatientEducationAssignment_providerId_fkey"
FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PatientEducationAssignment"
ADD CONSTRAINT "PatientEducationAssignment_appointmentId_fkey"
FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PatientEducationAssignment"
ADD CONSTRAINT "PatientEducationAssignment_contentVersionId_fkey"
FOREIGN KEY ("contentVersionId") REFERENCES "EducationContentVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
