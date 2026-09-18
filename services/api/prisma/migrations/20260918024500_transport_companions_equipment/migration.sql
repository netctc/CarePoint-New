-- Release 1 completion: FR-TRN-001 companion/equipment capture for scheduled medical transport.
-- Additive migration; existing requests keep zero companions and no requested equipment.

CREATE TYPE "MedicalTransportEquipment" AS ENUM ('OXYGEN', 'MONITORING', 'VENTILATION');

ALTER TABLE "MedicalTransportRequest"
  ADD COLUMN "companionCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "equipment" "MedicalTransportEquipment"[] NOT NULL DEFAULT ARRAY[]::"MedicalTransportEquipment"[];

ALTER TABLE "MedicalTransportRequest"
  ADD CONSTRAINT "MedicalTransportRequest_companionCount_check"
  CHECK ("companionCount" >= 0 AND "companionCount" <= 8);
