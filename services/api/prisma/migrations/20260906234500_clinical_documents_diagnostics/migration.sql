CREATE TYPE "ClinicalDocumentKind" AS ENUM ('CLINICAL_ATTACHMENT', 'LAB_REPORT', 'IMAGING_REPORT', 'IMAGING_REFERENCE', 'PATHOLOGY_REPORT', 'PATIENT_UPLOAD', 'OTHER');
CREATE TYPE "ClinicalDocumentStatus" AS ENUM ('AVAILABLE', 'SUPERSEDED', 'REMOVED');
CREATE TYPE "DocumentStorageMode" AS ENUM ('ENCRYPTED_BLOB', 'EXTERNAL_REFERENCE');
CREATE TYPE "DiagnosticReportType" AS ENUM ('IMAGING', 'PATHOLOGY', 'OTHER');
CREATE TYPE "DiagnosticReportStatus" AS ENUM ('DRAFT', 'FINAL', 'RELEASED');

CREATE TABLE "ClinicalDocument" (
  "id" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "providerId" TEXT,
  "encounterRef" TEXT,
  "orderId" TEXT,
  "kind" "ClinicalDocumentKind" NOT NULL,
  "status" "ClinicalDocumentStatus" NOT NULL DEFAULT 'AVAILABLE',
  "storageMode" "DocumentStorageMode" NOT NULL,
  "storageProvider" TEXT NOT NULL,
  "objectKey" TEXT,
  "mediaType" TEXT,
  "byteLength" INTEGER,
  "contentDigest" TEXT,
  "blobAlgorithm" TEXT,
  "blobKeyId" TEXT,
  "blobWrappedKey" TEXT,
  "blobIv" TEXT,
  "metadataAlgorithm" TEXT NOT NULL,
  "metadataKeyId" TEXT NOT NULL,
  "metadataWrappedKey" TEXT NOT NULL,
  "metadataIv" TEXT NOT NULL,
  "metadataCiphertext" TEXT NOT NULL,
  "releasedToPatient" BOOLEAN NOT NULL DEFAULT false,
  "createdByAccountId" TEXT NOT NULL,
  "releasedAt" TIMESTAMP(3),
  "removedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ClinicalDocument_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ClinicalDocument_objectKey_key" ON "ClinicalDocument"("objectKey");
CREATE INDEX "ClinicalDocument_patientId_status_createdAt_idx" ON "ClinicalDocument"("patientId", "status", "createdAt");
CREATE INDEX "ClinicalDocument_providerId_createdAt_idx" ON "ClinicalDocument"("providerId", "createdAt");
CREATE INDEX "ClinicalDocument_encounterRef_kind_status_idx" ON "ClinicalDocument"("encounterRef", "kind", "status");
CREATE INDEX "ClinicalDocument_orderId_kind_status_idx" ON "ClinicalDocument"("orderId", "kind", "status");

CREATE TABLE "DiagnosticReport" (
  "id" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "encounterRef" TEXT NOT NULL,
  "documentId" TEXT,
  "type" "DiagnosticReportType" NOT NULL,
  "status" "DiagnosticReportStatus" NOT NULL DEFAULT 'DRAFT',
  "algorithm" TEXT NOT NULL,
  "keyId" TEXT NOT NULL,
  "wrappedKey" TEXT NOT NULL,
  "iv" TEXT NOT NULL,
  "ciphertext" TEXT NOT NULL,
  "payloadDigest" TEXT NOT NULL,
  "signatureAlgorithm" TEXT,
  "signatureKeyId" TEXT,
  "signature" TEXT,
  "finalizedAt" TIMESTAMP(3),
  "releasedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DiagnosticReport_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "DiagnosticReport_patientId_status_createdAt_idx" ON "DiagnosticReport"("patientId", "status", "createdAt");
CREATE INDEX "DiagnosticReport_providerId_createdAt_idx" ON "DiagnosticReport"("providerId", "createdAt");
CREATE INDEX "DiagnosticReport_encounterRef_type_status_idx" ON "DiagnosticReport"("encounterRef", "type", "status");
CREATE INDEX "DiagnosticReport_documentId_idx" ON "DiagnosticReport"("documentId");
