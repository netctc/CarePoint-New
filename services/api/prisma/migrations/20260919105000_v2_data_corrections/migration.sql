CREATE TABLE "DataCorrectionRequest" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "entryVersion" INTEGER NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "version" INTEGER NOT NULL DEFAULT 1,
    "requesterActorId" TEXT NOT NULL,
    "algorithm" TEXT NOT NULL,
    "keyId" TEXT NOT NULL,
    "wrappedKey" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "resolvedByActorId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DataCorrectionRequest_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "DataCorrectionRequest_entryVersion_check" CHECK ("entryVersion" > 0),
    CONSTRAINT "DataCorrectionRequest_version_check" CHECK ("version" > 0),
    CONSTRAINT "DataCorrectionRequest_reasonCode_check" CHECK ("reasonCode" IN ('INCORRECT', 'DUPLICATE', 'OUTDATED', 'NEEDS_CLARIFICATION', 'OTHER')),
    CONSTRAINT "DataCorrectionRequest_status_check" CHECK ("status" IN ('OPEN', 'CLARIFICATION_REQUESTED', 'RESOLVED', 'REJECTED', 'CANCELLED'))
);

CREATE TABLE "CorrectionDecision" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actorAccountId" TEXT NOT NULL,
    "entryVersionBefore" INTEGER NOT NULL,
    "entryVersionAfter" INTEGER,
    "algorithm" TEXT NOT NULL,
    "keyId" TEXT NOT NULL,
    "wrappedKey" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CorrectionDecision_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CorrectionDecision_action_check" CHECK ("action" IN ('REQUEST_CLARIFICATION', 'RESOLVE_CORRECTION', 'REJECT_REQUEST')),
    CONSTRAINT "CorrectionDecision_entryVersionBefore_check" CHECK ("entryVersionBefore" > 0),
    CONSTRAINT "CorrectionDecision_entryVersionAfter_check" CHECK ("entryVersionAfter" IS NULL OR "entryVersionAfter" > 0)
);

CREATE INDEX "DataCorrectionRequest_patientId_status_createdAt_idx"
ON "DataCorrectionRequest"("patientId", "status", "createdAt");
CREATE INDEX "DataCorrectionRequest_entryId_status_createdAt_idx"
ON "DataCorrectionRequest"("entryId", "status", "createdAt");
CREATE UNIQUE INDEX "DataCorrectionRequest_one_active_entry_idx"
ON "DataCorrectionRequest"("entryId")
WHERE "status" IN ('OPEN', 'CLARIFICATION_REQUESTED');
CREATE INDEX "CorrectionDecision_requestId_createdAt_idx"
ON "CorrectionDecision"("requestId", "createdAt");

ALTER TABLE "DataCorrectionRequest" ADD CONSTRAINT "DataCorrectionRequest_patientId_fkey"
FOREIGN KEY ("patientId") REFERENCES "PatientProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DataCorrectionRequest" ADD CONSTRAINT "DataCorrectionRequest_entryId_fkey"
FOREIGN KEY ("entryId") REFERENCES "ClinicalProfileEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CorrectionDecision" ADD CONSTRAINT "CorrectionDecision_requestId_fkey"
FOREIGN KEY ("requestId") REFERENCES "DataCorrectionRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
