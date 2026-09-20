ALTER TABLE "MedicationReconciliation"
ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "algorithm" TEXT,
ADD COLUMN "keyId" TEXT,
ADD COLUMN "wrappedKey" TEXT,
ADD COLUMN "iv" TEXT,
ADD COLUMN "ciphertext" TEXT,
ADD COLUMN "payloadDigest" TEXT,
ADD COLUMN "signatureAlgorithm" TEXT,
ADD COLUMN "signatureKeyId" TEXT,
ADD COLUMN "signature" TEXT,
ADD COLUMN "signedAt" TIMESTAMP(3);

CREATE TABLE "MedicationReconciliationItem" (
    "id" TEXT NOT NULL,
    "reconciliationId" TEXT NOT NULL,
    "medicationEntryId" TEXT,
    "prescriptionOrderId" TEXT,
    "outcome" TEXT NOT NULL,
    "discrepancyState" TEXT NOT NULL DEFAULT 'NONE',
    "reasonCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MedicationReconciliationItem_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "MedicationReconciliationItem_reference_check" CHECK ("medicationEntryId" IS NOT NULL OR "prescriptionOrderId" IS NOT NULL),
    CONSTRAINT "MedicationReconciliationItem_outcome_check" CHECK ("outcome" IN ('MATCHED','CONTINUE','SUSPEND','DUPLICATE','CORRECT')),
    CONSTRAINT "MedicationReconciliationItem_discrepancyState_check" CHECK ("discrepancyState" IN ('NONE','OPEN','RESOLVED'))
);

CREATE INDEX "MedicationReconciliationItem_medicationEntryId_createdAt_idx"
ON "MedicationReconciliationItem"("medicationEntryId", "createdAt");
CREATE INDEX "MedicationReconciliationItem_prescriptionOrderId_createdAt_idx"
ON "MedicationReconciliationItem"("prescriptionOrderId", "createdAt");
CREATE INDEX "MedicationReconciliationItem_reconciliationId_createdAt_idx"
ON "MedicationReconciliationItem"("reconciliationId", "createdAt");

ALTER TABLE "MedicationReconciliationItem" ADD CONSTRAINT "MedicationReconciliationItem_reconciliationId_fkey"
FOREIGN KEY ("reconciliationId") REFERENCES "MedicationReconciliation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MedicationReconciliationItem" ADD CONSTRAINT "MedicationReconciliationItem_medicationEntryId_fkey"
FOREIGN KEY ("medicationEntryId") REFERENCES "ClinicalProfileEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MedicationReconciliationItem" ADD CONSTRAINT "MedicationReconciliationItem_prescriptionOrderId_fkey"
FOREIGN KEY ("prescriptionOrderId") REFERENCES "ClinicalOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
