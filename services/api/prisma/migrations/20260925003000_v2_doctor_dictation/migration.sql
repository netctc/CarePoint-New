-- CarePoint V2 DOC-088 — encrypted, human-confirmed clinical dictation drafts.
-- Audio is never persisted. Only encrypted recognized text is stored temporarily.

CREATE TABLE "DictationJob" (
  "id" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "appointmentId" TEXT NOT NULL,
  "targetField" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "source" TEXT NOT NULL DEFAULT 'DEVICE_SPEECH_RECOGNITION',
  "locale" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "confirmedAt" TIMESTAMP(3),
  "discardedAt" TIMESTAMP(3),
  "createdByActorId" TEXT NOT NULL,
  "algorithm" TEXT NOT NULL,
  "keyId" TEXT NOT NULL,
  "wrappedKey" TEXT NOT NULL,
  "iv" TEXT NOT NULL,
  "ciphertext" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DictationJob_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DictationJob_status_check"
    CHECK ("status" IN ('DRAFT', 'CONFIRMED', 'DISCARDED', 'EXPIRED')),
  CONSTRAINT "DictationJob_targetField_check"
    CHECK ("targetField" IN ('CHIEF_COMPLAINT', 'SUBJECTIVE', 'OBJECTIVE', 'ASSESSMENT', 'PLAN')),
  CONSTRAINT "DictationJob_source_check"
    CHECK ("source" = 'DEVICE_SPEECH_RECOGNITION')
);

CREATE UNIQUE INDEX "DictationJob_idempotencyKey_key"
ON "DictationJob"("idempotencyKey");

CREATE INDEX "DictationJob_providerId_status_expiresAt_idx"
ON "DictationJob"("providerId", "status", "expiresAt");

CREATE INDEX "DictationJob_appointmentId_createdAt_idx"
ON "DictationJob"("appointmentId", "createdAt");

CREATE INDEX "DictationJob_patientId_createdAt_idx"
ON "DictationJob"("patientId", "createdAt");

ALTER TABLE "DictationJob"
ADD CONSTRAINT "DictationJob_providerId_fkey"
FOREIGN KEY ("providerId") REFERENCES "Provider"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DictationJob"
ADD CONSTRAINT "DictationJob_patientId_fkey"
FOREIGN KEY ("patientId") REFERENCES "PatientProfile"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DictationJob"
ADD CONSTRAINT "DictationJob_appointmentId_fkey"
FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "dictation_job_payload_immutable"()
RETURNS trigger AS $$
BEGIN
  IF NEW."providerId" IS DISTINCT FROM OLD."providerId"
     OR NEW."patientId" IS DISTINCT FROM OLD."patientId"
     OR NEW."appointmentId" IS DISTINCT FROM OLD."appointmentId"
     OR NEW."targetField" IS DISTINCT FROM OLD."targetField"
     OR NEW."source" IS DISTINCT FROM OLD."source"
     OR NEW."locale" IS DISTINCT FROM OLD."locale"
     OR NEW."expiresAt" IS DISTINCT FROM OLD."expiresAt"
     OR NEW."algorithm" IS DISTINCT FROM OLD."algorithm"
     OR NEW."keyId" IS DISTINCT FROM OLD."keyId"
     OR NEW."wrappedKey" IS DISTINCT FROM OLD."wrappedKey"
     OR NEW."iv" IS DISTINCT FROM OLD."iv"
     OR NEW."ciphertext" IS DISTINCT FROM OLD."ciphertext"
     OR NEW."createdByActorId" IS DISTINCT FROM OLD."createdByActorId"
  THEN
    RAISE EXCEPTION 'DictationJob payload is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "DictationJob_payload_immutable"
BEFORE UPDATE ON "DictationJob"
FOR EACH ROW EXECUTE FUNCTION "dictation_job_payload_immutable"();
