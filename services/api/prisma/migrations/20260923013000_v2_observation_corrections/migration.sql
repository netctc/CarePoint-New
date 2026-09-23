-- CarePoint V2 PAT-121 — audited corrections for patient-entered MANUAL observations.
-- The original Observation row and encrypted payload remain immutable.

CREATE TABLE "ObservationCorrectionRevision" (
  "id" TEXT NOT NULL,
  "observationId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "algorithm" TEXT NOT NULL,
  "keyId" TEXT NOT NULL,
  "wrappedKey" TEXT NOT NULL,
  "iv" TEXT NOT NULL,
  "ciphertext" TEXT NOT NULL,
  "createdByActorId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ObservationCorrectionRevision_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ObservationCorrectionRevision_sequence_check" CHECK ("sequence" > 0)
);

CREATE UNIQUE INDEX "ObservationCorrectionRevision_observationId_sequence_key"
ON "ObservationCorrectionRevision"("observationId", "sequence");

CREATE INDEX "ObservationCorrectionRevision_observationId_createdAt_idx"
ON "ObservationCorrectionRevision"("observationId", "createdAt");

ALTER TABLE "ObservationCorrectionRevision"
ADD CONSTRAINT "ObservationCorrectionRevision_observationId_fkey"
FOREIGN KEY ("observationId") REFERENCES "Observation"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION carepoint_reject_observation_correction_revision_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'observation correction revisions are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ObservationCorrectionRevision_append_only"
BEFORE UPDATE OR DELETE ON "ObservationCorrectionRevision"
FOR EACH ROW EXECUTE FUNCTION carepoint_reject_observation_correction_revision_mutation();

REVOKE UPDATE, DELETE ON "ObservationCorrectionRevision" FROM PUBLIC;
