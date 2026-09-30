CREATE TABLE "TransportManagementReportDownloadGrant" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "issuedToAccountId" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TransportManagementReportDownloadGrant_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TransportManagementReportDownloadGrant_tokenHash_key"
  ON "TransportManagementReportDownloadGrant"("tokenHash");
CREATE INDEX "TransportManagementReportDownloadGrant_runId_expiresAt_consumedAt_idx"
  ON "TransportManagementReportDownloadGrant"("runId", "expiresAt", "consumedAt");
CREATE INDEX "TransportManagementReportDownloadGrant_issuedToAccountId_expiresAt_idx"
  ON "TransportManagementReportDownloadGrant"("issuedToAccountId", "expiresAt");

ALTER TABLE "TransportManagementReportDownloadGrant"
  ADD CONSTRAINT "TransportManagementReportDownloadGrant_runId_fkey"
  FOREIGN KEY ("runId")
  REFERENCES "TransportManagementReportRun"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;
