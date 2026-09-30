CREATE TABLE "TransportOperationalEscalation" (
  "id" TEXT NOT NULL,
  "transportRequestId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "severity" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "recommendedAction" TEXT NOT NULL,
  "firstTriggeredAt" TIMESTAMP(3) NOT NULL,
  "lastTriggeredAt" TIMESTAMP(3) NOT NULL,
  "occurrenceCount" INTEGER NOT NULL DEFAULT 1,
  "acknowledgedAt" TIMESTAMP(3),
  "acknowledgedByAccountId" TEXT,
  "resolvedAt" TIMESTAMP(3),
  "resolvedByAccountId" TEXT,
  "resolutionNote" TEXT,
  "autoResolved" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TransportOperationalEscalation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TransportOperationalEscalation_transportRequestId_code_key"
  ON "TransportOperationalEscalation"("transportRequestId", "code");
CREATE INDEX "TransportOperationalEscalation_status_severity_lastTriggeredAt_idx"
  ON "TransportOperationalEscalation"("status", "severity", "lastTriggeredAt");
CREATE INDEX "TransportOperationalEscalation_transportRequestId_status_idx"
  ON "TransportOperationalEscalation"("transportRequestId", "status");
CREATE INDEX "TransportOperationalEscalation_lastTriggeredAt_idx"
  ON "TransportOperationalEscalation"("lastTriggeredAt");
