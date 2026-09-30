ALTER TABLE "TransportManagementReportRun"
  ADD COLUMN "artifactIntegrityStatus" TEXT NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "artifactIntegrityLastCheckedAt" TIMESTAMP(3),
  ADD COLUMN "artifactIntegrityFailureAt" TIMESTAMP(3),
  ADD COLUMN "artifactIntegrityFailureCode" TEXT;

CREATE INDEX "TransportManagementReportRun_artifactIntegrityStatus_artifactIntegrityLastCheckedAt_idx"
  ON "TransportManagementReportRun"("artifactIntegrityStatus", "artifactIntegrityLastCheckedAt");
