-- Additive F2 migration. No existing appointment or financial data is rewritten.
CREATE TABLE "PatientWaitlistEntry" (
  "id" TEXT PRIMARY KEY,
  "appointmentId" TEXT NOT NULL REFERENCES "Appointment"("id") ON DELETE RESTRICT,
  "patientId" TEXT NOT NULL REFERENCES "PatientProfile"("id") ON DELETE RESTRICT,
  "providerId" TEXT NOT NULL REFERENCES "Provider"("id") ON DELETE RESTRICT,
  "serviceId" TEXT NOT NULL REFERENCES "Service"("id") ON DELETE RESTRICT,
  "modality" "AppointmentModality" NOT NULL,
  "appointmentUpdatedAt" TIMESTAMP(3) NOT NULL,
  "fromAt" TIMESTAMP(3) NOT NULL,
  "toAt" TIMESTAMP(3) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'WAITING',
  "activeKey" TEXT,
  "closureReason" TEXT,
  "closedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PatientWaitlistEntry_window_check" CHECK ("toAt" > "fromAt"),
  CONSTRAINT "PatientWaitlistEntry_status_check" CHECK ("status" IN ('WAITING','WITHDRAWN','FULFILLED','CLOSED','EXPIRED')),
  CONSTRAINT "PatientWaitlistEntry_active_check" CHECK (("status" = 'WAITING' AND "activeKey" = "appointmentId" AND "closedAt" IS NULL) OR ("status" <> 'WAITING' AND "activeKey" IS NULL AND "closedAt" IS NOT NULL))
);
CREATE UNIQUE INDEX "PatientWaitlistEntry_activeKey_key" ON "PatientWaitlistEntry"("activeKey");
CREATE INDEX "PatientWaitlistEntry_patientId_status_createdAt_idx" ON "PatientWaitlistEntry"("patientId","status","createdAt");
CREATE INDEX "PatientWaitlistEntry_providerId_status_toAt_idx" ON "PatientWaitlistEntry"("providerId","status","toAt");
CREATE INDEX "PatientWaitlistEntry_appointmentId_status_idx" ON "PatientWaitlistEntry"("appointmentId","status");

CREATE TABLE "PatientAppointmentChange" (
  "id" TEXT PRIMARY KEY,
  "appointmentId" TEXT NOT NULL REFERENCES "Appointment"("id") ON DELETE RESTRICT,
  "patientId" TEXT NOT NULL REFERENCES "PatientProfile"("id") ON DELETE RESTRICT,
  "actorId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT,
  "keyHash" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "fromSlotId" TEXT REFERENCES "AvailabilitySlot"("id") ON DELETE RESTRICT,
  "toSlotId" TEXT NOT NULL REFERENCES "AvailabilitySlot"("id") ON DELETE RESTRICT,
  "fromStartsAt" TIMESTAMP(3) NOT NULL,
  "fromEndsAt" TIMESTAMP(3) NOT NULL,
  "toStartsAt" TIMESTAMP(3) NOT NULL,
  "toEndsAt" TIMESTAMP(3) NOT NULL,
  "waitlistEntryId" TEXT REFERENCES "PatientWaitlistEntry"("id") ON DELETE RESTRICT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "PatientAppointmentChange_keyHash_key" ON "PatientAppointmentChange"("keyHash");
CREATE INDEX "PatientAppointmentChange_appointmentId_createdAt_idx" ON "PatientAppointmentChange"("appointmentId","createdAt");

-- Retained as append-only operational history, separate from clinical records.
CREATE FUNCTION carepoint_f2_immutable_change() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Appointment change history is append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER carepoint_f2_change_immutable BEFORE UPDATE OR DELETE ON "PatientAppointmentChange"
FOR EACH ROW EXECUTE FUNCTION carepoint_f2_immutable_change();

-- All appointment writers (including the existing Admin path) invalidate stale requests.
CREATE FUNCTION carepoint_f2_close_waitlist() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status OR NEW."startsAt" IS DISTINCT FROM OLD."startsAt" OR NEW."slotId" IS DISTINCT FROM OLD."slotId" THEN
    UPDATE "PatientWaitlistEntry" SET "status" = 'CLOSED', "activeKey" = NULL,
      "closureReason" = 'APPOINTMENT_CHANGED', "closedAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
    WHERE "appointmentId" = NEW.id AND "status" = 'WAITING';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER carepoint_f2_waitlist_appointment_changed AFTER UPDATE OF status, "startsAt", "slotId" ON "Appointment"
FOR EACH ROW EXECUTE FUNCTION carepoint_f2_close_waitlist();
