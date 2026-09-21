CREATE TABLE "PhysioAssessment" (
  "id" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "appointmentId" TEXT NOT NULL,
  "sourceFormResponseId" TEXT NOT NULL,
  "sourceFormId" TEXT NOT NULL,
  "sourceFormVersion" INTEGER NOT NULL,
  "sourceResponseSequence" INTEGER NOT NULL,
  "scaleCode" TEXT NOT NULL,
  "score" DOUBLE PRECISION NOT NULL,
  "scoreMaximum" DOUBLE PRECISION,
  "painScore" INTEGER,
  "limitationCodes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "sequence" INTEGER NOT NULL,
  "assessedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PhysioAssessment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PhysioAssessment_scale_ck" CHECK ("scaleCode" ~ '^[A-Z][A-Z0-9_]{2,79}$'),
  CONSTRAINT "PhysioAssessment_score_ck" CHECK ("score" BETWEEN -10000 AND 10000 AND ("scoreMaximum" IS NULL OR "scoreMaximum" > 0 AND "scoreMaximum" <= 10000)),
  CONSTRAINT "PhysioAssessment_pain_ck" CHECK ("painScore" IS NULL OR "painScore" BETWEEN 0 AND 10),
  CONSTRAINT "PhysioAssessment_sequence_ck" CHECK ("sequence" > 0),
  CONSTRAINT "PhysioAssessment_source_version_ck" CHECK ("sourceFormVersion" > 0 AND "sourceResponseSequence" > 0)
);

CREATE UNIQUE INDEX "PhysioAssessment_sourceFormResponseId_key" ON "PhysioAssessment"("sourceFormResponseId");
CREATE UNIQUE INDEX "PhysioAssessment_patientId_providerId_scaleCode_sequence_key" ON "PhysioAssessment"("patientId", "providerId", "scaleCode", "sequence");
CREATE INDEX "PhysioAssessment_patientId_scaleCode_assessedAt_idx" ON "PhysioAssessment"("patientId", "scaleCode", "assessedAt");
CREATE INDEX "PhysioAssessment_providerId_patientId_assessedAt_idx" ON "PhysioAssessment"("providerId", "patientId", "assessedAt");
CREATE INDEX "PhysioAssessment_appointmentId_idx" ON "PhysioAssessment"("appointmentId");

CREATE TABLE "RangeOfMotionObservation" (
  "id" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "appointmentId" TEXT NOT NULL,
  "jointCode" TEXT NOT NULL,
  "movementCode" TEXT NOT NULL,
  "side" TEXT NOT NULL,
  "degrees" DOUBLE PRECISION NOT NULL,
  "measuredAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RangeOfMotionObservation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RangeOfMotionObservation_joint_ck" CHECK ("jointCode" ~ '^[A-Z][A-Z0-9_]{1,79}$'),
  CONSTRAINT "RangeOfMotionObservation_movement_ck" CHECK ("movementCode" ~ '^[A-Z][A-Z0-9_]{1,79}$'),
  CONSTRAINT "RangeOfMotionObservation_side_ck" CHECK ("side" IN ('LEFT','RIGHT','BILATERAL','MIDLINE')),
  CONSTRAINT "RangeOfMotionObservation_degrees_ck" CHECK ("degrees" BETWEEN -360 AND 360)
);

CREATE UNIQUE INDEX "RangeOfMotionObservation_idempotencyKey_key" ON "RangeOfMotionObservation"("idempotencyKey");
CREATE INDEX "RangeOfMotionObservation_patientId_jointCode_movementCode_side_measuredAt_idx" ON "RangeOfMotionObservation"("patientId", "jointCode", "movementCode", "side", "measuredAt");
CREATE INDEX "RangeOfMotionObservation_providerId_patientId_measuredAt_idx" ON "RangeOfMotionObservation"("providerId", "patientId", "measuredAt");
CREATE INDEX "RangeOfMotionObservation_appointmentId_idx" ON "RangeOfMotionObservation"("appointmentId");

ALTER TABLE "PhysioAssessment" ADD CONSTRAINT "PhysioAssessment_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "PatientProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PhysioAssessment" ADD CONSTRAINT "PhysioAssessment_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PhysioAssessment" ADD CONSTRAINT "PhysioAssessment_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PhysioAssessment" ADD CONSTRAINT "PhysioAssessment_sourceFormResponseId_fkey" FOREIGN KEY ("sourceFormResponseId") REFERENCES "ProviderCategoryFormResponse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PhysioAssessment" ADD CONSTRAINT "PhysioAssessment_sourceFormId_fkey" FOREIGN KEY ("sourceFormId") REFERENCES "ProviderCategoryForm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "RangeOfMotionObservation" ADD CONSTRAINT "RangeOfMotionObservation_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "PatientProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RangeOfMotionObservation" ADD CONSTRAINT "RangeOfMotionObservation_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RangeOfMotionObservation" ADD CONSTRAINT "RangeOfMotionObservation_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION carepoint_reject_physio_history_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Physiotherapy clinical history is append-only';
END;
$$;

CREATE TRIGGER "PhysioAssessment_append_only_trg"
BEFORE UPDATE OR DELETE ON "PhysioAssessment"
FOR EACH ROW EXECUTE FUNCTION carepoint_reject_physio_history_mutation();

CREATE TRIGGER "RangeOfMotionObservation_append_only_trg"
BEFORE UPDATE OR DELETE ON "RangeOfMotionObservation"
FOR EACH ROW EXECUTE FUNCTION carepoint_reject_physio_history_mutation();

REVOKE UPDATE, DELETE ON "PhysioAssessment" FROM PUBLIC;
REVOKE UPDATE, DELETE ON "RangeOfMotionObservation" FROM PUBLIC;
