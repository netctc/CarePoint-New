CREATE TABLE "SiemAuditDelivery" (
  "id" TEXT NOT NULL,
  "auditEventId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseOwner" TEXT,
  "leaseUntil" TIMESTAMP(3),
  "exportedAt" TIMESTAMP(3),
  "errorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SiemAuditDelivery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SiemAuditDelivery_auditEventId_key"
  ON "SiemAuditDelivery"("auditEventId");

CREATE INDEX "SiemAuditDelivery_status_availableAt_idx"
  ON "SiemAuditDelivery"("status", "availableAt");

CREATE INDEX "SiemAuditDelivery_leaseUntil_idx"
  ON "SiemAuditDelivery"("leaseUntil");

ALTER TABLE "SiemAuditDelivery"
  ADD CONSTRAINT "SiemAuditDelivery_auditEventId_fkey"
  FOREIGN KEY ("auditEventId") REFERENCES "AuditEvent"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
