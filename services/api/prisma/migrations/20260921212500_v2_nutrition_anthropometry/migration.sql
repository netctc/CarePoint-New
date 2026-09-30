CREATE TABLE "AnthropometricMeasurement" (
  "id" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "requestDigest" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "appointmentId" TEXT NOT NULL,
  "measurementCode" TEXT NOT NULL,
  "sourceValue" DOUBLE PRECISION NOT NULL,
  "sourceUnit" TEXT NOT NULL,
  "normalizedValue" DOUBLE PRECISION NOT NULL,
  "normalizedUnit" TEXT NOT NULL,
  "measuredAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AnthropometricMeasurement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AnthropometricMeasurement_code_ck" CHECK ("measurementCode" ~ '^[A-Z][A-Z0-9_]{1,79}$'),
  CONSTRAINT "AnthropometricMeasurement_value_ck" CHECK ("sourceValue" > 0 AND "sourceValue" <= 1000000 AND "normalizedValue" > 0 AND "normalizedValue" <= 1000000),
  CONSTRAINT "AnthropometricMeasurement_source_unit_ck" CHECK (char_length("sourceUnit") BETWEEN 1 AND 24),
  CONSTRAINT "AnthropometricMeasurement_normalized_unit_ck" CHECK ("normalizedUnit" IN ('kg','cm','%','kg/m2','1'))
);

CREATE UNIQUE INDEX "AnthropometricMeasurement_idempotencyKey_key" ON "AnthropometricMeasurement"("idempotencyKey");
CREATE INDEX "AnthropometricMeasurement_patientId_measurementCode_measuredAt_idx" ON "AnthropometricMeasurement"("patientId", "measurementCode", "measuredAt");
CREATE INDEX "AnthropometricMeasurement_providerId_patientId_measuredAt_idx" ON "AnthropometricMeasurement"("providerId", "patientId", "measuredAt");
CREATE INDEX "AnthropometricMeasurement_appointmentId_idx" ON "AnthropometricMeasurement"("appointmentId");

ALTER TABLE "AnthropometricMeasurement" ADD CONSTRAINT "AnthropometricMeasurement_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "PatientProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AnthropometricMeasurement" ADD CONSTRAINT "AnthropometricMeasurement_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AnthropometricMeasurement" ADD CONSTRAINT "AnthropometricMeasurement_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION carepoint_reject_anthropometry_history_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Nutrition anthropometry history is append-only';
END;
$$;

CREATE TRIGGER "AnthropometricMeasurement_append_only_trg"
BEFORE UPDATE OR DELETE ON "AnthropometricMeasurement"
FOR EACH ROW EXECUTE FUNCTION carepoint_reject_anthropometry_history_mutation();

REVOKE UPDATE, DELETE ON "AnthropometricMeasurement" FROM PUBLIC;
