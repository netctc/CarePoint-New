CREATE TYPE "InvoiceStatus" AS ENUM ('OPEN', 'PARTIALLY_PAID', 'PAID', 'VOID', 'REFUNDED');
CREATE TYPE "PaymentIntentStatus" AS ENUM ('REQUIRES_ACTION', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELLED');
CREATE TYPE "RefundStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED');
CREATE TYPE "ProviderLedgerEntryType" AS ENUM ('CHARGE', 'REFUND', 'PLATFORM_FEE', 'PAYOUT');
CREATE TYPE "ProviderPayoutStatus" AS ENUM ('PENDING', 'PROCESSING', 'PAID', 'FAILED', 'CANCELLED');
CREATE TYPE "InsuranceCoverageStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'EXPIRED');
CREATE TYPE "InsuranceEligibilityStatus" AS ENUM ('PENDING', 'ELIGIBLE', 'NOT_ELIGIBLE', 'UNKNOWN');
CREATE TYPE "PriorAuthorizationStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'APPROVED', 'DENIED', 'EXPIRED', 'CANCELLED');

CREATE TABLE "PricingSnapshot" (
  "id" TEXT NOT NULL,
  "appointmentId" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "serviceId" TEXT NOT NULL,
  "modality" "AppointmentModality" NOT NULL,
  "serviceName" TEXT NOT NULL,
  "currency" TEXT NOT NULL,
  "unitPriceMinor" INTEGER NOT NULL,
  "discountMinor" INTEGER NOT NULL DEFAULT 0,
  "taxMinor" INTEGER NOT NULL DEFAULT 0,
  "totalMinor" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PricingSnapshot_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PricingSnapshot_amounts_check" CHECK ("unitPriceMinor" >= 0 AND "discountMinor" >= 0 AND "taxMinor" >= 0 AND "discountMinor" <= "unitPriceMinor" AND "totalMinor" = "unitPriceMinor" - "discountMinor" + "taxMinor")
);

CREATE TABLE "Invoice" (
  "id" TEXT NOT NULL,
  "number" TEXT NOT NULL,
  "appointmentId" TEXT NOT NULL,
  "pricingSnapshotId" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "currency" TEXT NOT NULL,
  "totalMinor" INTEGER NOT NULL,
  "patientResponsibilityMinor" INTEGER NOT NULL,
  "insurerResponsibilityMinor" INTEGER NOT NULL DEFAULT 0,
  "amountPaidMinor" INTEGER NOT NULL DEFAULT 0,
  "amountRefundedMinor" INTEGER NOT NULL DEFAULT 0,
  "balanceDueMinor" INTEGER NOT NULL,
  "status" "InvoiceStatus" NOT NULL DEFAULT 'OPEN',
  "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "voidedAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Invoice_amounts_check" CHECK (
    "totalMinor" >= 0 AND "patientResponsibilityMinor" >= 0 AND "insurerResponsibilityMinor" >= 0 AND
    "patientResponsibilityMinor" + "insurerResponsibilityMinor" = "totalMinor" AND
    "amountPaidMinor" >= 0 AND "amountRefundedMinor" >= 0 AND "balanceDueMinor" >= 0
  )
);

CREATE TABLE "PaymentIntent" (
  "id" TEXT NOT NULL,
  "invoiceId" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "amountMinor" INTEGER NOT NULL,
  "currency" TEXT NOT NULL,
  "gateway" TEXT NOT NULL,
  "gatewayIntentRef" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "status" "PaymentIntentStatus" NOT NULL DEFAULT 'PROCESSING',
  "failureCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "succeededAt" TIMESTAMP(3),
  CONSTRAINT "PaymentIntent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PaymentIntent_amount_check" CHECK ("amountMinor" > 0)
);

CREATE TABLE "PaymentRefund" (
  "id" TEXT NOT NULL,
  "invoiceId" TEXT NOT NULL,
  "paymentIntentId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "amountMinor" INTEGER NOT NULL,
  "currency" TEXT NOT NULL,
  "reason" TEXT,
  "gatewayRefundRef" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "status" "RefundStatus" NOT NULL DEFAULT 'PENDING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "succeededAt" TIMESTAMP(3),
  CONSTRAINT "PaymentRefund_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PaymentRefund_amount_check" CHECK ("amountMinor" > 0)
);

