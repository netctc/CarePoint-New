CREATE TABLE "EncounterAddendum" (
    "id" TEXT NOT NULL,
    "encounterId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EncounterAddendum_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "EncounterAddendum_sequence_check" CHECK ("sequence" > 0)
);

CREATE UNIQUE INDEX "EncounterAddendum_encounterId_sequence_key"
ON "EncounterAddendum"("encounterId", "sequence");
CREATE INDEX "EncounterAddendum_patientId_createdAt_idx"
ON "EncounterAddendum"("patientId", "createdAt");
CREATE INDEX "EncounterAddendum_providerId_createdAt_idx"
ON "EncounterAddendum"("providerId", "createdAt");

ALTER TABLE "EncounterAddendum" ADD CONSTRAINT "EncounterAddendum_encounterId_fkey"
FOREIGN KEY ("encounterId") REFERENCES "Appointment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EncounterAddendum" ADD CONSTRAINT "EncounterAddendum_patientId_fkey"
FOREIGN KEY ("patientId") REFERENCES "PatientProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EncounterAddendum" ADD CONSTRAINT "EncounterAddendum_providerId_fkey"
FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
