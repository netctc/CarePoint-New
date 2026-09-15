CREATE TABLE "PatientClinicalDocumentReceipt" (
  "id" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "firstOpenedAt" TIMESTAMP(3),
  "acknowledgedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PatientClinicalDocumentReceipt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PatientClinicalDocumentReceipt_documentId_accountId_key"
  ON "PatientClinicalDocumentReceipt"("documentId", "accountId");
CREATE INDEX "PatientClinicalDocumentReceipt_accountId_acknowledgedAt_createdAt_idx"
  ON "PatientClinicalDocumentReceipt"("accountId", "acknowledgedAt", "createdAt");
CREATE INDEX "PatientClinicalDocumentReceipt_documentId_accountId_idx"
  ON "PatientClinicalDocumentReceipt"("documentId", "accountId");
