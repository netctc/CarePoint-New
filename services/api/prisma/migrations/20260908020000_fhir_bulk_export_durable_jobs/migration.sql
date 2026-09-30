CREATE TABLE "FhirBulkExportJobState" (
    "id" VARCHAR(128) NOT NULL,
    "clientId" VARCHAR(200) NOT NULL,
    "status" VARCHAR(32) NOT NULL,
    "payload" JSONB NOT NULL,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseOwner" VARCHAR(160),
    "leaseUntil" TIMESTAMP(3),
    "purgeAt" TIMESTAMP(3) NOT NULL,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FhirBulkExportJobState_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FhirBulkExportJobState_status_availableAt_idx"
    ON "FhirBulkExportJobState"("status", "availableAt");
CREATE INDEX "FhirBulkExportJobState_leaseUntil_idx"
    ON "FhirBulkExportJobState"("leaseUntil");
CREATE INDEX "FhirBulkExportJobState_purgeAt_idx"
    ON "FhirBulkExportJobState"("purgeAt");
CREATE INDEX "FhirBulkExportJobState_clientId_createdAt_idx"
    ON "FhirBulkExportJobState"("clientId", "createdAt");
