ALTER TABLE "NotificationDelivery"
  ADD COLUMN "sentAt" TIMESTAMP(3),
  ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "leaseOwner" TEXT,
  ADD COLUMN "leaseUntil" TIMESTAMP(3);

CREATE INDEX "NotificationDelivery_status_availableAt_idx"
  ON "NotificationDelivery"("status", "availableAt");

CREATE INDEX "NotificationDelivery_leaseUntil_idx"
  ON "NotificationDelivery"("leaseUntil");
