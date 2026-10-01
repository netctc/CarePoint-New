CREATE TABLE "TransportManagementReportRun" (
  "id" TEXT NOT NULL,
  "scheduleId" TEXT NOT NULL,
  "scheduledFor" TIMESTAMP(3) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'QUEUED',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "claimedAt" TIMESTAMP(3),
  "leaseExpiresAt" TIMESTAMP(3),
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "failedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "reportGeneratedAt" TIMESTAMP(3),
  "reportFilename" TEXT,
  "reportFormat" TEXT,
  "rowCount" INTEGER,
  "truncatedSource" BOOLEAN NOT NULL DEFAULT false,
  "snapshotHash" TEXT,
  "snapshotJson" TEXT,
  "createdByAccountId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TransportManagementReportRun_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TransportManagementReportRun_scheduleId_scheduledFor_key"
  ON "TransportManagementReportRun"("scheduleId", "scheduledFor");
CREATE INDEX "TransportManagementReportRun_status_leaseExpiresAt_idx"
  ON "TransportManagementReportRun"("status", "leaseExpiresAt");
CREATE INDEX "TransportManagementReportRun_scheduleId_createdAt_idx"
  ON "TransportManagementReportRun"("scheduleId", "createdAt");

ALTER TABLE "TransportManagementReportRun"
  ADD CONSTRAINT "TransportManagementReportRun_scheduleId_fkey"
  FOREIGN KEY ("scheduleId")
  REFERENCES "TransportManagementReportSchedule"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;
