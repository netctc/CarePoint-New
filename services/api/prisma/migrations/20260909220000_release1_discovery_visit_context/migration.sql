-- Release 1 P0 #75: structured discovery, scheduling policies and visit context.

CREATE TYPE "AvailabilityExceptionKind" AS ENUM ('UNAVAILABLE', 'VACATION');

CREATE TABLE "ProviderLocation" (
  "id" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "addressLine1" TEXT NOT NULL,
  "addressLine2" TEXT,
  "city" TEXT NOT NULL,
  "region" TEXT,
  "postalCode" TEXT,
  "countryCode" TEXT NOT NULL,
  "latitude" DECIMAL(9,6) NOT NULL,
  "longitude" DECIMAL(9,6) NOT NULL,
  "arrivalInstructions" TEXT,
  "addressValidatedAt" TIMESTAMP(3),
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProviderLocation_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ProviderLocation_providerId_active_idx" ON "ProviderLocation"("providerId", "active");
CREATE INDEX "ProviderLocation_city_countryCode_active_idx" ON "ProviderLocation"("city", "countryCode", "active");
ALTER TABLE "ProviderLocation" ADD CONSTRAINT "ProviderLocation_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ServiceDeliveryContext" (
  "id" TEXT NOT NULL,
  "serviceId" TEXT NOT NULL,
  "modality" "AppointmentModality" NOT NULL,
  "clinicLocationId" TEXT,
  "clinicArrivalInstructions" TEXT,
  "homeCoverageCenterLatitude" DECIMAL(9,6),
  "homeCoverageCenterLongitude" DECIMAL(9,6),
  "homeCoverageRadiusKm" DECIMAL(8,3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ServiceDeliveryContext_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ServiceDeliveryContext_serviceId_modality_key" ON "ServiceDeliveryContext"("serviceId", "modality");
CREATE INDEX "ServiceDeliveryContext_clinicLocationId_idx" ON "ServiceDeliveryContext"("clinicLocationId");
ALTER TABLE "ServiceDeliveryContext" ADD CONSTRAINT "ServiceDeliveryContext_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ServiceDeliveryContext" ADD CONSTRAINT "ServiceDeliveryContext_clinicLocationId_fkey" FOREIGN KEY ("clinicLocationId") REFERENCES "ProviderLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "AvailabilityRulePolicy" (
  "id" TEXT NOT NULL,
  "ruleId" TEXT NOT NULL,
  "bufferBeforeMinutes" INTEGER NOT NULL DEFAULT 0,
  "bufferAfterMinutes" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AvailabilityRulePolicy_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AvailabilityRulePolicy_ruleId_key" ON "AvailabilityRulePolicy"("ruleId");
ALTER TABLE "AvailabilityRulePolicy" ADD CONSTRAINT "AvailabilityRulePolicy_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "AvailabilityRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AvailabilityException" (
  "id" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "serviceId" TEXT,
  "modality" "AppointmentModality",
  "kind" "AvailabilityExceptionKind" NOT NULL DEFAULT 'UNAVAILABLE',
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "reason" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AvailabilityException_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AvailabilityException_providerId_active_startsAt_endsAt_idx" ON "AvailabilityException"("providerId", "active", "startsAt", "endsAt");
CREATE INDEX "AvailabilityException_serviceId_active_startsAt_endsAt_idx" ON "AvailabilityException"("serviceId", "active", "startsAt", "endsAt");
ALTER TABLE "AvailabilityException" ADD CONSTRAINT "AvailabilityException_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AvailabilityException" ADD CONSTRAINT "AvailabilityException_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AppointmentVisitContext" (
  "id" TEXT NOT NULL,
  "appointmentId" TEXT NOT NULL,
  "modality" "AppointmentModality" NOT NULL,
  "sourceProviderLocationId" TEXT,
  "addressLine1" TEXT NOT NULL,
  "addressLine2" TEXT,
  "city" TEXT NOT NULL,
  "region" TEXT,
  "postalCode" TEXT,
  "countryCode" TEXT NOT NULL,
  "latitude" DECIMAL(9,6) NOT NULL,
  "longitude" DECIMAL(9,6) NOT NULL,
  "instructions" TEXT,
  "contactPhone" TEXT,
  "contactConfirmedAt" TIMESTAMP(3),
  "addressValidatedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AppointmentVisitContext_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AppointmentVisitContext_appointmentId_key" ON "AppointmentVisitContext"("appointmentId");
CREATE INDEX "AppointmentVisitContext_modality_createdAt_idx" ON "AppointmentVisitContext"("modality", "createdAt");
CREATE INDEX "AppointmentVisitContext_sourceProviderLocationId_idx" ON "AppointmentVisitContext"("sourceProviderLocationId");
ALTER TABLE "AppointmentVisitContext" ADD CONSTRAINT "AppointmentVisitContext_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AppointmentVisitContext" ADD CONSTRAINT "AppointmentVisitContext_sourceProviderLocationId_fkey" FOREIGN KEY ("sourceProviderLocationId") REFERENCES "ProviderLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
