ALTER TABLE "TransportManagementReportRun"
  ADD COLUMN "artifactLegalHold" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "artifactLegalHoldReason" TEXT,
  ADD COLUMN "artifactLegalHoldSetAt" TIMESTAMP(3),
  ADD COLUMN "artifactLegalHoldSetByAccountId" TEXT,
  ADD COLUMN "artifactPurgeClaimedAt" TIMESTAMP(3);

CREATE INDEX "TransportManagementReportRun_artifactLegalHold_artifactDeletedAt_artifactStoredAt_idx"
  ON "TransportManagementReportRun"("artifactLegalHold", "artifactDeletedAt", "artifactStoredAt");
