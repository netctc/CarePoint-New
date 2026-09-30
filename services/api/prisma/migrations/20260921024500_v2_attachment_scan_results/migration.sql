-- CarePoint V2 / BE-048:
-- durable attachment scan evidence. Files are not made available before a CLEAN result.

CREATE TYPE "AttachmentScanStatus" AS ENUM ('QUARANTINED', 'CLEAN', 'INFECTED', 'REJECTED', 'ERROR');

CREATE TABLE "AttachmentScanResult" (
  "id" TEXT NOT NULL,
  "contentDigest" TEXT NOT NULL,
  "byteLength" INTEGER NOT NULL,
  "detectedMediaType" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "status" "AttachmentScanStatus" NOT NULL DEFAULT 'QUARANTINED',
  "reasonCode" TEXT,
  "quarantinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "AttachmentScanResult_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AttachmentScanResult_contentDigest_completedAt_idx"
  ON "AttachmentScanResult"("contentDigest", "completedAt");
CREATE INDEX "AttachmentScanResult_status_quarantinedAt_idx"
  ON "AttachmentScanResult"("status", "quarantinedAt");

ALTER TABLE "AttachmentScanResult"
  ADD CONSTRAINT "AttachmentScanResult_digest_check"
  CHECK ("contentDigest" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "AttachmentScanResult_byte_length_check"
  CHECK ("byteLength" > 0 AND "byteLength" <= 8388608),
  ADD CONSTRAINT "AttachmentScanResult_reason_length_check"
  CHECK ("reasonCode" IS NULL OR char_length("reasonCode") <= 80),
  ADD CONSTRAINT "AttachmentScanResult_completion_check"
  CHECK (
    ("status" = 'QUARANTINED' AND "completedAt" IS NULL)
    OR ("status" <> 'QUARANTINED' AND "completedAt" IS NOT NULL)
  );
