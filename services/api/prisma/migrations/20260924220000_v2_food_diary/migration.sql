-- CarePoint V2 PRV-071 — patient food diary + append-only professional comments.
-- Narrative content is envelope-encrypted. Sharing metadata remains explicit and versioned.

CREATE TABLE "FoodDiaryEntry" (
  "id" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "mealAt" TIMESTAMP(3) NOT NULL,
  "mealType" TEXT NOT NULL,
  "shared" BOOLEAN NOT NULL DEFAULT false,
  "version" INTEGER NOT NULL DEFAULT 1,
  "algorithm" TEXT NOT NULL,
  "keyId" TEXT NOT NULL,
  "wrappedKey" TEXT NOT NULL,
  "iv" TEXT NOT NULL,
  "ciphertext" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FoodDiaryEntry_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FoodDiaryEntry_mealType_check" CHECK ("mealType" IN ('BREAKFAST','LUNCH','DINNER','SNACK','OTHER')),
  CONSTRAINT "FoodDiaryEntry_version_check" CHECK ("version" > 0)
);

CREATE TABLE "FoodDiaryProfessionalComment" (
  "id" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "entryId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "appointmentId" TEXT NOT NULL,
  "algorithm" TEXT NOT NULL,
  "keyId" TEXT NOT NULL,
  "wrappedKey" TEXT NOT NULL,
  "iv" TEXT NOT NULL,
  "ciphertext" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FoodDiaryProfessionalComment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FoodDiaryEntry_idempotencyKey_key" ON "FoodDiaryEntry"("idempotencyKey");
CREATE INDEX "FoodDiaryEntry_patientId_mealAt_idx" ON "FoodDiaryEntry"("patientId","mealAt");
CREATE INDEX "FoodDiaryEntry_patientId_shared_mealAt_idx" ON "FoodDiaryEntry"("patientId","shared","mealAt");

CREATE UNIQUE INDEX "FoodDiaryProfessionalComment_idempotencyKey_key"
ON "FoodDiaryProfessionalComment"("idempotencyKey");
CREATE INDEX "FoodDiaryProfessionalComment_entryId_createdAt_idx"
ON "FoodDiaryProfessionalComment"("entryId","createdAt");
CREATE INDEX "FoodDiaryProfessionalComment_providerId_createdAt_idx"
ON "FoodDiaryProfessionalComment"("providerId","createdAt");

ALTER TABLE "FoodDiaryEntry"
ADD CONSTRAINT "FoodDiaryEntry_patientId_fkey"
FOREIGN KEY ("patientId") REFERENCES "PatientProfile"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FoodDiaryProfessionalComment"
ADD CONSTRAINT "FoodDiaryProfessionalComment_entryId_fkey"
FOREIGN KEY ("entryId") REFERENCES "FoodDiaryEntry"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FoodDiaryProfessionalComment"
ADD CONSTRAINT "FoodDiaryProfessionalComment_providerId_fkey"
FOREIGN KEY ("providerId") REFERENCES "Provider"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FoodDiaryProfessionalComment"
ADD CONSTRAINT "FoodDiaryProfessionalComment_appointmentId_fkey"
FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
