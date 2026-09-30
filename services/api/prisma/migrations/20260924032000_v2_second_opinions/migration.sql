-- CarePoint V2 BE-034 / DOC-079 — governed second-opinion requests.
-- The clinical snapshot and response are encrypted; snapshot identity/content fields are immutable.

CREATE TABLE "SecondOpinionRequest" (
  "id" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "referringProviderId" TEXT NOT NULL,
  "destinationProviderId" TEXT NOT NULL,
  "referralId" TEXT NOT NULL,
  "scopes" JSONB NOT NULL,
  "consentIds" JSONB NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'REQUESTED',
  "snapshotHash" TEXT NOT NULL,
  "snapshotAlgorithm" TEXT NOT NULL,
  "snapshotKeyId" TEXT NOT NULL,
  "snapshotWrappedKey" TEXT NOT NULL,
  "snapshotIv" TEXT NOT NULL,
  "snapshotCiphertext" TEXT NOT NULL,
  "responseAlgorithm" TEXT,
  "responseKeyId" TEXT,
  "responseWrappedKey" TEXT,
  "responseIv" TEXT,
  "responseCiphertext" TEXT,
  "respondedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SecondOpinionRequest_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SecondOpinionRequest_status_check" CHECK ("status" IN ('REQUESTED','RESPONDED'))
);

CREATE UNIQUE INDEX "SecondOpinionRequest_idempotencyKey_key" ON "SecondOpinionRequest"("idempotencyKey");
CREATE UNIQUE INDEX "SecondOpinionRequest_referralId_key" ON "SecondOpinionRequest"("referralId");
CREATE INDEX "SecondOpinionRequest_patientId_createdAt_idx" ON "SecondOpinionRequest"("patientId","createdAt");
CREATE INDEX "SecondOpinionRequest_referringProviderId_status_createdAt_idx" ON "SecondOpinionRequest"("referringProviderId","status","createdAt");
CREATE INDEX "SecondOpinionRequest_destinationProviderId_status_expiresAt_idx" ON "SecondOpinionRequest"("destinationProviderId","status","expiresAt");

ALTER TABLE "SecondOpinionRequest" ADD CONSTRAINT "SecondOpinionRequest_patientId_fkey"
FOREIGN KEY ("patientId") REFERENCES "PatientProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SecondOpinionRequest" ADD CONSTRAINT "SecondOpinionRequest_referringProviderId_fkey"
FOREIGN KEY ("referringProviderId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SecondOpinionRequest" ADD CONSTRAINT "SecondOpinionRequest_destinationProviderId_fkey"
FOREIGN KEY ("destinationProviderId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SecondOpinionRequest" ADD CONSTRAINT "SecondOpinionRequest_referralId_fkey"
FOREIGN KEY ("referralId") REFERENCES "Referral"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "SecondOpinionRequest_snapshot_immutable"()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."patientId" IS DISTINCT FROM OLD."patientId"
     OR NEW."referringProviderId" IS DISTINCT FROM OLD."referringProviderId"
     OR NEW."destinationProviderId" IS DISTINCT FROM OLD."destinationProviderId"
     OR NEW."referralId" IS DISTINCT FROM OLD."referralId"
     OR NEW."scopes" IS DISTINCT FROM OLD."scopes"
     OR NEW."consentIds" IS DISTINCT FROM OLD."consentIds"
     OR NEW."expiresAt" IS DISTINCT FROM OLD."expiresAt"
     OR NEW."snapshotHash" IS DISTINCT FROM OLD."snapshotHash"
     OR NEW."snapshotAlgorithm" IS DISTINCT FROM OLD."snapshotAlgorithm"
     OR NEW."snapshotKeyId" IS DISTINCT FROM OLD."snapshotKeyId"
     OR NEW."snapshotWrappedKey" IS DISTINCT FROM OLD."snapshotWrappedKey"
     OR NEW."snapshotIv" IS DISTINCT FROM OLD."snapshotIv"
     OR NEW."snapshotCiphertext" IS DISTINCT FROM OLD."snapshotCiphertext"
  THEN
    RAISE EXCEPTION 'Second-opinion clinical snapshot is immutable';
  END IF;
  IF OLD."responseCiphertext" IS NOT NULL AND (
     NEW."responseCiphertext" IS DISTINCT FROM OLD."responseCiphertext"
     OR NEW."responseAlgorithm" IS DISTINCT FROM OLD."responseAlgorithm"
     OR NEW."responseKeyId" IS DISTINCT FROM OLD."responseKeyId"
     OR NEW."responseWrappedKey" IS DISTINCT FROM OLD."responseWrappedKey"
     OR NEW."responseIv" IS DISTINCT FROM OLD."responseIv"
     OR NEW."respondedAt" IS DISTINCT FROM OLD."respondedAt"
  ) THEN
    RAISE EXCEPTION 'Second-opinion response is immutable once recorded';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "SecondOpinionRequest_snapshot_immutable"
BEFORE UPDATE ON "SecondOpinionRequest"
FOR EACH ROW EXECUTE FUNCTION "SecondOpinionRequest_snapshot_immutable"();

CREATE OR REPLACE FUNCTION "SecondOpinionRequest_no_delete"()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Second-opinion requests are retained as clinical coordination evidence';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "SecondOpinionRequest_no_delete"
BEFORE DELETE ON "SecondOpinionRequest"
FOR EACH ROW EXECUTE FUNCTION "SecondOpinionRequest_no_delete"();
