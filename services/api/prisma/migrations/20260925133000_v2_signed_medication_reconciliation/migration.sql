-- CarePoint V2 P0 DOC-006 / PAT-092
-- Append-only signed medication reconciliation snapshots with persistent discrepancies.

ALTER TABLE "MedicationReconciliation"
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "supersedesId" TEXT,
  ADD COLUMN "payloadDigest" TEXT,
  ADD COLUMN "signatureAlgorithm" TEXT,
  ADD COLUMN "signatureKeyId" TEXT,
  ADD COLUMN "signature" TEXT,
  ADD COLUMN "signedAt" TIMESTAMP(3);

CREATE INDEX "MedicationReconciliation_patientId_version_idx"
ON "MedicationReconciliation"("patientId", "version");

CREATE TABLE "MedicationReconciliationItem" (
  "id" TEXT NOT NULL,
  "reconciliationId" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "statementEntryId" TEXT NOT NULL,
  "prescriptionOrderId" TEXT,
  "outcome" TEXT NOT NULL,
  "resolutionStatus" TEXT NOT NULL,
  "algorithm" TEXT NOT NULL,
  "keyId" TEXT NOT NULL,
  "wrappedKey" TEXT NOT NULL,
  "iv" TEXT NOT NULL,
  "ciphertext" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MedicationReconciliationItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MedicationReconciliationItem_outcome_check"
    CHECK ("outcome" IN ('CONTINUE','SUSPEND','DUPLICATE','CORRECT','MATCHED')),
  CONSTRAINT "MedicationReconciliationItem_resolution_check"
    CHECK ("resolutionStatus" IN ('OPEN','RESOLVED'))
);

CREATE UNIQUE INDEX "MedicationReconciliationItem_reconciliationId_statementEntryId_key"
ON "MedicationReconciliationItem"("reconciliationId", "statementEntryId");

CREATE INDEX "MedicationReconciliationItem_patientId_resolutionStatus_createdAt_idx"
ON "MedicationReconciliationItem"("patientId", "resolutionStatus", "createdAt");

CREATE INDEX "MedicationReconciliationItem_statementEntryId_createdAt_idx"
ON "MedicationReconciliationItem"("statementEntryId", "createdAt");

CREATE INDEX "MedicationReconciliationItem_prescriptionOrderId_createdAt_idx"
ON "MedicationReconciliationItem"("prescriptionOrderId", "createdAt");

ALTER TABLE "MedicationReconciliationItem"
ADD CONSTRAINT "MedicationReconciliationItem_reconciliationId_fkey"
FOREIGN KEY ("reconciliationId") REFERENCES "MedicationReconciliation"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MedicationReconciliationItem"
ADD CONSTRAINT "MedicationReconciliationItem_statementEntryId_fkey"
FOREIGN KEY ("statementEntryId") REFERENCES "ClinicalProfileEntry"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MedicationReconciliationItem"
ADD CONSTRAINT "MedicationReconciliationItem_prescriptionOrderId_fkey"
FOREIGN KEY ("prescriptionOrderId") REFERENCES "ClinicalOrder"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
