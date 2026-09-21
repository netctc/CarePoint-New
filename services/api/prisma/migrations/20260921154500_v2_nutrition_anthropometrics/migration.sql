CREATE TABLE "AnthropometricMeasurement" (
  "id" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "requestDigest" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  "patientId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "appointmentId" TEXT NOT NULL,
  "observationId" TEXT NOT NULL,
  "metricCode" TEXT NOT NULL,
  "observedAt" TIMESTAMP(3) NOT NULL,
  "sourceType" TEXT NOT NULL DEFAULT 'PROVIDER',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AnthropometricMeasurement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AnthropometricMeasurement_idempotency_ck" CHECK (char_length("idempotencyKey") BETWEEN 1 AND 120),
  CONSTRAINT "AnthropometricMeasurement_digest_ck" CHECK ("requestDigest" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "AnthropometricMeasurement_position_ck" CHECK ("position" >= 0 AND "position" < 50),
  CONSTRAINT "AnthropometricMeasurement_metric_ck" CHECK ("metricCode" ~ '^[A-Z][A-Z0-9_]{2,79}$'),
  CONSTRAINT "AnthropometricMeasurement_source_ck" CHECK ("sourceType" = 'PROVIDER')
);

CREATE UNIQUE INDEX "AnthropometricMeasurement_observationId_key" ON "AnthropometricMeasurement"("observationId");
CREATE UNIQUE INDEX "AnthropometricMeasurement_idempotencyKey_position_key" ON "AnthropometricMeasurement"("idempotencyKey", "position");
CREATE INDEX "AnthropometricMeasurement_patientId_metricCode_observedAt_idx" ON "AnthropometricMeasurement"("patientId", "metricCode", "observedAt");
CREATE INDEX "AnthropometricMeasurement_providerId_patientId_observedAt_idx" ON "AnthropometricMeasurement"("providerId", "patientId", "observedAt");
CREATE INDEX "AnthropometricMeasurement_appointmentId_observedAt_idx" ON "AnthropometricMeasurement"("appointmentId", "observedAt");

ALTER TABLE "AnthropometricMeasurement" ADD CONSTRAINT "AnthropometricMeasurement_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "PatientProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AnthropometricMeasurement" ADD CONSTRAINT "AnthropometricMeasurement_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AnthropometricMeasurement" ADD CONSTRAINT "AnthropometricMeasurement_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AnthropometricMeasurement" ADD CONSTRAINT "AnthropometricMeasurement_observationId_fkey" FOREIGN KEY ("observationId") REFERENCES "Observation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION carepoint_reject_anthropometry_history_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Anthropometric measurement history is append-only';
END;
$$;

CREATE TRIGGER "AnthropometricMeasurement_append_only_trg"
BEFORE UPDATE OR DELETE ON "AnthropometricMeasurement"
FOR EACH ROW EXECUTE FUNCTION carepoint_reject_anthropometry_history_mutation();

REVOKE UPDATE, DELETE ON "AnthropometricMeasurement" FROM PUBLIC;
