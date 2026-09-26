CREATE TABLE "ReferralOutcome" (
    "id" TEXT NOT NULL,
    "referralId" TEXT NOT NULL,
    "algorithm" TEXT NOT NULL,
    "keyId" TEXT NOT NULL,
    "wrappedKey" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "createdByActorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferralOutcome_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReferralOutcome_referralId_key"
ON "ReferralOutcome"("referralId");

CREATE INDEX "ReferralOutcome_createdAt_idx"
ON "ReferralOutcome"("createdAt");

ALTER TABLE "ReferralOutcome"
ADD CONSTRAINT "ReferralOutcome_referralId_fkey"
FOREIGN KEY ("referralId") REFERENCES "Referral"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