CREATE TABLE "PaymentReceipt" (
  "id" TEXT NOT NULL,
  "number" TEXT NOT NULL,
  "invoiceId" TEXT NOT NULL,
  "paymentIntentId" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "amountMinor" INTEGER NOT NULL,
  "currency" TEXT NOT NULL,
  "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PaymentReceipt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PaymentReceipt_amount_check" CHECK ("amountMinor" > 0)
);

CREATE TABLE "ProviderPayout" (
  "id" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "amountMinor" INTEGER NOT NULL,
  "currency" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "gateway" TEXT NOT NULL,
  "gatewayPayoutRef" TEXT,
  "status" "ProviderPayoutStatus" NOT NULL DEFAULT 'PENDING',
  "periodStart" TIMESTAMP(3),
  "periodEnd" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "paidAt" TIMESTAMP(3),
  CONSTRAINT "ProviderPayout_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProviderPayout_amount_check" CHECK ("amountMinor" > 0),
  CONSTRAINT "ProviderPayout_period_check" CHECK ("periodEnd" IS NULL OR "periodStart" IS NULL OR "periodEnd" >= "periodStart")
);

CREATE TABLE "ProviderLedgerEntry" (
  "id" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "invoiceId" TEXT,
  "paymentIntentId" TEXT,
  "refundId" TEXT,
  "payoutId" TEXT,
  "type" "ProviderLedgerEntryType" NOT NULL,
  "amountMinor" INTEGER NOT NULL,
  "currency" TEXT NOT NULL,
  "reference" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProviderLedgerEntry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InsuranceCoverage" (
  "id" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "payerCode" TEXT NOT NULL,
  "payerName" TEXT NOT NULL,
  "externalPolicyRef" TEXT NOT NULL,
  "displayLabel" TEXT,
  "status" "InsuranceCoverageStatus" NOT NULL DEFAULT 'ACTIVE',
  "effectiveFrom" DATE,
  "effectiveUntil" DATE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InsuranceCoverage_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "InsuranceCoverage_dates_check" CHECK ("effectiveUntil" IS NULL OR "effectiveFrom" IS NULL OR "effectiveUntil" >= "effectiveFrom")
);

CREATE TABLE "InsuranceEligibilityCheck" (
  "id" TEXT NOT NULL,
  "appointmentId" TEXT NOT NULL,
  "coverageId" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "gateway" TEXT NOT NULL,
  "gatewayReference" TEXT,
  "status" "InsuranceEligibilityStatus" NOT NULL DEFAULT 'PENDING',
  "estimatedPatientMinor" INTEGER,
  "estimatedInsurerMinor" INTEGER,
  "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InsuranceEligibilityCheck_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "InsuranceEligibilityCheck_amounts_check" CHECK (("estimatedPatientMinor" IS NULL OR "estimatedPatientMinor" >= 0) AND ("estimatedInsurerMinor" IS NULL OR "estimatedInsurerMinor" >= 0))
);

CREATE TABLE "PriorAuthorization" (
  "id" TEXT NOT NULL,
  "appointmentId" TEXT NOT NULL,
  "coverageId" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "eligibilityCheckId" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "gateway" TEXT NOT NULL,
  "gatewayReference" TEXT,
  "status" "PriorAuthorizationStatus" NOT NULL DEFAULT 'PENDING',
  "approvedAmountMinor" INTEGER,
  "validUntil" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PriorAuthorization_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PriorAuthorization_amount_check" CHECK ("approvedAmountMinor" IS NULL OR "approvedAmountMinor" >= 0)
);

CREATE UNIQUE INDEX "PricingSnapshot_appointmentId_key" ON "PricingSnapshot"("appointmentId");
CREATE INDEX "PricingSnapshot_patientId_createdAt_idx" ON "PricingSnapshot"("patientId", "createdAt");
CREATE INDEX "PricingSnapshot_providerId_createdAt_idx" ON "PricingSnapshot"("providerId", "createdAt");
CREATE INDEX "PricingSnapshot_serviceId_modality_idx" ON "PricingSnapshot"("serviceId", "modality");

CREATE UNIQUE INDEX "Invoice_number_key" ON "Invoice"("number");
CREATE UNIQUE INDEX "Invoice_appointmentId_key" ON "Invoice"("appointmentId");
CREATE UNIQUE INDEX "Invoice_pricingSnapshotId_key" ON "Invoice"("pricingSnapshotId");
CREATE INDEX "Invoice_patientId_issuedAt_idx" ON "Invoice"("patientId", "issuedAt");
CREATE INDEX "Invoice_providerId_issuedAt_idx" ON "Invoice"("providerId", "issuedAt");
CREATE INDEX "Invoice_status_issuedAt_idx" ON "Invoice"("status", "issuedAt");

