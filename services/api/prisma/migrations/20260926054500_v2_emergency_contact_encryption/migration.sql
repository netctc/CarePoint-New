-- CarePoint V2 privacy hardening:
-- add application-level envelope encryption fields for emergency-contact PII.
-- Existing plaintext columns are retained temporarily for zero-downtime compatibility;
-- the application writes non-sensitive sentinels after encryption and the idempotent
-- backfill command upgrades legacy rows.

ALTER TABLE "EmergencyContact"
  ADD COLUMN "algorithm" TEXT,
  ADD COLUMN "keyId" TEXT,
  ADD COLUMN "wrappedKey" TEXT,
  ADD COLUMN "iv" TEXT,
  ADD COLUMN "ciphertext" TEXT;

CREATE INDEX "EmergencyContact_keyId_idx"
ON "EmergencyContact"("keyId")
WHERE "keyId" IS NOT NULL;
