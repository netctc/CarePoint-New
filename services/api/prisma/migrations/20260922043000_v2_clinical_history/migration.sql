CREATE TABLE "Hospitalization" (
  "id" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "admittedOn" DATE NOT NULL,
  "dischargedOn" DATE,
  "logicalKey" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "requestDigest" TEXT NOT NULL,
  "sourceType" TEXT NOT NULL,
  "sourceActorId" TEXT,
  "algorithm" TEXT NOT NULL,
  "keyId" TEXT NOT NULL,
  "wrappedKey" TEXT NOT NULL,
  "iv" TEXT NOT NULL,
  "ciphertext" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Hospitalization_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Hospitalization_date_interval_check" CHECK ("dischargedOn" IS NULL OR "dischargedOn" >= "admittedOn")
);

CREATE TABLE "HospitalizationRevision" (
  "id" TEXT NOT NULL,
  "hospitalizationId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "status" TEXT NOT NULL,
  "sourceType" TEXT NOT NULL,
  "sourceActorId" TEXT,
  "algorithm" TEXT NOT NULL,
  "keyId" TEXT NOT NULL,
  "wrappedKey" TEXT NOT NULL,
  "iv" TEXT NOT NULL,
  "ciphertext" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HospitalizationRevision_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Immunization" (
  "id" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "status" TEXT NOT NULL DEFAULT 'COMPLETED',
  "occurredOn" DATE NOT NULL,
  "logicalKey" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "requestDigest" TEXT NOT NULL,
  "sourceType" TEXT NOT NULL,
  "sourceActorId" TEXT,
  "algorithm" TEXT NOT NULL,
  "keyId" TEXT NOT NULL,
  "wrappedKey" TEXT NOT NULL,
  "iv" TEXT NOT NULL,
  "ciphertext" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Immunization_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ImmunizationRevision" (
  "id" TEXT NOT NULL,
  "immunizationId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "status" TEXT NOT NULL,
  "sourceType" TEXT NOT NULL,
  "sourceActorId" TEXT,
  "algorithm" TEXT NOT NULL,
  "keyId" TEXT NOT NULL,
  "wrappedKey" TEXT NOT NULL,
  "iv" TEXT NOT NULL,
  "ciphertext" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ImmunizationRevision_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Hospitalization_idempotencyKey_key" ON "Hospitalization"("idempotencyKey");
CREATE INDEX "Hospitalization_patientId_logicalKey_idx" ON "Hospitalization"("patientId", "logicalKey");
CREATE INDEX "Hospitalization_patientId_admittedOn_idx" ON "Hospitalization"("patientId", "admittedOn");
CREATE INDEX "Hospitalization_patientId_status_admittedOn_idx" ON "Hospitalization"("patientId", "status", "admittedOn");
CREATE UNIQUE INDEX "HospitalizationRevision_hospitalizationId_version_key" ON "HospitalizationRevision"("hospitalizationId", "version");
CREATE INDEX "HospitalizationRevision_hospitalizationId_createdAt_idx" ON "HospitalizationRevision"("hospitalizationId", "createdAt");

CREATE UNIQUE INDEX "Immunization_idempotencyKey_key" ON "Immunization"("idempotencyKey");
CREATE UNIQUE INDEX "Immunization_patientId_logicalKey_key" ON "Immunization"("patientId", "logicalKey");
CREATE INDEX "Immunization_patientId_occurredOn_idx" ON "Immunization"("patientId", "occurredOn");
CREATE INDEX "Immunization_patientId_status_occurredOn_idx" ON "Immunization"("patientId", "status", "occurredOn");
CREATE UNIQUE INDEX "ImmunizationRevision_immunizationId_version_key" ON "ImmunizationRevision"("immunizationId", "version");
CREATE INDEX "ImmunizationRevision_immunizationId_createdAt_idx" ON "ImmunizationRevision"("immunizationId", "createdAt");

ALTER TABLE "Hospitalization" ADD CONSTRAINT "Hospitalization_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "PatientProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HospitalizationRevision" ADD CONSTRAINT "HospitalizationRevision_hospitalizationId_fkey" FOREIGN KEY ("hospitalizationId") REFERENCES "Hospitalization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Immunization" ADD CONSTRAINT "Immunization_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "PatientProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ImmunizationRevision" ADD CONSTRAINT "ImmunizationRevision_immunizationId_fkey" FOREIGN KEY ("immunizationId") REFERENCES "Immunization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION carepoint_reject_clinical_history_revision_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'clinical history revisions are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "HospitalizationRevision_append_only"
BEFORE UPDATE OR DELETE ON "HospitalizationRevision"
FOR EACH ROW EXECUTE FUNCTION carepoint_reject_clinical_history_revision_mutation();

CREATE TRIGGER "ImmunizationRevision_append_only"
BEFORE UPDATE OR DELETE ON "ImmunizationRevision"
FOR EACH ROW EXECUTE FUNCTION carepoint_reject_clinical_history_revision_mutation();

CREATE OR REPLACE FUNCTION carepoint_reject_clinical_history_delete()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'clinical history records cannot be hard deleted';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Hospitalization_no_hard_delete"
BEFORE DELETE ON "Hospitalization"
FOR EACH ROW EXECUTE FUNCTION carepoint_reject_clinical_history_delete();

CREATE TRIGGER "Immunization_no_hard_delete"
BEFORE DELETE ON "Immunization"
FOR EACH ROW EXECUTE FUNCTION carepoint_reject_clinical_history_delete();

REVOKE UPDATE, DELETE ON "HospitalizationRevision" FROM PUBLIC;
REVOKE UPDATE, DELETE ON "ImmunizationRevision" FROM PUBLIC;
REVOKE DELETE ON "Hospitalization" FROM PUBLIC;
REVOKE DELETE ON "Immunization" FROM PUBLIC;
