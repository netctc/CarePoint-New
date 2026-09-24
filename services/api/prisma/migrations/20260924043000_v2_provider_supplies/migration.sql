-- CarePoint V2 PRV-092 — operational supply catalog and append-only job usage.
-- No clinical notes, diagnosis, symptoms, or patient-entered free text are stored here.

CREATE TABLE "SupplyItem" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "labels" JSONB NOT NULL,
  "unitCode" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SupplyItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SupplyItem_code_ck" CHECK ("code" ~ '^[A-Z][A-Z0-9_:-]{1,63}$'),
  CONSTRAINT "SupplyItem_unit_ck" CHECK ("unitCode" ~ '^[A-Za-z][A-Za-z0-9_.%/-]{0,31}$')
);

CREATE TABLE "SupplyUsage" (
  "id" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "sourceType" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "supplyItemId" TEXT NOT NULL,
  "quantity" DECIMAL(12,3) NOT NULL,
  "unitCode" TEXT NOT NULL,
  "actorAccountId" TEXT NOT NULL,
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupplyUsage_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SupplyUsage_source_ck" CHECK ("sourceType" IN ('HOME_VISIT','MEDICAL_TRANSPORT')),
  CONSTRAINT "SupplyUsage_quantity_ck" CHECK ("quantity" > 0 AND "quantity" <= 1000000)
);

CREATE UNIQUE INDEX "SupplyItem_code_key" ON "SupplyItem"("code");
CREATE INDEX "SupplyItem_active_code_idx" ON "SupplyItem"("active","code");
CREATE UNIQUE INDEX "SupplyUsage_idempotencyKey_key" ON "SupplyUsage"("idempotencyKey");
CREATE INDEX "SupplyUsage_sourceType_sourceId_recordedAt_idx" ON "SupplyUsage"("sourceType","sourceId","recordedAt");
CREATE INDEX "SupplyUsage_providerId_recordedAt_idx" ON "SupplyUsage"("providerId","recordedAt");
CREATE INDEX "SupplyUsage_supplyItemId_recordedAt_idx" ON "SupplyUsage"("supplyItemId","recordedAt");

ALTER TABLE "SupplyUsage"
ADD CONSTRAINT "SupplyUsage_supplyItemId_fkey"
FOREIGN KEY ("supplyItemId") REFERENCES "SupplyItem"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SupplyUsage"
ADD CONSTRAINT "SupplyUsage_providerId_fkey"
FOREIGN KEY ("providerId") REFERENCES "Provider"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SupplyUsage"
ADD CONSTRAINT "SupplyUsage_patientId_fkey"
FOREIGN KEY ("patientId") REFERENCES "PatientProfile"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "carepoint_block_supply_usage_mutation"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'SupplyUsage is append-only';
END $$;

CREATE TRIGGER "SupplyUsage_immutable_trigger"
BEFORE UPDATE OR DELETE ON "SupplyUsage"
FOR EACH ROW EXECUTE FUNCTION "carepoint_block_supply_usage_mutation"();

REVOKE UPDATE, DELETE ON "SupplyUsage" FROM PUBLIC;
