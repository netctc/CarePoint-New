CREATE TYPE "ClinicalOrderType" AS ENUM ('PRESCRIPTION', 'LABORATORY');
CREATE TYPE "ClinicalOrderStatus" AS ENUM ('SIGNED', 'CANCELLED', 'FULFILLED');
CREATE TYPE "LaboratoryResultStatus" AS ENUM ('ENTERED', 'VALIDATED', 'RELEASED');

CREATE TABLE "ClinicalOrder" (
  "id" TEXT NOT NULL,
  "idempotencyKey" TEXT,
  "type" "ClinicalOrderType" NOT NULL,
  "status" "ClinicalOrderStatus" NOT NULL DEFAULT 'SIGNED',
  "patientId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "encounterRef" TEXT NOT NULL,
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
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ClinicalOrder_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LaboratoryResult" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "status" "LaboratoryResultStatus" NOT NULL DEFAULT 'ENTERED',
  "enteredByProviderId" TEXT NOT NULL,
  "algorithm" TEXT NOT NULL,
  "keyId" TEXT NOT NULL,
  "wrappedKey" TEXT NOT NULL,
  "iv" TEXT NOT NULL,
  "ciphertext" TEXT NOT NULL,
  "payloadDigest" TEXT NOT NULL,
  "validationDigest" TEXT,
  "validationAlgorithm" TEXT,
  "validationKeyId" TEXT,
  "validationSignature" TEXT,
  "validatedByProviderId" TEXT,
  "validatedAt" TIMESTAMP(3),
  "releasedByProviderId" TEXT,
  "releasedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LaboratoryResult_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ClinicalOrder_idempotencyKey_key" ON "ClinicalOrder"("idempotencyKey");
CREATE INDEX "ClinicalOrder_patientId_createdAt_idx" ON "ClinicalOrder"("patientId", "createdAt");
CREATE INDEX "ClinicalOrder_providerId_createdAt_idx" ON "ClinicalOrder"("providerId", "createdAt");
CREATE INDEX "ClinicalOrder_encounterRef_type_status_idx" ON "ClinicalOrder"("encounterRef", "type", "status");
CREATE UNIQUE INDEX "LaboratoryResult_orderId_key" ON "LaboratoryResult"("orderId");
CREATE INDEX "LaboratoryResult_status_createdAt_idx" ON "LaboratoryResult"("status", "createdAt");
CREATE INDEX "LaboratoryResult_enteredByProviderId_createdAt_idx" ON "LaboratoryResult"("enteredByProviderId", "createdAt");

ALTER TABLE "ClinicalOrder" ADD CONSTRAINT "ClinicalOrder_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "PatientProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClinicalOrder" ADD CONSTRAINT "ClinicalOrder_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClinicalOrder" ADD CONSTRAINT "ClinicalOrder_encounterRef_fkey" FOREIGN KEY ("encounterRef") REFERENCES "Appointment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LaboratoryResult" ADD CONSTRAINT "LaboratoryResult_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ClinicalOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LaboratoryResult" ADD CONSTRAINT "LaboratoryResult_enteredByProviderId_fkey" FOREIGN KEY ("enteredByProviderId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LaboratoryResult" ADD CONSTRAINT "LaboratoryResult_validatedByProviderId_fkey" FOREIGN KEY ("validatedByProviderId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LaboratoryResult" ADD CONSTRAINT "LaboratoryResult_releasedByProviderId_fkey" FOREIGN KEY ("releasedByProviderId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
