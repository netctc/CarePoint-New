-- CarePoint V2 PAT-131 — encrypted patient-reported possible medication effects.
-- The table is append-only. Symptom/severity/notes remain encrypted; clear columns are routing/provenance only.

CREATE TABLE "AdverseEventReport" (
  "id" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "sourceKind" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "routedProviderId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "requestDigest" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'RECEIVED',
  "algorithm" TEXT NOT NULL,
  "keyId" TEXT NOT NULL,
  "wrappedKey" TEXT NOT NULL,
  "iv" TEXT NOT NULL,
  "ciphertext" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3),
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdverseEventReport_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AdverseEventReport_sourceKind_check"
    CHECK ("sourceKind" IN ('CLINICAL_PROFILE_ENTRY', 'PRESCRIPTION_ORDER')),
  CONSTRAINT "AdverseEventReport_status_check"
    CHECK ("status" = 'RECEIVED')
);

CREATE UNIQUE INDEX "AdverseEventReport_accountId_patientId_idempotencyKey_key"
ON "AdverseEventReport"("accountId", "patientId", "idempotencyKey");

CREATE INDEX "AdverseEventReport_accountId_patientId_receivedAt_idx"
ON "AdverseEventReport"("accountId", "patientId", "receivedAt");

CREATE INDEX "AdverseEventReport_routedProviderId_receivedAt_idx"
ON "AdverseEventReport"("routedProviderId", "receivedAt");

CREATE INDEX "AdverseEventReport_sourceKind_sourceId_receivedAt_idx"
ON "AdverseEventReport"("sourceKind", "sourceId", "receivedAt");

ALTER TABLE "AdverseEventReport"
ADD CONSTRAINT "AdverseEventReport_patientId_fkey"
FOREIGN KEY ("patientId") REFERENCES "PatientProfile"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AdverseEventReport"
ADD CONSTRAINT "AdverseEventReport_routedProviderId_fkey"
FOREIGN KEY ("routedProviderId") REFERENCES "Provider"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION carepoint_reject_adverse_event_report_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'adverse event reports are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AdverseEventReport_append_only"
BEFORE UPDATE OR DELETE ON "AdverseEventReport"
FOR EACH ROW EXECUTE FUNCTION carepoint_reject_adverse_event_report_mutation();

REVOKE UPDATE, DELETE ON "AdverseEventReport" FROM PUBLIC;
