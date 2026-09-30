ALTER TABLE "TransportManagementReportSchedule"
  ADD COLUMN "artifactRetentionDays" INTEGER NOT NULL DEFAULT 90;

ALTER TABLE "TransportManagementReportRun"
  ADD COLUMN "artifactDeletedAt" TIMESTAMP(3);
