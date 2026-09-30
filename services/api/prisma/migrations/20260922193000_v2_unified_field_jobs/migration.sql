-- CarePoint V2 / BE-031:
-- unified field-job operational evidence over existing Appointment and MedicalTransportRequest sources.
-- The source resources remain authoritative; these tables are append-only evidence only.

CREATE TABLE "ProviderFieldJobEvent" (
  "id" TEXT NOT NULL,
  "sourceType" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "eventType" TEXT NOT NULL,
  "sourceStatus" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "requestDigest" TEXT NOT NULL,
  "actorAccountId" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProviderFieldJobEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProviderFieldJobEvent_idempotencyKey_key" ON "ProviderFieldJobEvent"("idempotencyKey");
CREATE UNIQUE INDEX "ProviderFieldJobEvent_sourceType_sourceId_sequence_key" ON "ProviderFieldJobEvent"("sourceType", "sourceId", "sequence");
CREATE INDEX "ProviderFieldJobEvent_providerId_occurredAt_idx" ON "ProviderFieldJobEvent"("providerId", "occurredAt");
CREATE INDEX "ProviderFieldJobEvent_patientId_occurredAt_idx" ON "ProviderFieldJobEvent"("patientId", "occurredAt");
CREATE INDEX "ProviderFieldJobEvent_sourceType_sourceId_occurredAt_idx" ON "ProviderFieldJobEvent"("sourceType", "sourceId", "occurredAt");

CREATE TABLE "ProviderFieldJobChecklistRevision" (
  "id" TEXT NOT NULL,
  "sourceType" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "items" JSONB NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "requestDigest" TEXT NOT NULL,
  "recordedByAccountId" TEXT NOT NULL,
  "recordedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProviderFieldJobChecklistRevision_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProviderFieldJobChecklistRevision_idempotencyKey_key" ON "ProviderFieldJobChecklistRevision"("idempotencyKey");
CREATE UNIQUE INDEX "ProviderFieldJobChecklistRevision_sourceType_sourceId_revision_key" ON "ProviderFieldJobChecklistRevision"("sourceType", "sourceId", "revision");
CREATE INDEX "ProviderFieldJobChecklistRevision_providerId_recordedAt_idx" ON "ProviderFieldJobChecklistRevision"("providerId", "recordedAt");
CREATE INDEX "ProviderFieldJobChecklistRevision_patientId_recordedAt_idx" ON "ProviderFieldJobChecklistRevision"("patientId", "recordedAt");
CREATE INDEX "ProviderFieldJobChecklistRevision_sourceType_sourceId_recordedAt_idx" ON "ProviderFieldJobChecklistRevision"("sourceType", "sourceId", "recordedAt");

CREATE TABLE "ProviderFieldServiceCompletion" (
  "id" TEXT NOT NULL,
  "sourceType" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "completionCode" TEXT NOT NULL,
  "sourceStatus" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "requestDigest" TEXT NOT NULL,
  "completedByAccountId" TEXT NOT NULL,
  "completedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProviderFieldServiceCompletion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProviderFieldServiceCompletion_idempotencyKey_key" ON "ProviderFieldServiceCompletion"("idempotencyKey");
CREATE UNIQUE INDEX "ProviderFieldServiceCompletion_sourceType_sourceId_key" ON "ProviderFieldServiceCompletion"("sourceType", "sourceId");
CREATE INDEX "ProviderFieldServiceCompletion_providerId_completedAt_idx" ON "ProviderFieldServiceCompletion"("providerId", "completedAt");
CREATE INDEX "ProviderFieldServiceCompletion_patientId_completedAt_idx" ON "ProviderFieldServiceCompletion"("patientId", "completedAt");

ALTER TABLE "ProviderFieldJobEvent"
  ADD CONSTRAINT "ProviderFieldJobEvent_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "ProviderFieldJobEvent_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "PatientProfile"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "ProviderFieldJobEvent_source_type_ck" CHECK ("sourceType" IN ('HOME_VISIT','MEDICAL_TRANSPORT')),
  ADD CONSTRAINT "ProviderFieldJobEvent_sequence_ck" CHECK ("sequence" > 0),
  ADD CONSTRAINT "ProviderFieldJobEvent_type_ck" CHECK ("eventType" IN ('ACKNOWLEDGED','ARRIVAL_CONFIRMED','CHECKLIST_RECORDED','SERVICE_COMPLETED')),
  ADD CONSTRAINT "ProviderFieldJobEvent_digest_ck" CHECK ("requestDigest" ~ '^[0-9a-f]{64}$');

ALTER TABLE "ProviderFieldJobChecklistRevision"
  ADD CONSTRAINT "ProviderFieldJobChecklistRevision_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "ProviderFieldJobChecklistRevision_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "PatientProfile"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "ProviderFieldJobChecklistRevision_source_type_ck" CHECK ("sourceType" IN ('HOME_VISIT','MEDICAL_TRANSPORT')),
  ADD CONSTRAINT "ProviderFieldJobChecklistRevision_revision_ck" CHECK ("revision" > 0),
  ADD CONSTRAINT "ProviderFieldJobChecklistRevision_digest_ck" CHECK ("requestDigest" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "ProviderFieldJobChecklistRevision_items_array_ck" CHECK (jsonb_typeof("items") = 'array');

ALTER TABLE "ProviderFieldServiceCompletion"
  ADD CONSTRAINT "ProviderFieldServiceCompletion_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "ProviderFieldServiceCompletion_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "PatientProfile"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "ProviderFieldServiceCompletion_source_type_ck" CHECK ("sourceType" IN ('HOME_VISIT','MEDICAL_TRANSPORT')),
  ADD CONSTRAINT "ProviderFieldServiceCompletion_code_ck" CHECK ("completionCode" = 'SERVICE_DELIVERED'),
  ADD CONSTRAINT "ProviderFieldServiceCompletion_digest_ck" CHECK ("requestDigest" ~ '^[0-9a-f]{64}$');

CREATE OR REPLACE FUNCTION carepoint_reject_provider_field_job_evidence_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only and cannot be updated or deleted', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ProviderFieldJobEvent_immutable_trigger"
BEFORE UPDATE OR DELETE ON "ProviderFieldJobEvent"
FOR EACH ROW EXECUTE FUNCTION carepoint_reject_provider_field_job_evidence_mutation();

CREATE TRIGGER "ProviderFieldJobChecklistRevision_immutable_trigger"
BEFORE UPDATE OR DELETE ON "ProviderFieldJobChecklistRevision"
FOR EACH ROW EXECUTE FUNCTION carepoint_reject_provider_field_job_evidence_mutation();

CREATE TRIGGER "ProviderFieldServiceCompletion_immutable_trigger"
BEFORE UPDATE OR DELETE ON "ProviderFieldServiceCompletion"
FOR EACH ROW EXECUTE FUNCTION carepoint_reject_provider_field_job_evidence_mutation();

REVOKE UPDATE, DELETE ON "ProviderFieldJobEvent" FROM PUBLIC;
REVOKE UPDATE, DELETE ON "ProviderFieldJobChecklistRevision" FROM PUBLIC;
REVOKE UPDATE, DELETE ON "ProviderFieldServiceCompletion" FROM PUBLIC;
