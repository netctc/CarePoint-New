CREATE TABLE "ServiceSignature" (
  "id" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "requestDigest" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "appointmentId" TEXT NOT NULL,
  "signerType" TEXT NOT NULL,
  "confirmationMethod" TEXT NOT NULL,
  "serviceSummaryDigest" TEXT NOT NULL,
  "appointmentDigest" TEXT NOT NULL,
  "algorithm" TEXT NOT NULL,
  "keyId" TEXT NOT NULL,
  "wrappedKey" TEXT NOT NULL,
  "iv" TEXT NOT NULL,
  "ciphertext" TEXT NOT NULL,
  "confirmedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ServiceSignature_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ServiceSignature_signer_type_ck" CHECK ("signerType" IN ('PATIENT','REPRESENTATIVE')),
  CONSTRAINT "ServiceSignature_confirmation_method_ck" CHECK ("confirmationMethod" IN ('TYPED_CONFIRMATION','DRAWN_SIGNATURE')),
  CONSTRAINT "ServiceSignature_service_summary_digest_ck" CHECK ("serviceSummaryDigest" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "ServiceSignature_appointment_digest_ck" CHECK ("appointmentDigest" ~ '^[a-f0-9]{64}$')
);

CREATE UNIQUE INDEX "ServiceSignature_idempotencyKey_key" ON "ServiceSignature"("idempotencyKey");
CREATE INDEX "ServiceSignature_appointmentId_createdAt_idx" ON "ServiceSignature"("appointmentId", "createdAt");
CREATE INDEX "ServiceSignature_patientId_createdAt_idx" ON "ServiceSignature"("patientId", "createdAt");
CREATE INDEX "ServiceSignature_providerId_patientId_createdAt_idx" ON "ServiceSignature"("providerId", "patientId", "createdAt");

ALTER TABLE "ServiceSignature" ADD CONSTRAINT "ServiceSignature_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "PatientProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ServiceSignature" ADD CONSTRAINT "ServiceSignature_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ServiceSignature" ADD CONSTRAINT "ServiceSignature_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION carepoint_reject_service_signature_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Service signatures are append-only';
END;
$$;

CREATE TRIGGER "ServiceSignature_append_only_trg"
BEFORE UPDATE OR DELETE ON "ServiceSignature"
FOR EACH ROW EXECUTE FUNCTION carepoint_reject_service_signature_mutation();

REVOKE UPDATE, DELETE ON "ServiceSignature" FROM PUBLIC;
