-- CarePoint Next Slice 3: secure telemedicine session state, consent link and encrypted E2EE key material.

CREATE TYPE "TelehealthSessionStatus" AS ENUM ('WAITING', 'READY', 'ACTIVE', 'ENDED', 'CANCELLED');

CREATE TABLE "TelehealthSession" (
  "id" TEXT NOT NULL,
  "appointmentId" TEXT NOT NULL,
  "roomName" TEXT NOT NULL,
  "status" "TelehealthSessionStatus" NOT NULL DEFAULT 'WAITING',
  "consentId" TEXT,
  "consentVersion" TEXT,
  "patientReadyAt" TIMESTAMP(3),
  "providerReadyAt" TIMESTAMP(3),
  "patientReadiness" JSONB,
  "providerReadiness" JSONB,
  "startedAt" TIMESTAMP(3),
  "endedAt" TIMESTAMP(3),
  "recordingEnabled" BOOLEAN NOT NULL DEFAULT false,
  "e2eeVersion" INTEGER NOT NULL DEFAULT 1,
  "e2eeAlgorithm" TEXT NOT NULL DEFAULT 'AES-256-GCM',
  "e2eeKeyId" TEXT NOT NULL,
  "e2eeWrappedKey" TEXT NOT NULL,
  "e2eeIv" TEXT NOT NULL,
  "e2eeCiphertext" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TelehealthSession_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TelehealthSession_recording_disabled_check" CHECK ("recordingEnabled" = false)
);

CREATE UNIQUE INDEX "TelehealthSession_appointmentId_key" ON "TelehealthSession"("appointmentId");
CREATE UNIQUE INDEX "TelehealthSession_roomName_key" ON "TelehealthSession"("roomName");
CREATE UNIQUE INDEX "TelehealthSession_consentId_key" ON "TelehealthSession"("consentId");
CREATE INDEX "TelehealthSession_status_createdAt_idx" ON "TelehealthSession"("status", "createdAt");

ALTER TABLE "TelehealthSession" ADD CONSTRAINT "TelehealthSession_appointmentId_fkey"
  FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TelehealthSession" ADD CONSTRAINT "TelehealthSession_consentId_fkey"
  FOREIGN KEY ("consentId") REFERENCES "Consent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Cancellation/no-show is a hard stop for issuing any new telemedicine credentials.
CREATE OR REPLACE FUNCTION carepoint_cancel_telehealth_session() RETURNS trigger AS $$
BEGIN
  IF NEW."status" IN ('CANCELLED', 'NO_SHOW') AND OLD."status" IS DISTINCT FROM NEW."status" THEN
    UPDATE "TelehealthSession"
      SET "status" = 'CANCELLED', "endedAt" = COALESCE("endedAt", CURRENT_TIMESTAMP), "updatedAt" = CURRENT_TIMESTAMP
      WHERE "appointmentId" = NEW."id" AND "status" NOT IN ('ENDED', 'CANCELLED');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Appointment_cancel_telehealth_session"
AFTER UPDATE OF "status" ON "Appointment"
FOR EACH ROW EXECUTE FUNCTION carepoint_cancel_telehealth_session();
