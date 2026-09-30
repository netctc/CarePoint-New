-- CarePoint V2 A4 / BE-008..BE-010: observations, versioned metrics and unit conversion.

CREATE TABLE "MeasurementUnit" (
  "code" TEXT NOT NULL,
  "labels" JSONB NOT NULL,
  "dimension" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MeasurementUnit_pkey" PRIMARY KEY ("code")
);

CREATE TABLE "UnitConversion" (
  "id" TEXT NOT NULL,
  "dimension" TEXT NOT NULL,
  "fromUnitCode" TEXT NOT NULL,
  "toUnitCode" TEXT NOT NULL,
  "multiplier" DOUBLE PRECISION NOT NULL,
  "offset" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "version" INTEGER NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UnitConversion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ObservationType" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "labels" JSONB NOT NULL,
  "category" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ObservationType_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ObservationTypeVersion" (
  "id" TEXT NOT NULL,
  "observationTypeId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "canonicalUnitCode" TEXT NOT NULL,
  "allowedUnitCodes" JSONB NOT NULL,
  "minCanonical" DOUBLE PRECISION,
  "maxCanonical" DOUBLE PRECISION,
  "precision" INTEGER NOT NULL DEFAULT 2,
  "createdByActorId" TEXT,
  "activatedAt" TIMESTAMP(3),
  "retiredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ObservationTypeVersion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Observation" (
  "id" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "observationTypeId" TEXT NOT NULL,
  "observationTypeVersionId" TEXT NOT NULL,
  "observedAt" TIMESTAMP(3) NOT NULL,
  "sourceType" TEXT NOT NULL,
  "sourceId" TEXT,
  "algorithm" TEXT NOT NULL,
  "keyId" TEXT NOT NULL,
  "wrappedKey" TEXT NOT NULL,
  "iv" TEXT NOT NULL,
  "ciphertext" TEXT NOT NULL,
  "createdByActorId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Observation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MeasurementUnit_dimension_active_idx" ON "MeasurementUnit"("dimension", "active");
CREATE UNIQUE INDEX "UnitConversion_fromUnitCode_toUnitCode_version_key" ON "UnitConversion"("fromUnitCode", "toUnitCode", "version");
CREATE INDEX "UnitConversion_dimension_active_idx" ON "UnitConversion"("dimension", "active");
CREATE UNIQUE INDEX "ObservationType_code_key" ON "ObservationType"("code");
CREATE INDEX "ObservationType_category_active_idx" ON "ObservationType"("category", "active");
CREATE UNIQUE INDEX "ObservationTypeVersion_observationTypeId_version_key" ON "ObservationTypeVersion"("observationTypeId", "version");
CREATE INDEX "ObservationTypeVersion_status_activatedAt_idx" ON "ObservationTypeVersion"("status", "activatedAt");
CREATE INDEX "Observation_patientId_observationTypeId_observedAt_idx" ON "Observation"("patientId", "observationTypeId", "observedAt");
CREATE INDEX "Observation_observationTypeVersionId_observedAt_idx" ON "Observation"("observationTypeVersionId", "observedAt");

ALTER TABLE "UnitConversion"
ADD CONSTRAINT "UnitConversion_fromUnitCode_fkey"
FOREIGN KEY ("fromUnitCode") REFERENCES "MeasurementUnit"("code")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "UnitConversion"
ADD CONSTRAINT "UnitConversion_toUnitCode_fkey"
FOREIGN KEY ("toUnitCode") REFERENCES "MeasurementUnit"("code")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ObservationTypeVersion"
ADD CONSTRAINT "ObservationTypeVersion_observationTypeId_fkey"
FOREIGN KEY ("observationTypeId") REFERENCES "ObservationType"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Observation"
ADD CONSTRAINT "Observation_patientId_fkey"
FOREIGN KEY ("patientId") REFERENCES "PatientProfile"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Observation"
ADD CONSTRAINT "Observation_observationTypeId_fkey"
FOREIGN KEY ("observationTypeId") REFERENCES "ObservationType"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Observation"
ADD CONSTRAINT "Observation_observationTypeVersionId_fkey"
FOREIGN KEY ("observationTypeVersionId") REFERENCES "ObservationTypeVersion"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
