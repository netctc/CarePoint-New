CREATE TABLE "EmergencyCrewAssignment" (
  "id" TEXT NOT NULL,
  "emergencyRequestId" TEXT NOT NULL,
  "transportUnitId" TEXT,
  "providerId" TEXT NOT NULL,
  "crewProviderIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "revision" INTEGER NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "assignedByAccountId" TEXT NOT NULL,
  "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EmergencyCrewAssignment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmergencyCrewAssignment_idempotencyKey_key"
  ON "EmergencyCrewAssignment"("idempotencyKey");
CREATE UNIQUE INDEX "EmergencyCrewAssignment_emergencyRequestId_revision_key"
  ON "EmergencyCrewAssignment"("emergencyRequestId", "revision");
CREATE INDEX "EmergencyCrewAssignment_emergencyRequestId_assignedAt_idx"
  ON "EmergencyCrewAssignment"("emergencyRequestId", "assignedAt");
CREATE INDEX "EmergencyCrewAssignment_providerId_assignedAt_idx"
  ON "EmergencyCrewAssignment"("providerId", "assignedAt");
CREATE INDEX "EmergencyCrewAssignment_transportUnitId_assignedAt_idx"
  ON "EmergencyCrewAssignment"("transportUnitId", "assignedAt");
