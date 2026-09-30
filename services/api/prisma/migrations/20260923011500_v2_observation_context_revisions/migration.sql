CREATE TABLE "ObservationContextRevision" (
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
  CONSTRAINT "ObservationContextRevision_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ObservationContextRevision_sequence_check" CHECK ("sequence" > 0)
);

CREATE UNIQUE INDEX "ObservationContextRevision_observationId_sequence_key"
ON "ObservationContextRevision"("observationId", "sequence");

CREATE INDEX "ObservationContextRevision_observationId_createdAt_idx"
ON "ObservationContextRevision"("observationId", "createdAt");

ALTER TABLE "ObservationContextRevision"
ADD CONSTRAINT "ObservationContextRevision_observationId_fkey"
FOREIGN KEY ("observationId") REFERENCES "Observation"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION carepoint_reject_observation_context_revision_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'observation context revisions are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ObservationContextRevision_append_only"
BEFORE UPDATE OR DELETE ON "ObservationContextRevision"
FOR EACH ROW EXECUTE FUNCTION carepoint_reject_observation_context_revision_mutation();

REVOKE UPDATE, DELETE ON "ObservationContextRevision" FROM PUBLIC;
