CREATE TABLE "ImagingOrder" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "appointmentId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ORDERED',
    "version" INTEGER NOT NULL DEFAULT 1,
    "algorithm" TEXT NOT NULL,
    "keyId" TEXT NOT NULL,
    "wrappedKey" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "payloadDigest" TEXT NOT NULL,
    "signatureAlgorithm" TEXT NOT NULL,
    "signatureKeyId" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "signedAt" TIMESTAMP(3) NOT NULL,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImagingOrder_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ImagingOrder_status_check" CHECK ("status" IN ('ORDERED', 'CANCELLED'))
);

CREATE UNIQUE INDEX "ImagingOrder_idempotencyKey_key"
ON "ImagingOrder"("idempotencyKey");

CREATE INDEX "ImagingOrder_patientId_createdAt_idx"
ON "ImagingOrder"("patientId", "createdAt");

CREATE INDEX "ImagingOrder_providerId_status_createdAt_idx"
ON "ImagingOrder"("providerId", "status", "createdAt");

CREATE INDEX "ImagingOrder_appointmentId_idx"
ON "ImagingOrder"("appointmentId");

ALTER TABLE "ImagingOrder"
ADD CONSTRAINT "ImagingOrder_patientId_fkey"
FOREIGN KEY ("patientId") REFERENCES "PatientProfile"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ImagingOrder"
ADD CONSTRAINT "ImagingOrder_providerId_fkey"
FOREIGN KEY ("providerId") REFERENCES "Provider"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ImagingOrder"
ADD CONSTRAINT "ImagingOrder_appointmentId_fkey"
FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
