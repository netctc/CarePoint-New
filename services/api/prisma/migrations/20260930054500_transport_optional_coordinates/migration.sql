-- Transport coordinates are optional presentation/dispatch metadata.
-- A usable location can be represented by address text, a complete coordinate pair, or both.

ALTER TABLE "MedicalTransportRequest"
  ALTER COLUMN "pickupLatitude" DROP NOT NULL,
  ALTER COLUMN "pickupLongitude" DROP NOT NULL,
  ALTER COLUMN "destinationLatitude" DROP NOT NULL,
  ALTER COLUMN "destinationLongitude" DROP NOT NULL;

ALTER TABLE "EmergencyAmbulanceRequest"
  ALTER COLUMN "latitude" DROP NOT NULL,
  ALTER COLUMN "longitude" DROP NOT NULL;
