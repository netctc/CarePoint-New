CREATE TABLE "ProviderFieldMediaEvidence" (
  "id" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "requestDigest" TEXT NOT NULL,
  "clinicalMediaId" TEXT NOT NULL,
  "appointmentId" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "authorActorId" TEXT NOT NULL,
  "contentDigest" TEXT NOT NULL,
  "capturedAt" TIMESTAMP(3) NOT NULL,
  "retentionPolicyCode" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProviderFieldMediaEvidence_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProviderFieldMediaEvidence_request_digest_ck" CHECK ("requestDigest" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "ProviderFieldMediaEvidence_digest_ck" CHECK ("contentDigest" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "ProviderFieldMediaEvidence_retention_ck" CHECK ("retentionPolicyCode" = 'CLINICAL_MEDIA_GOVERNED_RETENTION')
);

CREATE UNIQUE INDEX "ProviderFieldMediaEvidence_idempotencyKey_key" ON "ProviderFieldMediaEvidence"("idempotencyKey");
CREATE UNIQUE INDEX "ProviderFieldMediaEvidence_clinicalMediaId_key" ON "ProviderFieldMediaEvidence"("clinicalMediaId");
CREATE INDEX "ProviderFieldMediaEvidence_appointmentId_capturedAt_idx" ON "ProviderFieldMediaEvidence"("appointmentId", "capturedAt");
CREATE INDEX "ProviderFieldMediaEvidence_patientId_capturedAt_idx" ON "ProviderFieldMediaEvidence"("patientId", "capturedAt");
CREATE INDEX "ProviderFieldMediaEvidence_providerId_capturedAt_idx" ON "ProviderFieldMediaEvidence"("providerId", "capturedAt");

ALTER TABLE "ProviderFieldMediaEvidence" ADD CONSTRAINT "ProviderFieldMediaEvidence_clinicalMediaId_fkey" FOREIGN KEY ("clinicalMediaId") REFERENCES "ClinicalMedia"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProviderFieldMediaEvidence" ADD CONSTRAINT "ProviderFieldMediaEvidence_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProviderFieldMediaEvidence" ADD CONSTRAINT "ProviderFieldMediaEvidence_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "PatientProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProviderFieldMediaEvidence" ADD CONSTRAINT "ProviderFieldMediaEvidence_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION carepoint_reject_provider_field_media_evidence_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Provider field media evidence is append-only';
END;
$$;

CREATE TRIGGER "ProviderFieldMediaEvidence_append_only_trg"
BEFORE UPDATE OR DELETE ON "ProviderFieldMediaEvidence"
FOR EACH ROW EXECUTE FUNCTION carepoint_reject_provider_field_media_evidence_mutation();

REVOKE UPDATE, DELETE ON "ProviderFieldMediaEvidence" FROM PUBLIC;
