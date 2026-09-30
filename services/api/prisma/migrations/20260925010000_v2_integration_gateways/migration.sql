-- CarePoint V2 C2: governed FHIR + external laboratory integration configuration.
-- Additive only. External lab payloads remain encrypted in staging and never bypass clinical release.

CREATE TABLE "FhirGatewayConfig" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "environment" TEXT NOT NULL,
  "baseUrl" TEXT NOT NULL,
  "credentialReference" TEXT,
  "scopes" JSONB NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "lastTestStatus" TEXT,
  "lastTestAt" TIMESTAMP(3),
  "lastErrorCode" TEXT,
  "createdByActorId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FhirGatewayConfig_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FhirGatewayConfig_environment_check" CHECK ("environment" IN ('SANDBOX','PRODUCTION')),
  CONSTRAINT "FhirGatewayConfig_test_check" CHECK ("lastTestStatus" IS NULL OR "lastTestStatus" IN ('SUCCESS','FAILED'))
);
CREATE UNIQUE INDEX "FhirGatewayConfig_code_environment_key" ON "FhirGatewayConfig"("code","environment");
CREATE INDEX "FhirGatewayConfig_enabled_environment_code_idx" ON "FhirGatewayConfig"("enabled","environment","code");

CREATE TABLE "FhirResourceMapping" (
  "id" TEXT NOT NULL,
  "configId" TEXT NOT NULL,
  "resourceType" TEXT NOT NULL,
  "direction" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "mapping" JSONB NOT NULL,
  "createdByActorId" TEXT NOT NULL,
  "publishedAt" TIMESTAMP(3),
  "retiredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FhirResourceMapping_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FhirResourceMapping_version_check" CHECK ("version" > 0),
  CONSTRAINT "FhirResourceMapping_direction_check" CHECK ("direction" IN ('INBOUND','OUTBOUND','BIDIRECTIONAL')),
  CONSTRAINT "FhirResourceMapping_status_check" CHECK ("status" IN ('DRAFT','PUBLISHED','RETIRED')),
  CONSTRAINT "FhirResourceMapping_configId_fkey" FOREIGN KEY ("configId") REFERENCES "FhirGatewayConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "FhirResourceMapping_configId_resourceType_direction_version_key" ON "FhirResourceMapping"("configId","resourceType","direction","version");
CREATE INDEX "FhirResourceMapping_configId_status_resourceType_idx" ON "FhirResourceMapping"("configId","status","resourceType");

CREATE TABLE "LabIntegrationConfig" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "environment" TEXT NOT NULL,
  "baseUrl" TEXT NOT NULL,
  "healthPath" TEXT NOT NULL,
  "credentialReference" TEXT,
  "sourceSystem" TEXT NOT NULL,
  "webhookPublicKeyPem" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "lastTestStatus" TEXT,
  "lastTestAt" TIMESTAMP(3),
  "lastErrorCode" TEXT,
  "createdByActorId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LabIntegrationConfig_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LabIntegrationConfig_environment_check" CHECK ("environment" IN ('SANDBOX','PRODUCTION')),
  CONSTRAINT "LabIntegrationConfig_test_check" CHECK ("lastTestStatus" IS NULL OR "lastTestStatus" IN ('SUCCESS','FAILED'))
);
CREATE UNIQUE INDEX "LabIntegrationConfig_code_environment_key" ON "LabIntegrationConfig"("code","environment");
CREATE INDEX "LabIntegrationConfig_enabled_environment_code_idx" ON "LabIntegrationConfig"("enabled","environment","code");

CREATE TABLE "LabTestMapping" (
  "id" TEXT NOT NULL,
  "configId" TEXT NOT NULL,
  "externalCode" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "internalCodeSystem" TEXT NOT NULL,
  "internalCode" TEXT NOT NULL,
  "internalDisplay" TEXT NOT NULL,
  "canonicalUnit" TEXT,
  "createdByActorId" TEXT NOT NULL,
  "publishedAt" TIMESTAMP(3),
  "retiredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LabTestMapping_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LabTestMapping_version_check" CHECK ("version" > 0),
  CONSTRAINT "LabTestMapping_status_check" CHECK ("status" IN ('DRAFT','PUBLISHED','RETIRED')),
  CONSTRAINT "LabTestMapping_configId_fkey" FOREIGN KEY ("configId") REFERENCES "LabIntegrationConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "LabTestMapping_configId_externalCode_version_key" ON "LabTestMapping"("configId","externalCode","version");
CREATE INDEX "LabTestMapping_configId_status_externalCode_idx" ON "LabTestMapping"("configId","status","externalCode");

CREATE TABLE "ExternalLabResult" (
  "id" TEXT NOT NULL,
  "configId" TEXT NOT NULL,
  "externalEventId" TEXT NOT NULL,
  "externalOrderId" TEXT NOT NULL,
  "externalResultId" TEXT NOT NULL,
  "clinicalOrderId" TEXT NOT NULL,
  "sourceSystem" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "payloadDigest" TEXT NOT NULL,
  "algorithm" TEXT NOT NULL,
  "keyId" TEXT NOT NULL,
  "wrappedKey" TEXT NOT NULL,
  "iv" TEXT NOT NULL,
  "ciphertext" TEXT NOT NULL,
  "retryCount" INTEGER NOT NULL DEFAULT 0,
  "lastErrorCode" TEXT,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMP(3),
  "importedAt" TIMESTAMP(3),
  "importedByActorId" TEXT,
  CONSTRAINT "ExternalLabResult_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ExternalLabResult_status_check" CHECK ("status" IN ('READY','QUARANTINED','IMPORTED')),
  CONSTRAINT "ExternalLabResult_configId_fkey" FOREIGN KEY ("configId") REFERENCES "LabIntegrationConfig"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ExternalLabResult_configId_externalEventId_key" ON "ExternalLabResult"("configId","externalEventId");
CREATE INDEX "ExternalLabResult_configId_status_receivedAt_idx" ON "ExternalLabResult"("configId","status","receivedAt");
CREATE INDEX "ExternalLabResult_clinicalOrderId_status_idx" ON "ExternalLabResult"("clinicalOrderId","status");

CREATE TABLE "IntegrationExchange" (
  "id" TEXT NOT NULL,
  "connectorKind" TEXT NOT NULL,
  "configId" TEXT NOT NULL,
  "direction" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "externalEventId" TEXT,
  "resourceRef" TEXT,
  "payloadDigest" TEXT,
  "errorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "IntegrationExchange_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "IntegrationExchange_connectorKind_configId_createdAt_idx" ON "IntegrationExchange"("connectorKind","configId","createdAt");
CREATE INDEX "IntegrationExchange_status_createdAt_idx" ON "IntegrationExchange"("status","createdAt");
