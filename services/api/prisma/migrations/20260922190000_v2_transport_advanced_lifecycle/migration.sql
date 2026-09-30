-- CarePoint V2 / BE-032 gap closure:
-- append-only equipment readiness checks and route/ETA revisions for assigned medical transport.

CREATE TABLE "TransportEquipmentCheck" (
  "id" TEXT NOT NULL,
  "transportRequestId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "crewAssignmentId" TEXT,
  "transportUnitId" TEXT,
  "revision" INTEGER NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "requestDigest" TEXT NOT NULL,
  "requiredEquipment" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "confirmedEquipment" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "missingEquipment" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "status" TEXT NOT NULL,
  "checkedByAccountId" TEXT NOT NULL,
  "checkedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TransportEquipmentCheck_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TransportEquipmentCheck_idempotencyKey_key" ON "TransportEquipmentCheck"("idempotencyKey");
CREATE UNIQUE INDEX "TransportEquipmentCheck_transportRequestId_revision_key" ON "TransportEquipmentCheck"("transportRequestId", "revision");
CREATE INDEX "TransportEquipmentCheck_transportRequestId_checkedAt_idx" ON "TransportEquipmentCheck"("transportRequestId", "checkedAt");
CREATE INDEX "TransportEquipmentCheck_providerId_checkedAt_idx" ON "TransportEquipmentCheck"("providerId", "checkedAt");
CREATE INDEX "TransportEquipmentCheck_transportUnitId_checkedAt_idx" ON "TransportEquipmentCheck"("transportUnitId", "checkedAt");

ALTER TABLE "TransportEquipmentCheck"
  ADD CONSTRAINT "TransportEquipmentCheck_transportRequestId_fkey"
    FOREIGN KEY ("transportRequestId") REFERENCES "MedicalTransportRequest"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "TransportEquipmentCheck_providerId_fkey"
    FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "TransportEquipmentCheck_crewAssignmentId_fkey"
    FOREIGN KEY ("crewAssignmentId") REFERENCES "CrewAssignment"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "TransportEquipmentCheck_transportUnitId_fkey"
    FOREIGN KEY ("transportUnitId") REFERENCES "TransportUnit"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "TransportEquipmentCheck_revision_check" CHECK ("revision" > 0),
  ADD CONSTRAINT "TransportEquipmentCheck_status_check" CHECK ("status" IN ('PASS', 'FAIL')),
  ADD CONSTRAINT "TransportEquipmentCheck_digest_check" CHECK ("requestDigest" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "TransportEquipmentCheck_equipment_vocab_check" CHECK (
    "requiredEquipment" <@ ARRAY['OXYGEN','MONITORING','VENTILATION','WHEELCHAIR','STRETCHER']::TEXT[]
    AND "confirmedEquipment" <@ ARRAY['OXYGEN','MONITORING','VENTILATION','WHEELCHAIR','STRETCHER']::TEXT[]
    AND "missingEquipment" <@ ARRAY['OXYGEN','MONITORING','VENTILATION','WHEELCHAIR','STRETCHER']::TEXT[]
  );

CREATE TABLE "TransportRouteRevision" (
  "id" TEXT NOT NULL,
  "transportRequestId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "requestDigest" TEXT NOT NULL,
  "lifecycleStatus" TEXT NOT NULL,
  "etaMinutes" INTEGER,
  "reasonCode" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "createdByAccountId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TransportRouteRevision_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TransportRouteRevision_idempotencyKey_key" ON "TransportRouteRevision"("idempotencyKey");
CREATE UNIQUE INDEX "TransportRouteRevision_transportRequestId_revision_key" ON "TransportRouteRevision"("transportRequestId", "revision");
CREATE INDEX "TransportRouteRevision_transportRequestId_createdAt_idx" ON "TransportRouteRevision"("transportRequestId", "createdAt");
CREATE INDEX "TransportRouteRevision_providerId_createdAt_idx" ON "TransportRouteRevision"("providerId", "createdAt");

ALTER TABLE "TransportRouteRevision"
  ADD CONSTRAINT "TransportRouteRevision_transportRequestId_fkey"
    FOREIGN KEY ("transportRequestId") REFERENCES "MedicalTransportRequest"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "TransportRouteRevision_providerId_fkey"
    FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "TransportRouteRevision_revision_check" CHECK ("revision" > 0),
  ADD CONSTRAINT "TransportRouteRevision_digest_check" CHECK ("requestDigest" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "TransportRouteRevision_eta_check" CHECK ("etaMinutes" IS NULL OR ("etaMinutes" >= 0 AND "etaMinutes" <= 1440)),
  ADD CONSTRAINT "TransportRouteRevision_status_check" CHECK ("lifecycleStatus" IN ('ASSIGNED','EN_ROUTE','ARRIVED','TRANSPORTING')),
  ADD CONSTRAINT "TransportRouteRevision_reason_check" CHECK ("reasonCode" IN ('TRAFFIC','DIVERSION','ROAD_CLOSURE','WEATHER','FACILITY_DELAY','OPERATIONAL_UPDATE')),
  ADD CONSTRAINT "TransportRouteRevision_source_check" CHECK ("source" IN ('PROVIDER_MANUAL','DISPATCH_UPDATE'));

CREATE OR REPLACE FUNCTION carepoint_reject_transport_advanced_lifecycle_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only and cannot be updated or deleted', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "TransportEquipmentCheck_immutable_trigger"
BEFORE UPDATE OR DELETE ON "TransportEquipmentCheck"
FOR EACH ROW EXECUTE FUNCTION carepoint_reject_transport_advanced_lifecycle_mutation();

CREATE TRIGGER "TransportRouteRevision_immutable_trigger"
BEFORE UPDATE OR DELETE ON "TransportRouteRevision"
FOR EACH ROW EXECUTE FUNCTION carepoint_reject_transport_advanced_lifecycle_mutation();

REVOKE UPDATE, DELETE ON "TransportEquipmentCheck" FROM PUBLIC;
REVOKE UPDATE, DELETE ON "TransportRouteRevision" FROM PUBLIC;
