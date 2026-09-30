CREATE TYPE "InsuranceClaimStatus" AS ENUM ('SUBMITTED', 'ACCEPTED', 'PENDING', 'ADJUDICATED', 'DENIED', 'PAID', 'VOID');
CREATE TYPE "ClaimReconciliationStatus" AS ENUM ('NOT_RECONCILED', 'RECONCILED', 'REVIEW_REQUIRED');
CREATE TYPE "RemittanceStatus" AS ENUM ('APPLIED', 'REVERSED');
ALTER TYPE "ProviderLedgerEntryType" ADD VALUE IF NOT EXISTS 'INSURANCE_PAYMENT';

CREATE TABLE "InsuranceClaim" (
  "id" TEXT NOT NULL,
  "appointmentId" TEXT NOT NULL,
  "invoiceId" TEXT NOT NULL,
  "coverageId" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "previousClaimId" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "idempotencyKey" TEXT NOT NULL,
  "gateway" TEXT NOT NULL,
  "gatewayClaimRef" TEXT,
  "status" "InsuranceClaimStatus" NOT NULL DEFAULT 'SUBMITTED',
  "reconciliationStatus" "ClaimReconciliationStatus" NOT NULL DEFAULT 'NOT_RECONCILED',
  "submittedAmountMinor" INTEGER NOT NULL,
  "currency" TEXT NOT NULL,
  "allowedMinor" INTEGER,
  "insurerPaidMinor" INTEGER,
  "patientResponsibilityMinor" INTEGER,
  "adjustmentMinor" INTEGER,
  "denialCode" TEXT,
  "denialPublicMessage" TEXT,
  "reworkReasonCode" TEXT,
  "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "adjudicatedAt" TIMESTAMP(3),
  "paidAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InsuranceClaim_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "InsuranceClaim_amounts_check" CHECK (
    "version" > 0 AND
    "submittedAmountMinor" >= 0 AND
    ("allowedMinor" IS NULL OR "allowedMinor" >= 0) AND
    ("insurerPaidMinor" IS NULL OR "insurerPaidMinor" >= 0) AND
    ("patientResponsibilityMinor" IS NULL OR "patientResponsibilityMinor" >= 0) AND
    ("adjustmentMinor" IS NULL OR "adjustmentMinor" >= 0) AND
    ("allowedMinor" IS NULL OR "allowedMinor" <= "submittedAmountMinor") AND
    ("allowedMinor" IS NULL OR "adjustmentMinor" IS NULL OR "allowedMinor" + "adjustmentMinor" = "submittedAmountMinor") AND
    ("allowedMinor" IS NULL OR "insurerPaidMinor" IS NULL OR "patientResponsibilityMinor" IS NULL OR "insurerPaidMinor" + "patientResponsibilityMinor" = "allowedMinor")
  )
);

CREATE TABLE "ClaimEvent" (
  "id" TEXT NOT NULL,
  "claimId" TEXT NOT NULL,
  "status" "InsuranceClaimStatus" NOT NULL,
  "source" TEXT NOT NULL,
  "gatewayReference" TEXT,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ClaimEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ExplanationOfBenefits" (
  "id" TEXT NOT NULL,
  "claimId" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "payerCode" TEXT NOT NULL,
  "externalEobRef" TEXT,
  "billedMinor" INTEGER NOT NULL,
  "allowedMinor" INTEGER NOT NULL,
  "insurerPaidMinor" INTEGER NOT NULL,
  "patientResponsibilityMinor" INTEGER NOT NULL,
  "adjustmentMinor" INTEGER NOT NULL,
  "currency" TEXT NOT NULL,
  "denialCode" TEXT,
  "denialPublicMessage" TEXT,
  "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "releasedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ExplanationOfBenefits_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ExplanationOfBenefits_amounts_check" CHECK (
    "billedMinor" >= 0 AND "allowedMinor" >= 0 AND "insurerPaidMinor" >= 0 AND
    "patientResponsibilityMinor" >= 0 AND "adjustmentMinor" >= 0 AND
    "allowedMinor" + "adjustmentMinor" = "billedMinor" AND
    "insurerPaidMinor" + "patientResponsibilityMinor" = "allowedMinor"
  )
);

CREATE TABLE "InsuranceRemittance" (
  "id" TEXT NOT NULL,
  "claimId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "invoiceId" TEXT NOT NULL,
  "externalRemittanceRef" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "amountMinor" INTEGER NOT NULL,
  "currency" TEXT NOT NULL,
  "status" "RemittanceStatus" NOT NULL DEFAULT 'APPLIED',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reversedAt" TIMESTAMP(3),
  CONSTRAINT "InsuranceRemittance_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "InsuranceRemittance_amount_check" CHECK ("amountMinor" > 0)
);

CREATE UNIQUE INDEX "InsuranceClaim_idempotencyKey_key" ON "InsuranceClaim"("idempotencyKey");
CREATE UNIQUE INDEX "InsuranceClaim_gatewayClaimRef_key" ON "InsuranceClaim"("gatewayClaimRef");
CREATE UNIQUE INDEX "InsuranceClaim_invoiceId_version_key" ON "InsuranceClaim"("invoiceId", "version");
CREATE INDEX "InsuranceClaim_appointmentId_submittedAt_idx" ON "InsuranceClaim"("appointmentId", "submittedAt");
CREATE INDEX "InsuranceClaim_patientId_submittedAt_idx" ON "InsuranceClaim"("patientId", "submittedAt");
CREATE INDEX "InsuranceClaim_providerId_submittedAt_idx" ON "InsuranceClaim"("providerId", "submittedAt");
CREATE INDEX "InsuranceClaim_coverageId_submittedAt_idx" ON "InsuranceClaim"("coverageId", "submittedAt");
CREATE INDEX "InsuranceClaim_status_submittedAt_idx" ON "InsuranceClaim"("status", "submittedAt");

CREATE INDEX "ClaimEvent_claimId_occurredAt_idx" ON "ClaimEvent"("claimId", "occurredAt");

CREATE UNIQUE INDEX "ExplanationOfBenefits_claimId_key" ON "ExplanationOfBenefits"("claimId");
CREATE UNIQUE INDEX "ExplanationOfBenefits_externalEobRef_key" ON "ExplanationOfBenefits"("externalEobRef");
CREATE INDEX "ExplanationOfBenefits_patientId_releasedAt_idx" ON "ExplanationOfBenefits"("patientId", "releasedAt");
CREATE INDEX "ExplanationOfBenefits_providerId_releasedAt_idx" ON "ExplanationOfBenefits"("providerId", "releasedAt");

CREATE UNIQUE INDEX "InsuranceRemittance_externalRemittanceRef_key" ON "InsuranceRemittance"("externalRemittanceRef");
CREATE UNIQUE INDEX "InsuranceRemittance_idempotencyKey_key" ON "InsuranceRemittance"("idempotencyKey");
CREATE INDEX "InsuranceRemittance_claimId_appliedAt_idx" ON "InsuranceRemittance"("claimId", "appliedAt");
CREATE INDEX "InsuranceRemittance_providerId_appliedAt_idx" ON "InsuranceRemittance"("providerId", "appliedAt");
CREATE INDEX "InsuranceRemittance_invoiceId_appliedAt_idx" ON "InsuranceRemittance"("invoiceId", "appliedAt");
