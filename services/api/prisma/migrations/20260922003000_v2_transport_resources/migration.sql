-- CarePoint V2 / PRV-082
-- Governed transport unit registry and immutable crew/unit assignment revisions.

CREATE TABLE "TransportUnit" (
  "id" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "registrationCode" TEXT NOT NULL,
  "mode" "MedicalTransportMode" NOT NULL,
  "capabilities" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TransportUnit_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TransportUnit_code_ck" CHECK ("code" ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$'),
  CONSTRAINT "TransportUnit_registration_ck" CHECK (char_length(btrim("registrationCode")) BETWEEN 1 AND 80),
  CONSTRAINT "TransportUnit_capabilities_ck" CHECK (
    "capabilities" <@ ARRAY['OXYGEN','MONITORING','VENTILATION','WHEELCHAIR','STRETCHER']::TEXT[]
  )
);

CREATE UNIQUE INDEX "TransportUnit_providerId_code_key" ON "TransportUnit"("providerId", "code");
CREATE UNIQUE INDEX "TransportUnit_providerId_registrationCode_key" ON "TransportUnit"("providerId", "registrationCode");
CREATE INDEX "TransportUnit_providerId_mode_active_idx" ON "TransportUnit"("providerId", "mode", "active");

ALTER TABLE "TransportUnit"
  ADD CONSTRAINT "TransportUnit_providerId_fkey"
  FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "CrewAssignment" (
  "id" TEXT NOT NULL,
  "transportRequestId" TEXT NOT NULL,
  "transportUnitId" TEXT,
  "providerId" TEXT NOT NULL,
  "crewProviderIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "revision" INTEGER NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "assignedByAccountId" TEXT NOT NULL,
  "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CrewAssignment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CrewAssignment_revision_ck" CHECK ("revision" > 0),
  CONSTRAINT "CrewAssignment_crew_count_ck" CHECK (cardinality("crewProviderIds") <= 8),
  CONSTRAINT "CrewAssignment_idempotency_ck" CHECK ("idempotencyKey" ~ '^[A-Za-z0-9_.:-]{8,128}$'),
  CONSTRAINT "CrewAssignment_payload_hash_ck" CHECK ("payloadHash" ~ '^[0-9a-f]{64}$')
);

CREATE UNIQUE INDEX "CrewAssignment_idempotencyKey_key" ON "CrewAssignment"("idempotencyKey");
CREATE UNIQUE INDEX "CrewAssignment_transportRequestId_revision_key" ON "CrewAssignment"("transportRequestId", "revision");
CREATE INDEX "CrewAssignment_transportRequestId_assignedAt_idx" ON "CrewAssignment"("transportRequestId", "assignedAt");
CREATE INDEX "CrewAssignment_providerId_assignedAt_idx" ON "CrewAssignment"("providerId", "assignedAt");
CREATE INDEX "CrewAssignment_transportUnitId_assignedAt_idx" ON "CrewAssignment"("transportUnitId", "assignedAt");

ALTER TABLE "CrewAssignment"
  ADD CONSTRAINT "CrewAssignment_transportRequestId_fkey"
  FOREIGN KEY ("transportRequestId") REFERENCES "MedicalTransportRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "CrewAssignment_transportUnitId_fkey"
  FOREIGN KEY ("transportUnitId") REFERENCES "TransportUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "CrewAssignment_providerId_fkey"
  FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION carepoint_reject_crew_assignment_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'CrewAssignment is immutable; create a new revision instead';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "CrewAssignment_immutable_trigger"
BEFORE UPDATE OR DELETE ON "CrewAssignment"
FOR EACH ROW EXECUTE FUNCTION carepoint_reject_crew_assignment_mutation();

REVOKE UPDATE, DELETE ON "CrewAssignment" FROM PUBLIC;
