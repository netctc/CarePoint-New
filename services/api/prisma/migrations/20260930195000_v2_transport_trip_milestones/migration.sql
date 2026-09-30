CREATE TABLE "TransportTripMilestone" (
  "id" TEXT NOT NULL,
  "transportRequestId" TEXT NOT NULL,
  "providerId" TEXT,
  "transportUnitId" TEXT,
  "code" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "lifecycleStatus" TEXT NOT NULL,
  "distanceMeters" INTEGER,
  "telemetryCapturedAt" TIMESTAMP(3),
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TransportTripMilestone_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TransportTripMilestone_transportRequestId_code_key"
  ON "TransportTripMilestone"("transportRequestId", "code");
CREATE INDEX "TransportTripMilestone_transportRequestId_occurredAt_idx"
  ON "TransportTripMilestone"("transportRequestId", "occurredAt");
CREATE INDEX "TransportTripMilestone_providerId_occurredAt_idx"
  ON "TransportTripMilestone"("providerId", "occurredAt");
CREATE INDEX "TransportTripMilestone_transportUnitId_occurredAt_idx"
  ON "TransportTripMilestone"("transportUnitId", "occurredAt");
CREATE INDEX "TransportTripMilestone_code_occurredAt_idx"
  ON "TransportTripMilestone"("code", "occurredAt");
