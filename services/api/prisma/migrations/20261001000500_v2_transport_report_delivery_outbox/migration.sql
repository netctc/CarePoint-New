CREATE TABLE "TransportManagementReportDestination" (
  "id" TEXT NOT NULL,
  "scheduleId" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "recipientAccountId" TEXT NOT NULL,
  "channel" TEXT NOT NULL DEFAULT 'EMAIL',
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdByAccountId" TEXT NOT NULL,
  "updatedByAccountId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TransportManagementReportDestination_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TransportManagementReportDelivery" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "destinationId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseOwner" TEXT,
  "leaseUntil" TIMESTAMP(3),
  "attemptedAt" TIMESTAMP(3),
  "sentAt" TIMESTAMP(3),
  "failedAt" TIMESTAMP(3),
  "providerRef" TEXT,
  "lastErrorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TransportManagementReportDelivery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TransportManagementReportDestination_scheduleId_recipientAccountId_channel_key"
  ON "TransportManagementReportDestination"("scheduleId", "recipientAccountId", "channel");
CREATE INDEX "TransportManagementReportDestination_scheduleId_active_idx"
  ON "TransportManagementReportDestination"("scheduleId", "active");
CREATE INDEX "TransportManagementReportDestination_recipientAccountId_active_idx"
  ON "TransportManagementReportDestination"("recipientAccountId", "active");

CREATE UNIQUE INDEX "TransportManagementReportDelivery_runId_destinationId_key"
  ON "TransportManagementReportDelivery"("runId", "destinationId");
CREATE INDEX "TransportManagementReportDelivery_status_availableAt_leaseUntil_idx"
  ON "TransportManagementReportDelivery"("status", "availableAt", "leaseUntil");
CREATE INDEX "TransportManagementReportDelivery_runId_createdAt_idx"
  ON "TransportManagementReportDelivery"("runId", "createdAt");
CREATE INDEX "TransportManagementReportDelivery_destinationId_createdAt_idx"
  ON "TransportManagementReportDelivery"("destinationId", "createdAt");

ALTER TABLE "TransportManagementReportDestination"
  ADD CONSTRAINT "TransportManagementReportDestination_scheduleId_fkey"
  FOREIGN KEY ("scheduleId")
  REFERENCES "TransportManagementReportSchedule"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

ALTER TABLE "TransportManagementReportDelivery"
  ADD CONSTRAINT "TransportManagementReportDelivery_runId_fkey"
  FOREIGN KEY ("runId")
  REFERENCES "TransportManagementReportRun"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

ALTER TABLE "TransportManagementReportDelivery"
  ADD CONSTRAINT "TransportManagementReportDelivery_destinationId_fkey"
  FOREIGN KEY ("destinationId")
  REFERENCES "TransportManagementReportDestination"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;
