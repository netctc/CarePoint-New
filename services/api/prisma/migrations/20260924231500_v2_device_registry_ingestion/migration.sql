-- CarePoint V2 BE-024 / BE-025 — technical device registry and signed ingestion.
-- Measurement PHI is never stored in these technical tables.

CREATE TABLE "DeviceModel" (
  "id" TEXT NOT NULL, "code" TEXT NOT NULL, "manufacturer" TEXT NOT NULL, "modelName" TEXT NOT NULL,
  "deviceType" TEXT NOT NULL, "supportedMetricCodes" JSONB NOT NULL, "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DeviceModel_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Device" (
  "id" TEXT NOT NULL, "deviceModelId" TEXT NOT NULL, "serialNumber" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE', "patientId" TEXT, "providerId" TEXT,
  "lastSeenAt" TIMESTAMP(3), "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Device_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Device_status_check" CHECK ("status" IN ('ACTIVE','REVOKED')),
  CONSTRAINT "Device_assignment_check" CHECK (
    ("patientId" IS NOT NULL AND "providerId" IS NULL) OR
    ("patientId" IS NULL AND "providerId" IS NOT NULL)
  )
);
CREATE TABLE "DeviceCredential" (
  "id" TEXT NOT NULL, "deviceId" TEXT NOT NULL, "keyId" TEXT NOT NULL, "publicKeyPem" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE', "activatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DeviceCredential_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DeviceCredential_status_check" CHECK ("status" IN ('ACTIVE','REVOKED'))
);
CREATE TABLE "DeviceIngestionEvent" (
  "id" TEXT NOT NULL, "deviceId" TEXT NOT NULL, "externalEventId" TEXT NOT NULL,
  "channel" TEXT NOT NULL, "credentialId" TEXT, "providerId" TEXT, "observationId" TEXT,
  "payloadHash" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'PENDING',
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "completedAt" TIMESTAMP(3),
  CONSTRAINT "DeviceIngestionEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DeviceIngestionEvent_channel_check" CHECK ("channel" IN ('SIGNED_DEVICE','PROVIDER_ASSISTED')),
  CONSTRAINT "DeviceIngestionEvent_status_check" CHECK ("status" IN ('PENDING','ACCEPTED'))
);

CREATE UNIQUE INDEX "DeviceModel_code_key" ON "DeviceModel"("code");
CREATE INDEX "DeviceModel_active_deviceType_idx" ON "DeviceModel"("active","deviceType");
CREATE UNIQUE INDEX "Device_serialNumber_key" ON "Device"("serialNumber");
CREATE INDEX "Device_patientId_status_idx" ON "Device"("patientId","status");
CREATE INDEX "Device_providerId_status_idx" ON "Device"("providerId","status");
CREATE INDEX "Device_deviceModelId_status_idx" ON "Device"("deviceModelId","status");
CREATE UNIQUE INDEX "DeviceCredential_deviceId_keyId_key" ON "DeviceCredential"("deviceId","keyId");
CREATE INDEX "DeviceCredential_deviceId_status_idx" ON "DeviceCredential"("deviceId","status");
CREATE UNIQUE INDEX "DeviceIngestionEvent_deviceId_externalEventId_key" ON "DeviceIngestionEvent"("deviceId","externalEventId");
CREATE INDEX "DeviceIngestionEvent_deviceId_receivedAt_idx" ON "DeviceIngestionEvent"("deviceId","receivedAt");
CREATE INDEX "DeviceIngestionEvent_providerId_receivedAt_idx" ON "DeviceIngestionEvent"("providerId","receivedAt");
CREATE INDEX "DeviceIngestionEvent_status_receivedAt_idx" ON "DeviceIngestionEvent"("status","receivedAt");

ALTER TABLE "Device" ADD CONSTRAINT "Device_deviceModelId_fkey"
FOREIGN KEY ("deviceModelId") REFERENCES "DeviceModel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Device" ADD CONSTRAINT "Device_patientId_fkey"
FOREIGN KEY ("patientId") REFERENCES "PatientProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Device" ADD CONSTRAINT "Device_providerId_fkey"
FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DeviceCredential" ADD CONSTRAINT "DeviceCredential_deviceId_fkey"
FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DeviceIngestionEvent" ADD CONSTRAINT "DeviceIngestionEvent_deviceId_fkey"
FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DeviceIngestionEvent" ADD CONSTRAINT "DeviceIngestionEvent_observationId_fkey"
FOREIGN KEY ("observationId") REFERENCES "Observation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
