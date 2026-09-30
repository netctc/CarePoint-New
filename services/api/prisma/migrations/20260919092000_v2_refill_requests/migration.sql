CREATE TABLE "RefillRequest" (
    "id" TEXT NOT NULL,
    "sourcePrescriptionId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "requestedProviderId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "version" INTEGER NOT NULL DEFAULT 1,
    "requestAlgorithm" TEXT NOT NULL,
    "requestKeyId" TEXT NOT NULL,
    "requestWrappedKey" TEXT NOT NULL,
    "requestIv" TEXT NOT NULL,
    "requestCiphertext" TEXT NOT NULL,
    "reviewAlgorithm" TEXT,
    "reviewKeyId" TEXT,
    "reviewWrappedKey" TEXT,
    "reviewIv" TEXT,
    "reviewCiphertext" TEXT,
    "reviewedByActorId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "approvedPrescriptionId" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RefillRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RefillRequest_patientId_status_requestedAt_idx"
ON "RefillRequest"("patientId", "status", "requestedAt");

CREATE INDEX "RefillRequest_requestedProviderId_status_requestedAt_idx"
ON "RefillRequest"("requestedProviderId", "status", "requestedAt");

CREATE INDEX "RefillRequest_sourcePrescriptionId_status_idx"
ON "RefillRequest"("sourcePrescriptionId", "status");

CREATE UNIQUE INDEX "RefillRequest_approvedPrescriptionId_key"
ON "RefillRequest"("approvedPrescriptionId");

CREATE UNIQUE INDEX "RefillRequest_one_open_per_source_key"
ON "RefillRequest"("sourcePrescriptionId")
WHERE "status" = 'REQUESTED';

ALTER TABLE "RefillRequest"
ADD CONSTRAINT "RefillRequest_sourcePrescriptionId_fkey"
FOREIGN KEY ("sourcePrescriptionId") REFERENCES "ClinicalOrder"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "RefillRequest"
ADD CONSTRAINT "RefillRequest_patientId_fkey"
FOREIGN KEY ("patientId") REFERENCES "PatientProfile"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "RefillRequest"
ADD CONSTRAINT "RefillRequest_requestedProviderId_fkey"
FOREIGN KEY ("requestedProviderId") REFERENCES "Provider"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "RefillRequest"
ADD CONSTRAINT "RefillRequest_approvedPrescriptionId_fkey"
FOREIGN KEY ("approvedPrescriptionId") REFERENCES "ClinicalOrder"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
