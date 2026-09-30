CREATE TABLE "PatientAvailabilityRequest" (
  "id" TEXT PRIMARY KEY, "patientId" TEXT NOT NULL, "providerId" TEXT NOT NULL,
  "serviceId" TEXT NOT NULL, "modality" "AppointmentModality" NOT NULL,
  "fromAt" TIMESTAMP(3) NOT NULL, "toAt" TIMESTAMP(3) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'WAITING', "activeKey" TEXT,
  "noticeConsentVersion" TEXT NOT NULL, "noticeConsentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "acceptedKeyHash" TEXT, "acceptedRequestHash" TEXT, "bookedAppointmentId" TEXT,
  "closedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "f3_request_patient_fk" FOREIGN KEY ("patientId") REFERENCES "PatientProfile"("id") ON DELETE RESTRICT,
  CONSTRAINT "f3_request_provider_fk" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT,
  CONSTRAINT "f3_request_service_fk" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE RESTRICT,
  CONSTRAINT "f3_request_appointment_fk" FOREIGN KEY ("bookedAppointmentId") REFERENCES "Appointment"("id") ON DELETE RESTRICT,
  CONSTRAINT "f3_request_window" CHECK ("toAt" > "fromAt" AND "toAt" - "fromAt" <= INTERVAL '62 days'),
  CONSTRAINT "f3_request_state" CHECK (
    ("status" = 'WAITING' AND "activeKey" IS NOT NULL AND "closedAt" IS NULL AND "bookedAppointmentId" IS NULL)
    OR ("status" IN ('WITHDRAWN','EXPIRED') AND "activeKey" IS NULL AND "closedAt" IS NOT NULL AND "bookedAppointmentId" IS NULL)
    OR ("status" = 'FULFILLED' AND "activeKey" IS NULL AND "closedAt" IS NOT NULL AND "bookedAppointmentId" IS NOT NULL)
  ),
  CONSTRAINT "f3_request_hash_pair" CHECK (("acceptedKeyHash" IS NULL) = ("acceptedRequestHash" IS NULL))
);
CREATE UNIQUE INDEX "PatientAvailabilityRequest_activeKey_key" ON "PatientAvailabilityRequest"("activeKey");
CREATE INDEX "f3_request_patient_idx" ON "PatientAvailabilityRequest"("patientId", "status", "createdAt", "id");
CREATE INDEX "f3_request_scope_idx" ON "PatientAvailabilityRequest"("patientId", "serviceId", "modality", "status", "fromAt", "toAt");
CREATE INDEX "f3_request_provider_idx" ON "PatientAvailabilityRequest"("providerId", "status", "toAt");
CREATE TABLE "PatientAvailabilityNotice" (
  "id" TEXT PRIMARY KEY, "requestId" TEXT NOT NULL, "patientId" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT TRUE, "version" INTEGER NOT NULL DEFAULT 1,
  "matchHash" TEXT NOT NULL, "matchCount" INTEGER NOT NULL, "firstAvailableAt" TIMESTAMP(3),
  "truncated" BOOLEAN NOT NULL DEFAULT FALSE, "checkedAt" TIMESTAMP(3) NOT NULL, "readAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "f3_notice_request_fk" FOREIGN KEY ("requestId") REFERENCES "PatientAvailabilityRequest"("id") ON DELETE CASCADE,
  CONSTRAINT "f3_notice_patient_fk" FOREIGN KEY ("patientId") REFERENCES "PatientProfile"("id") ON DELETE RESTRICT,
  CONSTRAINT "f3_notice_count" CHECK ("matchCount" BETWEEN 0 AND 100 AND "version" > 0)
);
CREATE UNIQUE INDEX "PatientAvailabilityNotice_requestId_key" ON "PatientAvailabilityNotice"("requestId");
CREATE INDEX "f3_notice_patient_idx" ON "PatientAvailabilityNotice"("patientId", "active", "checkedAt", "id");

CREATE FUNCTION carepoint_availability_request_guard() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW."patientId",NEW."providerId",NEW."serviceId",NEW."modality",NEW."fromAt",NEW."toAt",NEW."noticeConsentVersion",NEW."noticeConsentAt")
     IS DISTINCT FROM ROW(OLD."patientId",OLD."providerId",OLD."serviceId",OLD."modality",OLD."fromAt",OLD."toAt",OLD."noticeConsentVersion",OLD."noticeConsentAt") THEN
    RAISE EXCEPTION 'Availability request scope and consent are immutable' USING ERRCODE = '23514';
  END IF;
  IF OLD."status" <> 'WAITING' AND ROW(NEW."status",NEW."bookedAppointmentId",NEW."acceptedKeyHash",NEW."acceptedRequestHash")
      IS DISTINCT FROM ROW(OLD."status",OLD."bookedAppointmentId",OLD."acceptedKeyHash",OLD."acceptedRequestHash") THEN
    RAISE EXCEPTION 'Closed availability requests cannot be reopened or rebound' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "f3_request_scope_guard" BEFORE UPDATE ON "PatientAvailabilityRequest" FOR EACH ROW EXECUTE FUNCTION carepoint_availability_request_guard();
CREATE FUNCTION carepoint_availability_notice_close() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."status" <> 'WAITING' THEN
    UPDATE "PatientAvailabilityNotice" SET "active" = FALSE, "updatedAt" = CURRENT_TIMESTAMP WHERE "requestId" = NEW."id" AND "active";
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "f3_request_close_notice" AFTER UPDATE OF "status" ON "PatientAvailabilityRequest" FOR EACH ROW EXECUTE FUNCTION carepoint_availability_notice_close();

-- Runs inside the booking/rescheduling transaction. Cancellation does not reopen requests.
CREATE FUNCTION carepoint_availability_fulfil() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."status" IN ('REQUESTED','CONFIRMED') AND NEW."startsAt" > CURRENT_TIMESTAMP THEN
    UPDATE "PatientAvailabilityRequest" SET "status" = 'FULFILLED', "activeKey" = NULL,
      "bookedAppointmentId" = NEW."id", "closedAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
    WHERE "patientId" = NEW."patientId" AND "providerId" = NEW."providerId" AND "serviceId" = NEW."serviceId"
      AND "modality" = NEW."modality" AND "status" = 'WAITING'
      AND "toAt" > CURRENT_TIMESTAMP AND "fromAt" <= NEW."startsAt" AND "toAt" > NEW."startsAt";
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "f3_appointment_fulfil_requests" AFTER INSERT OR UPDATE OF "startsAt", "status" ON "Appointment" FOR EACH ROW EXECUTE FUNCTION carepoint_availability_fulfil();
