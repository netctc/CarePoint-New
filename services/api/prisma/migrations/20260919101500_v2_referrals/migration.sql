CREATE TABLE "Referral" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "referringProviderId" TEXT NOT NULL,
    "destinationProviderId" TEXT NOT NULL,
    "specialtyCode" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'ROUTINE',
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "version" INTEGER NOT NULL DEFAULT 1,
    "algorithm" TEXT NOT NULL,
    "keyId" TEXT NOT NULL,
    "wrappedKey" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "declinedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Referral_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Referral_priority_check" CHECK ("priority" IN ('ROUTINE', 'URGENT')),
    CONSTRAINT "Referral_status_check" CHECK ("status" IN ('REQUESTED', 'ACCEPTED', 'IN_PROGRESS', 'COMPLETED', 'DECLINED', 'CANCELLED')),
    CONSTRAINT "Referral_distinct_provider_check" CHECK ("referringProviderId" <> "destinationProviderId")
);

CREATE TABLE "ClinicalShareGrant" (
    "id" TEXT NOT NULL,
    "referralId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "destinationProviderId" TEXT NOT NULL,
    "scopes" JSONB NOT NULL,
    "documentIds" JSONB NOT NULL,
    "purpose" TEXT NOT NULL DEFAULT 'TREATMENT',
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdByProviderId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClinicalShareGrant_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ClinicalShareGrant_purpose_check" CHECK ("purpose" = 'TREATMENT')
);

CREATE TABLE "ReferralStatusEvent" (
    "id" TEXT NOT NULL,
    "referralId" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT NOT NULL,
    "actorAccountId" TEXT NOT NULL,
    "reasonCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferralStatusEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Referral_idempotencyKey_key" ON "Referral"("idempotencyKey");
CREATE INDEX "Referral_patientId_createdAt_idx" ON "Referral"("patientId", "createdAt");
CREATE INDEX "Referral_referringProviderId_status_createdAt_idx" ON "Referral"("referringProviderId", "status", "createdAt");
CREATE INDEX "Referral_destinationProviderId_status_createdAt_idx" ON "Referral"("destinationProviderId", "status", "createdAt");
CREATE UNIQUE INDEX "ClinicalShareGrant_referralId_key" ON "ClinicalShareGrant"("referralId");
CREATE INDEX "ClinicalShareGrant_patientId_createdAt_idx" ON "ClinicalShareGrant"("patientId", "createdAt");
CREATE INDEX "ClinicalShareGrant_destinationProviderId_expiresAt_revokedAt_idx" ON "ClinicalShareGrant"("destinationProviderId", "expiresAt", "revokedAt");
CREATE INDEX "ReferralStatusEvent_referralId_createdAt_idx" ON "ReferralStatusEvent"("referralId", "createdAt");

ALTER TABLE "Referral" ADD CONSTRAINT "Referral_patientId_fkey"
FOREIGN KEY ("patientId") REFERENCES "PatientProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_referringProviderId_fkey"
FOREIGN KEY ("referringProviderId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_destinationProviderId_fkey"
FOREIGN KEY ("destinationProviderId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClinicalShareGrant" ADD CONSTRAINT "ClinicalShareGrant_referralId_fkey"
FOREIGN KEY ("referralId") REFERENCES "Referral"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClinicalShareGrant" ADD CONSTRAINT "ClinicalShareGrant_patientId_fkey"
FOREIGN KEY ("patientId") REFERENCES "PatientProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClinicalShareGrant" ADD CONSTRAINT "ClinicalShareGrant_destinationProviderId_fkey"
FOREIGN KEY ("destinationProviderId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClinicalShareGrant" ADD CONSTRAINT "ClinicalShareGrant_createdByProviderId_fkey"
FOREIGN KEY ("createdByProviderId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReferralStatusEvent" ADD CONSTRAINT "ReferralStatusEvent_referralId_fkey"
FOREIGN KEY ("referralId") REFERENCES "Referral"("id") ON DELETE CASCADE ON UPDATE CASCADE;
