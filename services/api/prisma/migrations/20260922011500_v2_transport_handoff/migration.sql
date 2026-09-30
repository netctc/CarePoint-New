-- CarePoint V2 / PRV-084
-- Immutable destination handoff evidence for scheduled medical transport.

CREATE TABLE "TransportHandoff" (
  "id" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "requestDigest" TEXT NOT NULL,
  "transportRequestId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "crewAssignmentId" TEXT NOT NULL,
  "receiverName" TEXT NOT NULL,
  "receiverRole" TEXT NOT NULL,
  "signatureRequired" BOOLEAN NOT NULL DEFAULT false,
  "signatureMethod" TEXT,
  "handoffSummaryDigest" TEXT NOT NULL,
  "transportContextDigest" TEXT NOT NULL,
  "algorithm" TEXT NOT NULL,
  "keyId" TEXT NOT NULL,
  "wrappedKey" TEXT NOT NULL,
  "iv" TEXT NOT NULL,
  "ciphertext" TEXT NOT NULL,
  "handedOffAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TransportHandoff_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TransportHandoff_idempotency_ck" CHECK ("idempotencyKey" ~ '^[A-Za-z0-9_.:-]{8,128}$'),
  CONSTRAINT "TransportHandoff_request_digest_ck" CHECK ("requestDigest" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "TransportHandoff_summary_digest_ck" CHECK ("handoffSummaryDigest" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "TransportHandoff_context_digest_ck" CHECK ("transportContextDigest" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "TransportHandoff_receiver_name_ck" CHECK (char_length(btrim("receiverName")) BETWEEN 1 AND 160),
  CONSTRAINT "TransportHandoff_receiver_role_ck" CHECK (char_length(btrim("receiverRole")) BETWEEN 1 AND 120),
  CONSTRAINT "TransportHandoff_signature_method_ck" CHECK (
    "signatureMethod" IS NULL OR "signatureMethod" IN ('TYPED_CONFIRMATION','DRAWN_SIGNATURE')
  ),
  CONSTRAINT "TransportHandoff_required_signature_ck" CHECK (
    NOT "signatureRequired" OR "signatureMethod" IS NOT NULL
  )
);

CREATE UNIQUE INDEX "TransportHandoff_idempotencyKey_key" ON "TransportHandoff"("idempotencyKey");
CREATE UNIQUE INDEX "TransportHandoff_transportRequestId_key" ON "TransportHandoff"("transportRequestId");
CREATE INDEX "TransportHandoff_providerId_handedOffAt_idx" ON "TransportHandoff"("providerId", "handedOffAt");
CREATE INDEX "TransportHandoff_patientId_handedOffAt_idx" ON "TransportHandoff"("patientId", "handedOffAt");
CREATE INDEX "TransportHandoff_crewAssignmentId_idx" ON "TransportHandoff"("crewAssignmentId");

ALTER TABLE "TransportHandoff"
  ADD CONSTRAINT "TransportHandoff_transportRequestId_fkey"
  FOREIGN KEY ("transportRequestId") REFERENCES "MedicalTransportRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "TransportHandoff_providerId_fkey"
  FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "TransportHandoff_crewAssignmentId_fkey"
  FOREIGN KEY ("crewAssignmentId") REFERENCES "CrewAssignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION carepoint_reject_transport_handoff_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'TransportHandoff is immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "TransportHandoff_immutable_trigger"
BEFORE UPDATE OR DELETE ON "TransportHandoff"
FOR EACH ROW EXECUTE FUNCTION carepoint_reject_transport_handoff_mutation();

REVOKE UPDATE, DELETE ON "TransportHandoff" FROM PUBLIC;
