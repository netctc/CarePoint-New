-- CarePoint V2 / PRV-074
-- Home-visit route estimates intentionally do NOT persist the provider's origin
-- coordinates or route geometry. Only operational ETA/distance evidence is stored.

CREATE TABLE "FieldRouteEstimate" (
  "id" TEXT NOT NULL,
  "appointmentId" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "etaMinutes" INTEGER NOT NULL,
  "distanceMeters" INTEGER NOT NULL,
  "source" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "requestDigest" TEXT NOT NULL,
  "generatedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FieldRouteEstimate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FieldRouteEstimate_idempotencyKey_key"
  ON "FieldRouteEstimate"("idempotencyKey");
CREATE UNIQUE INDEX "FieldRouteEstimate_appointmentId_revision_key"
  ON "FieldRouteEstimate"("appointmentId", "revision");
CREATE INDEX "FieldRouteEstimate_providerId_generatedAt_idx"
  ON "FieldRouteEstimate"("providerId", "generatedAt");
CREATE INDEX "FieldRouteEstimate_patientId_generatedAt_idx"
  ON "FieldRouteEstimate"("patientId", "generatedAt");
CREATE INDEX "FieldRouteEstimate_appointmentId_generatedAt_idx"
  ON "FieldRouteEstimate"("appointmentId", "generatedAt");

ALTER TABLE "FieldRouteEstimate"
  ADD CONSTRAINT "FieldRouteEstimate_appointmentId_fkey"
    FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "FieldRouteEstimate_patientId_fkey"
    FOREIGN KEY ("patientId") REFERENCES "PatientProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "FieldRouteEstimate_providerId_fkey"
    FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "FieldRouteEstimate_revision_ck" CHECK ("revision" > 0),
  ADD CONSTRAINT "FieldRouteEstimate_eta_ck" CHECK ("etaMinutes" BETWEEN 1 AND 720),
  ADD CONSTRAINT "FieldRouteEstimate_distance_ck" CHECK ("distanceMeters" BETWEEN 0 AND 2000000),
  ADD CONSTRAINT "FieldRouteEstimate_source_ck" CHECK ("source" IN ('MAPBOX','DIRECT_DISTANCE_V1')),
  ADD CONSTRAINT "FieldRouteEstimate_digest_ck" CHECK ("requestDigest" ~ '^[0-9a-f]{64}$');

CREATE OR REPLACE FUNCTION carepoint_reject_field_route_estimate_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'FieldRouteEstimate is append-only and cannot be updated or deleted';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "FieldRouteEstimate_immutable_trigger"
BEFORE UPDATE OR DELETE ON "FieldRouteEstimate"
FOR EACH ROW EXECUTE FUNCTION carepoint_reject_field_route_estimate_mutation();

REVOKE UPDATE, DELETE ON "FieldRouteEstimate" FROM PUBLIC;
