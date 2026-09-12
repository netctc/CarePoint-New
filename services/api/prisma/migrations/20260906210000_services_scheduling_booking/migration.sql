-- CarePoint Next Slice 2: provider services, recurring availability and concurrency-safe booking.

CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE TYPE "AvailabilitySlotStatus" AS ENUM ('OPEN', 'BLOCKED');

ALTER TABLE "Service"
  ADD COLUMN "labels" JSONB,
  ADD COLUMN "descriptionLabels" JSONB;
CREATE INDEX "Service_providerId_active_idx" ON "Service"("providerId", "active");

ALTER TABLE "ServiceModality"
  ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true;
CREATE INDEX "ServiceModality_modality_active_idx" ON "ServiceModality"("modality", "active");

CREATE TABLE "AvailabilityRule" (
  "id" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "serviceId" TEXT NOT NULL,
  "modality" "AppointmentModality" NOT NULL,
  "timezone" TEXT NOT NULL,
  "weekday" INTEGER NOT NULL,
  "startMinute" INTEGER NOT NULL,
  "endMinute" INTEGER NOT NULL,
  "intervalMinutes" INTEGER NOT NULL,
  "slotCapacity" INTEGER NOT NULL DEFAULT 1,
  "effectiveFrom" DATE NOT NULL,
  "effectiveUntil" DATE,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AvailabilityRule_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AvailabilityRule_weekday_check" CHECK ("weekday" BETWEEN 0 AND 6),
  CONSTRAINT "AvailabilityRule_minutes_check" CHECK ("startMinute" >= 0 AND "startMinute" < "endMinute" AND "endMinute" <= 1440),
  CONSTRAINT "AvailabilityRule_interval_check" CHECK ("intervalMinutes" > 0),
  CONSTRAINT "AvailabilityRule_capacity_check" CHECK ("slotCapacity" > 0)
);
CREATE INDEX "AvailabilityRule_providerId_active_weekday_idx" ON "AvailabilityRule"("providerId", "active", "weekday");
CREATE INDEX "AvailabilityRule_serviceId_modality_active_idx" ON "AvailabilityRule"("serviceId", "modality", "active");

ALTER TABLE "AvailabilitySlot"
  ADD COLUMN "modality" "AppointmentModality",
  ADD COLUMN "bookedCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "status" "AvailabilitySlotStatus" NOT NULL DEFAULT 'OPEN',
  ADD COLUMN "sourceRuleId" TEXT,
  ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Legacy development slots without a service cannot participate in the new inventory model.
DELETE FROM "AvailabilitySlot" WHERE "serviceId" IS NULL;
UPDATE "AvailabilitySlot" s
SET "modality" = sm."modality"
FROM "ServiceModality" sm
WHERE s."serviceId" = sm."serviceId" AND s."modality" IS NULL;
DELETE FROM "AvailabilitySlot" WHERE "modality" IS NULL;
ALTER TABLE "AvailabilitySlot" ALTER COLUMN "serviceId" SET NOT NULL;
ALTER TABLE "AvailabilitySlot" ALTER COLUMN "modality" SET NOT NULL;
ALTER TABLE "AvailabilitySlot"
  ADD CONSTRAINT "AvailabilitySlot_capacity_check" CHECK ("capacity" > 0),
  ADD CONSTRAINT "AvailabilitySlot_inventory_check" CHECK ("bookedCount" >= 0 AND "bookedCount" <= "capacity"),
  ADD CONSTRAINT "AvailabilitySlot_time_check" CHECK ("endsAt" > "startsAt");
CREATE UNIQUE INDEX "AvailabilitySlot_providerId_serviceId_modality_startsAt_key" ON "AvailabilitySlot"("providerId", "serviceId", "modality", "startsAt");
CREATE INDEX "AvailabilitySlot_serviceId_modality_status_startsAt_idx" ON "AvailabilitySlot"("serviceId", "modality", "status", "startsAt");

ALTER TABLE "Appointment"
  ADD COLUMN "slotId" TEXT,
  ADD COLUMN "idempotencyKey" TEXT,
  ADD COLUMN "cancelledAt" TIMESTAMP(3),
  ADD COLUMN "cancellationReason" TEXT;
CREATE UNIQUE INDEX "Appointment_idempotencyKey_key" ON "Appointment"("idempotencyKey");
CREATE INDEX "Appointment_patientId_startsAt_status_idx" ON "Appointment"("patientId", "startsAt", "status");
CREATE INDEX "Appointment_slotId_status_idx" ON "Appointment"("slotId", "status");

ALTER TABLE "AvailabilityRule" ADD CONSTRAINT "AvailabilityRule_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AvailabilityRule" ADD CONSTRAINT "AvailabilityRule_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AvailabilitySlot" ADD CONSTRAINT "AvailabilitySlot_sourceRuleId_fkey" FOREIGN KEY ("sourceRuleId") REFERENCES "AvailabilityRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "AvailabilitySlot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Defense in depth: even bookings from different overlapping slots cannot double-book a provider or patient.
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_provider_no_overlap"
  EXCLUDE USING gist (
    "providerId" WITH =,
    tsrange("startsAt", "endsAt", '[)') WITH &&
  ) WHERE ("status" IN ('REQUESTED', 'CONFIRMED'));

ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_patient_no_overlap"
  EXCLUDE USING gist (
    "patientId" WITH =,
    tsrange("startsAt", "endsAt", '[)') WITH &&
  ) WHERE ("status" IN ('REQUESTED', 'CONFIRMED'));
