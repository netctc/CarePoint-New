CREATE TABLE "ClinicalDocumentDownloadGrant" (
  "id" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ClinicalDocumentDownloadGrant_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ClinicalDocumentDownloadGrant_tokenHash_key"
  ON "ClinicalDocumentDownloadGrant"("tokenHash");
CREATE INDEX "ClinicalDocumentDownloadGrant_documentId_accountId_expiresAt_idx"
  ON "ClinicalDocumentDownloadGrant"("documentId", "accountId", "expiresAt");
CREATE INDEX "ClinicalDocumentDownloadGrant_expiresAt_consumedAt_idx"
  ON "ClinicalDocumentDownloadGrant"("expiresAt", "consumedAt");
