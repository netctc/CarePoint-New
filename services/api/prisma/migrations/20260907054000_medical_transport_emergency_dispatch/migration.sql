-- Slice 8: persistent scheduled medical transport and emergency dispatch history.

ALTER TYPE "NotificationEventType" ADD VALUE IF NOT EXISTS 'EMERGENCY_UPDATE';
ALTER TYPE "NotificationEventType" ADD VALUE IF NOT EXISTS 'TRANSPORT_UPDATE';

CREATE TYPE "MedicalTransportMode" AS ENUM ('GROUND', 'AIR');
CREATE TYPE "MedicalTransportStatus" AS ENUM ('REQUESTED', 'ASSIGNED', 'EN_ROUTE', 'ARRIVED', 'TRANSPORTING', 'COMPLETED', 'CANCELLED');
CREATE TYPE "MedicalTransportAssistance" AS ENUM ('STANDARD', 'WHEELCHAIR', 'STRETCHER');

CREATE TABLE "MedicalTransportRequest" (
  "id" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "mode" "MedicalTransportMode" NOT NULL,
  "status" "MedicalTransportStatus" NOT NULL DEFAULT 'REQUESTED',
  "assistance" "MedicalTransportAssistance" NOT NULL DEFAULT 'STANDARD',
  "scheduledFor" TIMESTAMP(3) NOT NULL,
  "pickupLatitude" DECIMAL(9,6) NOT NULL,
  "pickupLongitude" DECIMAL(9,6) NOT NULL,
  "pickupAddress" TEXT,
  "destinationLatitude" DECIMAL(9,6) NOT NULL,
  "destinationLongitude" DECIMAL(9,6) NOT NULL,
  "destinationAddress" TEXT,
  "callbackPhone" TEXT,
  "assignedProviderId" TEXT,
  "etaMinutes" INTEGER,
  "clientRequestId" TEXT NOT NULL,
  "cancellationReason" TEXT,
  "cancelledAt" TIMESTAMP(3),
  "assignedAt" TIMESTAMP(3),
  "enRouteAt" TIMESTAMP(3),
  "arrivedAt" TIMESTAMP(3),
  "transportingAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MedicalTransportRequest_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MedicalTransportRequest_eta_check" CHECK ("etaMinutes" IS NULL OR ("etaMinutes" >= 0 AND "etaMinutes" <= 1440))
);

CREATE UNIQUE INDEX "MedicalTransportRequest_patientId_clientRequestId_key" ON "MedicalTransportRequest"("patientId", "clientRequestId");
CREATE INDEX "MedicalTransportRequest_patientId_requestedAt_idx" ON "MedicalTransportRequest"("patientId", "requestedAt");
CREATE INDEX "MedicalTransportRequest_mode_status_scheduledFor_idx" ON "MedicalTransportRequest"("mode", "status", "scheduledFor");
CREATE INDEX "MedicalTransportRequest_assignedProviderId_status_scheduledFor_idx" ON "MedicalTransportRequest"("assignedProviderId", "status", "scheduledFor");

ALTER TABLE "MedicalTransportRequest"
  ADD CONSTRAINT "MedicalTransportRequest_patientId_fkey"
  FOREIGN KEY ("patientId") REFERENCES "PatientProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MedicalTransportRequest"
  ADD CONSTRAINT "MedicalTransportRequest_assignedProviderId_fkey"
  FOREIGN KEY ("assignedProviderId") REFERENCES "Provider"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "MedicalTransportEvent" (
  "id" TEXT NOT NULL,
  "transportRequestId" TEXT NOT NULL,
  "actorAccountId" TEXT,
  "fromStatus" "MedicalTransportStatus",
  "toStatus" "MedicalTransportStatus" NOT NULL,
  "providerId" TEXT,
  "etaMinutes" INTEGER,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MedicalTransportEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "MedicalTransportEvent_transportRequestId_occurredAt_idx" ON "MedicalTransportEvent"("transportRequestId", "occurredAt");
CREATE INDEX "MedicalTransportEvent_providerId_occurredAt_idx" ON "MedicalTransportEvent"("providerId", "occurredAt");
ALTER TABLE "MedicalTransportEvent"
  ADD CONSTRAINT "MedicalTransportEvent_transportRequestId_fkey"
  FOREIGN KEY ("transportRequestId") REFERENCES "MedicalTransportRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MedicalTransportEvent"
  ADD CONSTRAINT "MedicalTransportEvent_actorAccountId_fkey"
  FOREIGN KEY ("actorAccountId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MedicalTransportEvent"
  ADD CONSTRAINT "MedicalTransportEvent_providerId_fkey"
  FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "EmergencyRequestIdempotency" (
  "id" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "clientRequestId" TEXT NOT NULL,
  "emergencyRequestId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EmergencyRequestIdempotency_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "EmergencyRequestIdempotency_patientId_clientRequestId_key" ON "EmergencyRequestIdempotency"("patientId", "clientRequestId");
CREATE UNIQUE INDEX "EmergencyRequestIdempotency_emergencyRequestId_key" ON "EmergencyRequestIdempotency"("emergencyRequestId");
ALTER TABLE "EmergencyRequestIdempotency"
  ADD CONSTRAINT "EmergencyRequestIdempotency_patientId_fkey"
  FOREIGN KEY ("patientId") REFERENCES "PatientProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmergencyRequestIdempotency"
  ADD CONSTRAINT "EmergencyRequestIdempotency_emergencyRequestId_fkey"
  FOREIGN KEY ("emergencyRequestId") REFERENCES "EmergencyAmbulanceRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "EmergencyDispatchEvent" (
  "id" TEXT NOT NULL,
  "emergencyRequestId" TEXT NOT NULL,
  "actorAccountId" TEXT,
  "fromStatus" "EmergencyAmbulanceStatus",
  "toStatus" "EmergencyAmbulanceStatus" NOT NULL,
  "providerId" TEXT,
  "etaMinutes" INTEGER,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EmergencyDispatchEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "EmergencyDispatchEvent_emergencyRequestId_occurredAt_idx" ON "EmergencyDispatchEvent"("emergencyRequestId", "occurredAt");
CREATE INDEX "EmergencyDispatchEvent_providerId_occurredAt_idx" ON "EmergencyDispatchEvent"("providerId", "occurredAt");
ALTER TABLE "EmergencyDispatchEvent"
  ADD CONSTRAINT "EmergencyDispatchEvent_emergencyRequestId_fkey"
  FOREIGN KEY ("emergencyRequestId") REFERENCES "EmergencyAmbulanceRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmergencyDispatchEvent"
  ADD CONSTRAINT "EmergencyDispatchEvent_actorAccountId_fkey"
  FOREIGN KEY ("actorAccountId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EmergencyDispatchEvent"
  ADD CONSTRAINT "EmergencyDispatchEvent_providerId_fkey"
  FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE SET NULL ON UPDATE CASCADE;
