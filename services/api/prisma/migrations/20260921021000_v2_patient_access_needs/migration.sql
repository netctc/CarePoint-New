-- CarePoint V2 / PAT-097:
-- patient-declared accessibility/support needs with immutable operational snapshots.

CREATE TABLE "PatientAccessNeed" (
  "id" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "needs" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "note" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "updatedByActorId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PatientAccessNeed_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PatientAccessNeed_patientId_key" ON "PatientAccessNeed"("patientId");
CREATE INDEX "PatientAccessNeed_patientId_updatedAt_idx" ON "PatientAccessNeed"("patientId", "updatedAt");

ALTER TABLE "PatientAccessNeed"
  ADD CONSTRAINT "PatientAccessNeed_patientId_fkey"
  FOREIGN KEY ("patientId") REFERENCES "PatientProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PatientAccessNeed"
  ADD CONSTRAINT "PatientAccessNeed_needs_array_check"
  CHECK (jsonb_typeof("needs") = 'array' AND jsonb_array_length("needs") <= 16),
  ADD CONSTRAINT "PatientAccessNeed_note_length_check"
  CHECK ("note" IS NULL OR char_length("note") <= 500),
  ADD CONSTRAINT "PatientAccessNeed_version_check"
  CHECK ("version" >= 1);

CREATE TABLE "OperationalAccessNeedSnapshot" (
  "id" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "contextType" TEXT NOT NULL,
  "contextId" TEXT NOT NULL,
  "needs" JSONB NOT NULL,
  "note" TEXT,
  "sourceVersion" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OperationalAccessNeedSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OperationalAccessNeedSnapshot_contextType_contextId_key"
  ON "OperationalAccessNeedSnapshot"("contextType", "contextId");
CREATE INDEX "OperationalAccessNeedSnapshot_patientId_createdAt_idx"
  ON "OperationalAccessNeedSnapshot"("patientId", "createdAt");

ALTER TABLE "OperationalAccessNeedSnapshot"
  ADD CONSTRAINT "OperationalAccessNeedSnapshot_patientId_fkey"
  FOREIGN KEY ("patientId") REFERENCES "PatientProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OperationalAccessNeedSnapshot"
  ADD CONSTRAINT "OperationalAccessNeedSnapshot_context_type_check"
  CHECK ("contextType" IN ('APPOINTMENT', 'MEDICAL_TRANSPORT')),
  ADD CONSTRAINT "OperationalAccessNeedSnapshot_needs_array_check"
  CHECK (jsonb_typeof("needs") = 'array' AND jsonb_array_length("needs") <= 16),
  ADD CONSTRAINT "OperationalAccessNeedSnapshot_note_length_check"
  CHECK ("note" IS NULL OR char_length("note") <= 500),
  ADD CONSTRAINT "OperationalAccessNeedSnapshot_version_check"
  CHECK ("sourceVersion" >= 1);

CREATE OR REPLACE FUNCTION carepoint_snapshot_appointment_access_needs()
RETURNS trigger AS $$
BEGIN
  INSERT INTO "OperationalAccessNeedSnapshot" (
    "id", "patientId", "contextType", "contextId", "needs", "note", "sourceVersion", "createdAt"
  )
  SELECT
    'appointment:' || NEW."id",
    NEW."patientId",
    'APPOINTMENT',
    NEW."id",
    access."needs",
    access."note",
    access."version",
    CURRENT_TIMESTAMP
  FROM "PatientAccessNeed" access
  WHERE access."patientId" = NEW."patientId"
    AND (jsonb_array_length(access."needs") > 0 OR access."note" IS NOT NULL)
  ON CONFLICT ("contextType", "contextId") DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Appointment_snapshot_access_needs_trigger"
AFTER INSERT ON "Appointment"
FOR EACH ROW EXECUTE FUNCTION carepoint_snapshot_appointment_access_needs();

CREATE OR REPLACE FUNCTION carepoint_apply_transport_access_needs()
RETURNS trigger AS $$
BEGIN
  IF NEW."assistance" = 'STANDARD'::"MedicalTransportAssistance"
     AND EXISTS (
       SELECT 1
       FROM "PatientAccessNeed" access,
            jsonb_array_elements_text(access."needs") AS need(value)
       WHERE access."patientId" = NEW."patientId"
         AND need.value IN ('WHEELCHAIR', 'ACCESSIBLE_TRANSPORT')
     )
  THEN
    NEW."assistance" := 'WHEELCHAIR'::"MedicalTransportAssistance";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "MedicalTransportRequest_apply_access_needs_trigger"
BEFORE INSERT ON "MedicalTransportRequest"
FOR EACH ROW EXECUTE FUNCTION carepoint_apply_transport_access_needs();

CREATE OR REPLACE FUNCTION carepoint_snapshot_transport_access_needs()
RETURNS trigger AS $$
BEGIN
  INSERT INTO "OperationalAccessNeedSnapshot" (
    "id", "patientId", "contextType", "contextId", "needs", "note", "sourceVersion", "createdAt"
  )
  SELECT
    'transport:' || NEW."id",
    NEW."patientId",
    'MEDICAL_TRANSPORT',
    NEW."id",
    access."needs",
    access."note",
    access."version",
    CURRENT_TIMESTAMP
  FROM "PatientAccessNeed" access
  WHERE access."patientId" = NEW."patientId"
    AND (jsonb_array_length(access."needs") > 0 OR access."note" IS NOT NULL)
  ON CONFLICT ("contextType", "contextId") DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "MedicalTransportRequest_snapshot_access_needs_trigger"
AFTER INSERT ON "MedicalTransportRequest"
FOR EACH ROW EXECUTE FUNCTION carepoint_snapshot_transport_access_needs();
