ALTER TABLE "User"
  ADD COLUMN "registrationReference" TEXT;

CREATE TABLE "RegistrationOtpChallenge" (
  "id" TEXT NOT NULL,
  "kind" "UserRole" NOT NULL,
  "firstName" TEXT NOT NULL,
  "lastName" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "codeHash" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 3,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "verifiedAt" TIMESTAMP(3),
  "consumedAt" TIMESTAMP(3),
  "completionTokenHash" TEXT,
  "deliveryMode" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "RegistrationOtpChallenge_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RegistrationOtpChallenge_phone_expiresAt_idx"
  ON "RegistrationOtpChallenge"("phone", "expiresAt");

CREATE INDEX "RegistrationOtpChallenge_expiresAt_verifiedAt_consumedAt_idx"
  ON "RegistrationOtpChallenge"("expiresAt", "verifiedAt", "consumedAt");
