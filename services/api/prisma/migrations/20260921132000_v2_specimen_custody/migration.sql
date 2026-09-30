CREATE TABLE "Specimen" (
  "id" TEXT NOT NULL,
  "specimenIdentifier" TEXT NOT NULL,
  "barcode" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "collectedByProviderId" TEXT NOT NULL,
  "specimenTypeCode" TEXT NOT NULL,
  "conditionCode" TEXT NOT NULL,
  "collectionLocation" TEXT,
  "collectedAt" TIMESTAMP(3) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'COLLECTED',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Specimen_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Specimen_identifier_format_ck" CHECK ("specimenIdentifier" ~ '^SPC-[A-Z0-9-]{8,80}$'),
  CONSTRAINT "Specimen_barcode_length_ck" CHECK (char_length("barcode") BETWEEN 3 AND 120),
  CONSTRAINT "Specimen_type_format_ck" CHECK ("specimenTypeCode" ~ '^[A-Z][A-Z0-9_]{1,79}$'),
  CONSTRAINT "Specimen_condition_ck" CHECK ("conditionCode" IN ('ACCEPTABLE','COMPROMISED','REJECTED')),
  CONSTRAINT "Specimen_status_ck" CHECK ("status" IN ('COLLECTED','TRANSFERRED','RECEIVED','PROCESSING','STORED','DISPOSED','REJECTED'))
);

CREATE TABLE "SpecimenCustodyEvent" (
  "id" TEXT NOT NULL,
  "specimenId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "eventType" TEXT NOT NULL,
  "actorProviderId" TEXT NOT NULL,
  "receiverRef" TEXT,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "location" TEXT,
  "conditionCode" TEXT NOT NULL,
  "previousHash" TEXT,
  "eventHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SpecimenCustodyEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SpecimenCustodyEvent_sequence_ck" CHECK ("sequence" > 0),
  CONSTRAINT "SpecimenCustodyEvent_type_ck" CHECK ("eventType" IN ('COLLECTED','TRANSFERRED','RECEIVED','PROCESSING','STORED','DISPOSED')),
  CONSTRAINT "SpecimenCustodyEvent_condition_ck" CHECK ("conditionCode" IN ('ACCEPTABLE','COMPROMISED','REJECTED')),
  CONSTRAINT "SpecimenCustodyEvent_previous_hash_ck" CHECK ("previousHash" IS NULL OR "previousHash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "SpecimenCustodyEvent_event_hash_ck" CHECK ("eventHash" ~ '^[a-f0-9]{64}$')
);

CREATE UNIQUE INDEX "Specimen_specimenIdentifier_key" ON "Specimen"("specimenIdentifier");
CREATE UNIQUE INDEX "Specimen_barcode_key" ON "Specimen"("barcode");
CREATE INDEX "Specimen_orderId_collectedAt_idx" ON "Specimen"("orderId", "collectedAt");
CREATE INDEX "Specimen_patientId_collectedAt_idx" ON "Specimen"("patientId", "collectedAt");
CREATE INDEX "Specimen_collectedByProviderId_collectedAt_idx" ON "Specimen"("collectedByProviderId", "collectedAt");

CREATE UNIQUE INDEX "SpecimenCustodyEvent_specimenId_sequence_key" ON "SpecimenCustodyEvent"("specimenId", "sequence");
CREATE INDEX "SpecimenCustodyEvent_specimenId_occurredAt_idx" ON "SpecimenCustodyEvent"("specimenId", "occurredAt");
CREATE INDEX "SpecimenCustodyEvent_actorProviderId_occurredAt_idx" ON "SpecimenCustodyEvent"("actorProviderId", "occurredAt");

ALTER TABLE "Specimen"
  ADD CONSTRAINT "Specimen_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "ClinicalOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Specimen"
  ADD CONSTRAINT "Specimen_patientId_fkey"
  FOREIGN KEY ("patientId") REFERENCES "PatientProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Specimen"
  ADD CONSTRAINT "Specimen_collectedByProviderId_fkey"
  FOREIGN KEY ("collectedByProviderId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SpecimenCustodyEvent"
  ADD CONSTRAINT "SpecimenCustodyEvent_specimenId_fkey"
  FOREIGN KEY ("specimenId") REFERENCES "Specimen"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SpecimenCustodyEvent"
  ADD CONSTRAINT "SpecimenCustodyEvent_actorProviderId_fkey"
  FOREIGN KEY ("actorProviderId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "carepoint_block_specimen_custody_mutation"()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Specimen custody events are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "SpecimenCustodyEvent_append_only"
BEFORE UPDATE OR DELETE ON "SpecimenCustodyEvent"
FOR EACH ROW EXECUTE FUNCTION "carepoint_block_specimen_custody_mutation"();

REVOKE UPDATE, DELETE ON TABLE "SpecimenCustodyEvent" FROM PUBLIC;
