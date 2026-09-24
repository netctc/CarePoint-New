-- CarePoint V2 C1 / BE-024 / BE-025 — governed medical-device registry and ingestion.
-- Device credentials store public verification material only. Clinical values remain in encrypted Observation.

CREATE TABLE "DeviceModel" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "manufacturer" TEXT NOT NULL,
  "modelName" TEXT NOT NULL,
  "deviceType" TEXT NOT NULL,
  "observationCodes" JSONB NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DeviceModel_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DeviceIntegrationConfig" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "providerName" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "observationScopes" JSONB NOT NULL,
  "webhookPublicKey" TEXT NOT NULL,
  "publicKeyFingerprint" TEXT NOT NULL,
  "healthState" TEXT NOT NULL DEFAULT 'UNKNOWN',
  "lastSuccessAt" TIMESTAMP(3),
  "lastErrorCode" TEXT,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DeviceIntegrationConfig_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DeviceIntegrationConfig_status_check" CHECK ("status" IN ('ACTIVE','REVOKED')),
  CONSTRAINT "DeviceIntegrationConfig_health_check" CHECK ("healthState" IN ('UNKNOWN','HEALTHY','DEGRADED','REVOKED'))
);

CREATE TABLE "Device" (
  "id" TEXT NOT NULL,
  "modelId" TEXT NOT NULL,
  "serialNumber" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "assignedPatientId" TEXT,
  "assignedProviderId" TEXT,
  "integrationId" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "lastSeenAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Device_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Device_status_check" CHECK ("status" IN ('ACTIVE','REVOKED')),
  CONSTRAINT "Device_version_check" CHECK ("version" > 0)
);

CREATE TABLE "DeviceCredential" (
  "id" TEXT NOT NULL,
  "deviceId" TEXT NOT NULL,
  "publicKeyPem" TEXT NOT NULL,
  "publicKeyFingerprint" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "expiresAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DeviceCredential_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DeviceCredential_status_check" CHECK ("status" IN ('ACTIVE','REVOKED'))
);

CREATE TABLE "DeviceIngestionEvent" (
  "id" TEXT NOT NULL,
  "deviceId" TEXT NOT NULL,
  "integrationId" TEXT,
  "externalEventId" TEXT NOT NULL,
  "payloadDigest" TEXT NOT NULL,
  "sourceKind" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "observedAt" TIMESTAMP(3) NOT NULL,
  "observationId" TEXT,
  "errorCode" TEXT,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMP(3),
  CONSTRAINT "DeviceIngestionEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DeviceIngestionEvent_source_check" CHECK ("sourceKind" IN ('DIRECT_DEVICE','INTEGRATION_WEBHOOK','PROVIDER_CAPTURE')),
  CONSTRAINT "DeviceIngestionEvent_status_check" CHECK ("status" IN ('PENDING','ACCEPTED','REJECTED'))
);

CREATE UNIQUE INDEX "DeviceModel_code_key" ON "DeviceModel"("code");
CREATE INDEX "DeviceModel_active_deviceType_code_idx" ON "DeviceModel"("active","deviceType","code");
CREATE UNIQUE INDEX "DeviceIntegrationConfig_code_key" ON "DeviceIntegrationConfig"("code");
CREATE INDEX "DeviceIntegrationConfig_status_healthState_code_idx" ON "DeviceIntegrationConfig"("status","healthState","code");
CREATE UNIQUE INDEX "Device_modelId_serialNumber_key" ON "Device"("modelId","serialNumber");
CREATE INDEX "Device_assignedPatientId_status_idx" ON "Device"("assignedPatientId","status");
CREATE INDEX "Device_assignedProviderId_status_idx" ON "Device"("assignedProviderId","status");
CREATE INDEX "Device_integrationId_status_idx" ON "Device"("integrationId","status");
CREATE UNIQUE INDEX "DeviceCredential_publicKeyFingerprint_key" ON "DeviceCredential"("publicKeyFingerprint");
CREATE INDEX "DeviceCredential_deviceId_status_createdAt_idx" ON "DeviceCredential"("deviceId","status","createdAt");
CREATE UNIQUE INDEX "DeviceIngestionEvent_deviceId_externalEventId_key" ON "DeviceIngestionEvent"("deviceId","externalEventId");
CREATE INDEX "DeviceIngestionEvent_integrationId_receivedAt_idx" ON "DeviceIngestionEvent"("integrationId","receivedAt");
CREATE INDEX "DeviceIngestionEvent_status_receivedAt_idx" ON "DeviceIngestionEvent"("status","receivedAt");
CREATE INDEX "DeviceIngestionEvent_observationId_idx" ON "DeviceIngestionEvent"("observationId");

ALTER TABLE "Device"
  ADD CONSTRAINT "Device_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "DeviceModel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Device"
  ADD CONSTRAINT "Device_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "DeviceIntegrationConfig"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DeviceCredential"
  ADD CONSTRAINT "DeviceCredential_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DeviceIngestionEvent"
  ADD CONSTRAINT "DeviceIngestionEvent_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DeviceIngestionEvent"
  ADD CONSTRAINT "DeviceIngestionEvent_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "DeviceIntegrationConfig"("id") ON DELETE SET NULL ON UPDATE CASCADE;
