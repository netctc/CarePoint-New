ALTER TABLE "TransportManagementReportDelivery"
  ADD COLUMN "downloadedAt" TIMESTAMP(3),
  ADD COLUMN "downloadedByAccountId" TEXT;

CREATE INDEX "TransportManagementReportDelivery_status_downloadedAt_idx"
  ON "TransportManagementReportDelivery"("status", "downloadedAt");
