CREATE TABLE "TransportTrackingSession" (
  "id" TEXT NOT NULL,
  "transportRequestId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "transportUnitId" TEXT NOT NULL,
  "sharingStatus" TEXT NOT NULL DEFAULT 'ACTIVE',
  "shareWithPatient" BOOLEAN NOT NULL DEFAULT false,
  "startedByAccountId" TEXT NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastHeartbeatAt" TIMESTAMP(3),
  "stoppedAt" TIMESTAMP(3),
  "stopReason" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TransportTrackingSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TransportTrackingSession_transportRequestId_key"
  ON "TransportTrackingSession"("transportRequestId");
CREATE INDEX "TransportTrackingSession_providerId_sharingStatus_expiresAt_idx"
  ON "TransportTrackingSession"("providerId", "sharingStatus", "expiresAt");
CREATE INDEX "TransportTrackingSession_transportUnitId_sharingStatus_expiresAt_idx"
  ON "TransportTrackingSession"("transportUnitId", "sharingStatus", "expiresAt");
CREATE INDEX "TransportTrackingSession_expiresAt_idx"
  ON "TransportTrackingSession"("expiresAt");

CREATE TABLE "TransportUnitTelemetry" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "transportRequestId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "transportUnitId" TEXT NOT NULL,
  "clientEventId" TEXT NOT NULL,
  "latitude" DECIMAL(9,6) NOT NULL,
  "longitude" DECIMAL(9,6) NOT NULL,
  "accuracyMeters" DECIMAL(8,2),
  "headingDegrees" DECIMAL(6,2),
  "speedKph" DECIMAL(7,2),
  "source" TEXT NOT NULL DEFAULT 'PROVIDER_MOBILE_FOREGROUND',
  "capturedAt" TIMESTAMP(3) NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TransportUnitTelemetry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TransportUnitTelemetry_clientEventId_key"
  ON "TransportUnitTelemetry"("clientEventId");
CREATE INDEX "TransportUnitTelemetry_sessionId_capturedAt_idx"
  ON "TransportUnitTelemetry"("sessionId", "capturedAt");
CREATE INDEX "TransportUnitTelemetry_transportRequestId_capturedAt_idx"
  ON "TransportUnitTelemetry"("transportRequestId", "capturedAt");
CREATE INDEX "TransportUnitTelemetry_transportUnitId_capturedAt_idx"
  ON "TransportUnitTelemetry"("transportUnitId", "capturedAt");
CREATE INDEX "TransportUnitTelemetry_expiresAt_idx"
  ON "TransportUnitTelemetry"("expiresAt");
