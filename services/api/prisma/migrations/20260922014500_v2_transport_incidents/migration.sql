-- CarePoint V2 / PRV-085
-- Immutable classified transport incident evidence with encrypted detail payload.

CREATE TABLE "TransportIncident" (
  "id" TEXT NOT NULL,
  "transportRequestId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "severity" TEXT NOT NULL,
  "reasonCode" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "requestDigest" TEXT NOT NULL,
  "crewAssignmentId" TEXT,
  "algorithm" TEXT NOT NULL,
  "keyId" TEXT NOT NULL,
  "wrappedKey" TEXT NOT NULL,
  "iv" TEXT NOT NULL,
  "ciphertext" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "reportedByAccountId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TransportIncident_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TransportIncident_category_ck" CHECK ("category" IN ('DELAY','VEHICLE_BREAKDOWN','PATIENT_CONDITION_CHANGE','REFUSAL','OPERATIONAL')),
  CONSTRAINT "TransportIncident_severity_ck" CHECK ("severity" IN ('INFO','WARNING','CRITICAL')),
  CONSTRAINT "TransportIncident_reason_ck" CHECK ("reasonCode" ~ '^[A-Z0-9][A-Z0-9_.:-]{1,79}$'),
  CONSTRAINT "TransportIncident_idempotency_ck" CHECK ("idempotencyKey" ~ '^[A-Za-z0-9_.:-]{8,128}$'),
  CONSTRAINT "TransportIncident_request_digest_ck" CHECK ("requestDigest" ~ '^[0-9a-f]{64}$')
);

CREATE UNIQUE INDEX "TransportIncident_idempotencyKey_key" ON "TransportIncident"("idempotencyKey");
CREATE INDEX "TransportIncident_transportRequestId_occurredAt_idx" ON "TransportIncident"("transportRequestId", "occurredAt");
CREATE INDEX "TransportIncident_providerId_occurredAt_idx" ON "TransportIncident"("providerId", "occurredAt");
CREATE INDEX "TransportIncident_patientId_occurredAt_idx" ON "TransportIncident"("patientId", "occurredAt");
CREATE INDEX "TransportIncident_severity_occurredAt_idx" ON "TransportIncident"("severity", "occurredAt");

ALTER TABLE "TransportIncident"
  ADD CONSTRAINT "TransportIncident_transportRequestId_fkey"
  FOREIGN KEY ("transportRequestId") REFERENCES "MedicalTransportRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "TransportIncident_providerId_fkey"
  FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "TransportIncident_patientId_fkey"
  FOREIGN KEY ("patientId") REFERENCES "PatientProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "TransportIncident_crewAssignmentId_fkey"
  FOREIGN KEY ("crewAssignmentId") REFERENCES "CrewAssignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "TransportIncident_reportedByAccountId_fkey"
  FOREIGN KEY ("reportedByAccountId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION carepoint_reject_transport_incident_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'TransportIncident is immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "TransportIncident_immutable_trigger"
BEFORE UPDATE OR DELETE ON "TransportIncident"
FOR EACH ROW EXECUTE FUNCTION carepoint_reject_transport_incident_mutation();

REVOKE UPDATE, DELETE ON "TransportIncident" FROM PUBLIC;
