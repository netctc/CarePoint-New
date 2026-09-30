CREATE TYPE "TransportSavedLocationKind" AS ENUM ('HOME', 'WORK', 'HEALTHCARE', 'OTHER');

CREATE TABLE "TransportSavedLocation" (
  "id" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "kind" "TransportSavedLocationKind" NOT NULL DEFAULT 'OTHER',
  "address" TEXT,
  "latitude" DECIMAL(9,6),
  "longitude" DECIMAL(9,6),
  "placeId" TEXT,
  "source" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TransportSavedLocation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TransportSavedLocation_patientId_updatedAt_idx"
  ON "TransportSavedLocation"("patientId", "updatedAt");

CREATE INDEX "TransportSavedLocation_patientId_kind_idx"
  ON "TransportSavedLocation"("patientId", "kind");