CREATE UNIQUE INDEX "PaymentIntent_gatewayIntentRef_key" ON "PaymentIntent"("gatewayIntentRef");
CREATE UNIQUE INDEX "PaymentIntent_idempotencyKey_key" ON "PaymentIntent"("idempotencyKey");
CREATE INDEX "PaymentIntent_invoiceId_createdAt_idx" ON "PaymentIntent"("invoiceId", "createdAt");
CREATE INDEX "PaymentIntent_patientId_createdAt_idx" ON "PaymentIntent"("patientId", "createdAt");
CREATE INDEX "PaymentIntent_providerId_createdAt_idx" ON "PaymentIntent"("providerId", "createdAt");
CREATE INDEX "PaymentIntent_status_createdAt_idx" ON "PaymentIntent"("status", "createdAt");

CREATE UNIQUE INDEX "PaymentRefund_gatewayRefundRef_key" ON "PaymentRefund"("gatewayRefundRef");
CREATE UNIQUE INDEX "PaymentRefund_idempotencyKey_key" ON "PaymentRefund"("idempotencyKey");
CREATE INDEX "PaymentRefund_invoiceId_createdAt_idx" ON "PaymentRefund"("invoiceId", "createdAt");
CREATE INDEX "PaymentRefund_paymentIntentId_createdAt_idx" ON "PaymentRefund"("paymentIntentId", "createdAt");
CREATE INDEX "PaymentRefund_providerId_createdAt_idx" ON "PaymentRefund"("providerId", "createdAt");

CREATE UNIQUE INDEX "PaymentReceipt_number_key" ON "PaymentReceipt"("number");
CREATE UNIQUE INDEX "PaymentReceipt_paymentIntentId_key" ON "PaymentReceipt"("paymentIntentId");
CREATE INDEX "PaymentReceipt_patientId_issuedAt_idx" ON "PaymentReceipt"("patientId", "issuedAt");
CREATE INDEX "PaymentReceipt_providerId_issuedAt_idx" ON "PaymentReceipt"("providerId", "issuedAt");

CREATE UNIQUE INDEX "ProviderPayout_idempotencyKey_key" ON "ProviderPayout"("idempotencyKey");
CREATE UNIQUE INDEX "ProviderPayout_gatewayPayoutRef_key" ON "ProviderPayout"("gatewayPayoutRef");
CREATE INDEX "ProviderPayout_providerId_createdAt_idx" ON "ProviderPayout"("providerId", "createdAt");
CREATE INDEX "ProviderPayout_status_createdAt_idx" ON "ProviderPayout"("status", "createdAt");

CREATE INDEX "ProviderLedgerEntry_providerId_createdAt_idx" ON "ProviderLedgerEntry"("providerId", "createdAt");
CREATE INDEX "ProviderLedgerEntry_invoiceId_createdAt_idx" ON "ProviderLedgerEntry"("invoiceId", "createdAt");
CREATE INDEX "ProviderLedgerEntry_payoutId_createdAt_idx" ON "ProviderLedgerEntry"("payoutId", "createdAt");

CREATE UNIQUE INDEX "InsuranceCoverage_patientId_payerCode_externalPolicyRef_key" ON "InsuranceCoverage"("patientId", "payerCode", "externalPolicyRef");
CREATE INDEX "InsuranceCoverage_patientId_status_idx" ON "InsuranceCoverage"("patientId", "status");

CREATE UNIQUE INDEX "InsuranceEligibilityCheck_idempotencyKey_key" ON "InsuranceEligibilityCheck"("idempotencyKey");
CREATE UNIQUE INDEX "InsuranceEligibilityCheck_gatewayReference_key" ON "InsuranceEligibilityCheck"("gatewayReference");
CREATE INDEX "InsuranceEligibilityCheck_appointmentId_checkedAt_idx" ON "InsuranceEligibilityCheck"("appointmentId", "checkedAt");
CREATE INDEX "InsuranceEligibilityCheck_coverageId_checkedAt_idx" ON "InsuranceEligibilityCheck"("coverageId", "checkedAt");
CREATE INDEX "InsuranceEligibilityCheck_patientId_checkedAt_idx" ON "InsuranceEligibilityCheck"("patientId", "checkedAt");
CREATE INDEX "InsuranceEligibilityCheck_providerId_checkedAt_idx" ON "InsuranceEligibilityCheck"("providerId", "checkedAt");

