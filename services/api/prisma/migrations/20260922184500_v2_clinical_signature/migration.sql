CREATE TABLE "ClinicalSignature" (
  "id" TEXT NOT NULL,
  "encounterId" TEXT NOT NULL,
  "recordId" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "policyVersion" TEXT NOT NULL DEFAULT 'DOCTOR_ENCOUNTER_SIGNATURE_V1',
  "payloadDigest" TEXT NOT NULL,
  "signatureAlgorithm" TEXT NOT NULL,
  "signatureKeyId" TEXT NOT NULL,
  "signature" TEXT NOT NULL,
  "signedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ClinicalSignature_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ClinicalSignature_policy_check" CHECK ("policyVersion" = 'DOCTOR_ENCOUNTER_SIGNATURE_V1')
);

CREATE UNIQUE INDEX "ClinicalSignature_encounterId_recordId_key"
  ON "ClinicalSignature"("encounterId", "recordId");
CREATE INDEX "ClinicalSignature_provider_signed_idx"
  ON "ClinicalSignature"("providerId", "signedAt");
CREATE INDEX "ClinicalSignature_patient_signed_idx"
  ON "ClinicalSignature"("patientId", "signedAt");
CREATE INDEX "ClinicalSignature_actor_signed_idx"
  ON "ClinicalSignature"("actorId", "signedAt");

ALTER TABLE "ClinicalSignature"
  ADD CONSTRAINT "ClinicalSignature_encounterId_fkey"
  FOREIGN KEY ("encounterId") REFERENCES "Appointment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClinicalSignature"
  ADD CONSTRAINT "ClinicalSignature_recordId_fkey"
  FOREIGN KEY ("recordId") REFERENCES "ClinicalRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClinicalSignature"
  ADD CONSTRAINT "ClinicalSignature_patientId_fkey"
  FOREIGN KEY ("patientId") REFERENCES "PatientProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClinicalSignature"
  ADD CONSTRAINT "ClinicalSignature_providerId_fkey"
  FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClinicalSignature"
  ADD CONSTRAINT "ClinicalSignature_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClinicalSignature"
  ADD CONSTRAINT "ClinicalSignature_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "AuthSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION carepoint_reject_clinical_signature_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'clinical signatures are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ClinicalSignature_append_only"
BEFORE UPDATE OR DELETE ON "ClinicalSignature"
FOR EACH ROW EXECUTE FUNCTION carepoint_reject_clinical_signature_mutation();

REVOKE UPDATE, DELETE ON "ClinicalSignature" FROM PUBLIC;
