-- CarePoint V2 / A6B:
-- structured Other Provider workflow evidence.

CREATE TABLE "ProviderWorkflowEvent" (
  "id" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "contextType" TEXT NOT NULL,
  "contextId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "evidence" JSONB NOT NULL,
  "idempotencyKey" TEXT,
  "actorId" TEXT,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProviderWorkflowEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProviderWorkflowEvent_idempotencyKey_key"
ON "ProviderWorkflowEvent"("idempotencyKey");

CREATE INDEX "ProviderWorkflowEvent_providerId_contextType_contextId_occurredAt_idx"
ON "ProviderWorkflowEvent"("providerId", "contextType", "contextId", "occurredAt");

CREATE INDEX "ProviderWorkflowEvent_patientId_eventType_occurredAt_idx"
ON "ProviderWorkflowEvent"("patientId", "eventType", "occurredAt");

ALTER TABLE "ProviderWorkflowEvent"
ADD CONSTRAINT "ProviderWorkflowEvent_providerId_fkey"
FOREIGN KEY ("providerId") REFERENCES "Provider"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProviderWorkflowEvent"
ADD CONSTRAINT "ProviderWorkflowEvent_patientId_fkey"
FOREIGN KEY ("patientId") REFERENCES "PatientProfile"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
