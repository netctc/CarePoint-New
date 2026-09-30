-- Release 1 FR-NTF-001: durable booking/status lifecycle signals and reminder schedules.

CREATE TABLE "AppointmentLifecycleSignal" (
  "id" BIGSERIAL NOT NULL,
  "appointmentId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "fromStatus" TEXT,
  "toStatus" TEXT,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "previousStartsAt" TIMESTAMP(3),
  "appointmentUpdatedAt" TIMESTAMP(3) NOT NULL,
  "previousUpdatedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMP(3),
  CONSTRAINT "AppointmentLifecycleSignal_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AppointmentLifecycleSignal_processedAt_id_idx"
  ON "AppointmentLifecycleSignal"("processedAt", "id");
CREATE INDEX "AppointmentLifecycleSignal_appointmentId_createdAt_idx"
  ON "AppointmentLifecycleSignal"("appointmentId", "createdAt");

CREATE TABLE "AppointmentReminderSchedule" (
  "id" BIGSERIAL NOT NULL,
  "appointmentId" TEXT NOT NULL,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "appointmentUpdatedAt" TIMESTAMP(3) NOT NULL,
  "offsetMinutes" INTEGER NOT NULL,
  "dueAt" TIMESTAMP(3) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  CONSTRAINT "AppointmentReminderSchedule_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AppointmentReminderSchedule_appointmentId_appointmentUpdatedAt_offsetMinutes_key"
  ON "AppointmentReminderSchedule"("appointmentId", "appointmentUpdatedAt", "offsetMinutes");
CREATE INDEX "AppointmentReminderSchedule_status_dueAt_idx"
  ON "AppointmentReminderSchedule"("status", "dueAt");
CREATE INDEX "AppointmentReminderSchedule_appointmentId_status_idx"
  ON "AppointmentReminderSchedule"("appointmentId", "status");

CREATE OR REPLACE FUNCTION carepoint_capture_appointment_lifecycle()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status IN ('REQUESTED', 'CONFIRMED') THEN
      INSERT INTO "AppointmentLifecycleSignal" (
        "appointmentId",
        "eventType",
        "toStatus",
        "startsAt",
        "appointmentUpdatedAt"
      ) VALUES (
        NEW.id,
        'SCHEDULED',
        NEW.status::text,
        NEW."startsAt",
        NEW."updatedAt"
      );
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      INSERT INTO "AppointmentLifecycleSignal" (
        "appointmentId",
        "eventType",
        "fromStatus",
        "toStatus",
        "startsAt",
        "previousStartsAt",
        "appointmentUpdatedAt",
        "previousUpdatedAt"
      ) VALUES (
        NEW.id,
        'STATUS_CHANGED',
        OLD.status::text,
        NEW.status::text,
        NEW."startsAt",
        OLD."startsAt",
        NEW."updatedAt",
        OLD."updatedAt"
      );
    ELSIF NEW."startsAt" IS DISTINCT FROM OLD."startsAt" AND NEW.status IN ('REQUESTED', 'CONFIRMED') THEN
      INSERT INTO "AppointmentLifecycleSignal" (
        "appointmentId",
        "eventType",
        "fromStatus",
        "toStatus",
        "startsAt",
        "previousStartsAt",
        "appointmentUpdatedAt",
        "previousUpdatedAt"
      ) VALUES (
        NEW.id,
        'RESCHEDULED',
        OLD.status::text,
        NEW.status::text,
        NEW."startsAt",
        OLD."startsAt",
        NEW."updatedAt",
        OLD."updatedAt"
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS carepoint_appointment_lifecycle_trigger ON "Appointment";
CREATE TRIGGER carepoint_appointment_lifecycle_trigger
AFTER INSERT OR UPDATE OF status, "startsAt" ON "Appointment"
FOR EACH ROW
EXECUTE FUNCTION carepoint_capture_appointment_lifecycle();
