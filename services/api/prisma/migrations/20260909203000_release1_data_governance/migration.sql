CREATE TYPE "DataRetentionClass" AS ENUM ('AUTH_EPHEMERAL', 'IDENTITY_PROFILE', 'CLINICAL_RECORD', 'CLINICAL_DOCUMENT', 'DIAGNOSTIC_REPORT', 'CONSENT', 'FINANCIAL', 'COMMUNICATION', 'AUDIT_SECURITY');
CREATE TYPE "DataRetentionHoldScope" AS ENUM ('PATIENT', 'OBJECT', 'DATA_CLASS');
CREATE TYPE "DataRetentionHoldStatus" AS ENUM ('ACTIVE', 'RELEASED');

CREATE TABLE "DataRetentionHold" (
  "id" TEXT NOT NULL,
  "scope" "DataRetentionHoldScope" NOT NULL,
  "scopeId" TEXT,
  "objectType" TEXT,
  "dataClass" "DataRetentionClass",
  "reasonCode" TEXT NOT NULL,
  "approvalReference" TEXT NOT NULL,
  "status" "DataRetentionHoldStatus" NOT NULL DEFAULT 'ACTIVE',
  "placedByActorId" TEXT NOT NULL,
  "releasedByActorId" TEXT,
  "expiresAt" TIMESTAMP(3),
  "releasedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DataRetentionHold_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DataRetentionHold_status_expiresAt_idx" ON "DataRetentionHold"("status", "expiresAt");
CREATE INDEX "DataRetentionHold_scope_scopeId_status_idx" ON "DataRetentionHold"("scope", "scopeId", "status");
CREATE INDEX "DataRetentionHold_dataClass_status_idx" ON "DataRetentionHold"("dataClass", "status");
CREATE INDEX "DataRetentionHold_objectType_scopeId_status_idx" ON "DataRetentionHold"("objectType", "scopeId", "status");
