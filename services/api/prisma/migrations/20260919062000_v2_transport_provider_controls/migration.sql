-- CarePoint V2 / PRV-080, PRV-083.
-- Explicit transport equipment confirmation before departure.

ALTER TABLE "MedicalTransportRequest"
ADD COLUMN "equipmentChecklist" JSONB,
ADD COLUMN "equipmentConfirmedAt" TIMESTAMP(3),
ADD COLUMN "equipmentConfirmedByProviderId" TEXT;