CREATE UNIQUE INDEX "PriorAuthorization_idempotencyKey_key" ON "PriorAuthorization"("idempotencyKey");
CREATE UNIQUE INDEX "PriorAuthorization_gatewayReference_key" ON "PriorAuthorization"("gatewayReference");
CREATE INDEX "PriorAuthorization_appointmentId_createdAt_idx" ON "PriorAuthorization"("appointmentId", "createdAt");
CREATE INDEX "PriorAuthorization_coverageId_createdAt_idx" ON "PriorAuthorization"("coverageId", "createdAt");
CREATE INDEX "PriorAuthorization_patientId_createdAt_idx" ON "PriorAuthorization"("patientId", "createdAt");
CREATE INDEX "PriorAuthorization_providerId_createdAt_idx" ON "PriorAuthorization"("providerId", "createdAt");

ALTER TABLE "PricingSnapshot" ADD CONSTRAINT "PricingSnapshot_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PricingSnapshot" ADD CONSTRAINT "PricingSnapshot_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "PatientProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PricingSnapshot" ADD CONSTRAINT "PricingSnapshot_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PricingSnapshot" ADD CONSTRAINT "PricingSnapshot_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_pricingSnapshotId_fkey" FOREIGN KEY ("pricingSnapshotId") REFERENCES "PricingSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "PatientProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentIntent" ADD CONSTRAINT "PaymentIntent_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentIntent" ADD CONSTRAINT "PaymentIntent_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "PatientProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentIntent" ADD CONSTRAINT "PaymentIntent_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentRefund" ADD CONSTRAINT "PaymentRefund_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentRefund" ADD CONSTRAINT "PaymentRefund_paymentIntentId_fkey" FOREIGN KEY ("paymentIntentId") REFERENCES "PaymentIntent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentRefund" ADD CONSTRAINT "PaymentRefund_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentReceipt" ADD CONSTRAINT "PaymentReceipt_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentReceipt" ADD CONSTRAINT "PaymentReceipt_paymentIntentId_fkey" FOREIGN KEY ("paymentIntentId") REFERENCES "PaymentIntent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentReceipt" ADD CONSTRAINT "PaymentReceipt_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "PatientProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentReceipt" ADD CONSTRAINT "PaymentReceipt_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProviderPayout" ADD CONSTRAINT "ProviderPayout_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProviderLedgerEntry" ADD CONSTRAINT "ProviderLedgerEntry_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProviderLedgerEntry" ADD CONSTRAINT "ProviderLedgerEntry_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProviderLedgerEntry" ADD CONSTRAINT "ProviderLedgerEntry_paymentIntentId_fkey" FOREIGN KEY ("paymentIntentId") REFERENCES "PaymentIntent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProviderLedgerEntry" ADD CONSTRAINT "ProviderLedgerEntry_refundId_fkey" FOREIGN KEY ("refundId") REFERENCES "PaymentRefund"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProviderLedgerEntry" ADD CONSTRAINT "ProviderLedgerEntry_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "ProviderPayout"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "InsuranceCoverage" ADD CONSTRAINT "InsuranceCoverage_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "PatientProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InsuranceEligibilityCheck" ADD CONSTRAINT "InsuranceEligibilityCheck_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InsuranceEligibilityCheck" ADD CONSTRAINT "InsuranceEligibilityCheck_coverageId_fkey" FOREIGN KEY ("coverageId") REFERENCES "InsuranceCoverage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InsuranceEligibilityCheck" ADD CONSTRAINT "InsuranceEligibilityCheck_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "PatientProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InsuranceEligibilityCheck" ADD CONSTRAINT "InsuranceEligibilityCheck_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PriorAuthorization" ADD CONSTRAINT "PriorAuthorization_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PriorAuthorization" ADD CONSTRAINT "PriorAuthorization_coverageId_fkey" FOREIGN KEY ("coverageId") REFERENCES "InsuranceCoverage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PriorAuthorization" ADD CONSTRAINT "PriorAuthorization_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "PatientProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PriorAuthorization" ADD CONSTRAINT "PriorAuthorization_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PriorAuthorization" ADD CONSTRAINT "PriorAuthorization_eligibilityCheckId_fkey" FOREIGN KEY ("eligibilityCheckId") REFERENCES "InsuranceEligibilityCheck"("id") ON DELETE SET NULL ON UPDATE CASCADE;
