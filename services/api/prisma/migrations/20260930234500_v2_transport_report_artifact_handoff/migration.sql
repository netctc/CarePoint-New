ALTER TABLE "TransportManagementReportRun"
  ADD COLUMN "artifactObjectKey" TEXT,
  ADD COLUMN "artifactSha256" TEXT,
  ADD COLUMN "artifactBytes" INTEGER,
  ADD COLUMN "artifactContentType" TEXT,
  ADD COLUMN "artifactStorageProvider" TEXT,
  ADD COLUMN "artifactStoredAt" TIMESTAMP(3),
  ADD COLUMN "deliveryStatus" TEXT NOT NULL DEFAULT 'NOT_READY',
  ADD COLUMN "deliveryHandoffPreparedAt" TIMESTAMP(3),
  ADD COLUMN "deliveryHandoffPreparedByAccountId" TEXT;

CREATE INDEX "TransportManagementReportRun_deliveryStatus_artifactStoredAt_idx"
  ON "TransportManagementReportRun"("deliveryStatus", "artifactStoredAt");
