CREATE TABLE "TransportManagementReportSchedule" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "cadence" TEXT NOT NULL,
  "weekday" INTEGER,
  "dayOfMonth" INTEGER,
  "hourUtc" INTEGER NOT NULL,
  "minuteUtc" INTEGER NOT NULL DEFAULT 0,
  "windowDays" INTEGER NOT NULL DEFAULT 30,
  "mode" TEXT NOT NULL DEFAULT 'ALL',
  "sla" TEXT NOT NULL DEFAULT 'ALL',
  "providerId" TEXT,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "nextRunAt" TIMESTAMP(3) NOT NULL,
  "lastRunAt" TIMESTAMP(3),
  "deliveryMode" TEXT NOT NULL DEFAULT 'EXTERNAL_SCHEDULER',
  "createdByAccountId" TEXT NOT NULL,
  "updatedByAccountId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TransportManagementReportSchedule_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TransportManagementReportSchedule_enabled_nextRunAt_idx"
  ON "TransportManagementReportSchedule"("enabled", "nextRunAt");
CREATE INDEX "TransportManagementReportSchedule_cadence_enabled_idx"
  ON "TransportManagementReportSchedule"("cadence", "enabled");
CREATE INDEX "TransportManagementReportSchedule_providerId_idx"
  ON "TransportManagementReportSchedule"("providerId");
