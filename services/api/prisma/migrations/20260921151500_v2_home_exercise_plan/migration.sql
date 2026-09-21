CREATE TABLE "HomeExercisePlan" (
  "id" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "requestDigest" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "appointmentId" TEXT NOT NULL,
  "carePlanId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "HomeExercisePlan_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "HomeExercisePlan_idempotency_ck" CHECK (char_length("idempotencyKey") BETWEEN 1 AND 120),
  CONSTRAINT "HomeExercisePlan_digest_ck" CHECK ("requestDigest" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "HomeExercisePlan_status_ck" CHECK ("status" IN ('ACTIVE','PAUSED','CLOSED')),
  CONSTRAINT "HomeExercisePlan_version_ck" CHECK ("version" > 0)
);

CREATE UNIQUE INDEX "HomeExercisePlan_idempotencyKey_key" ON "HomeExercisePlan"("idempotencyKey");
CREATE UNIQUE INDEX "HomeExercisePlan_carePlanId_key" ON "HomeExercisePlan"("carePlanId");
CREATE UNIQUE INDEX "HomeExercisePlan_providerId_appointmentId_key" ON "HomeExercisePlan"("providerId", "appointmentId");
CREATE INDEX "HomeExercisePlan_patientId_status_createdAt_idx" ON "HomeExercisePlan"("patientId", "status", "createdAt");
CREATE INDEX "HomeExercisePlan_providerId_patientId_status_idx" ON "HomeExercisePlan"("providerId", "patientId", "status");

ALTER TABLE "HomeExercisePlan" ADD CONSTRAINT "HomeExercisePlan_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "PatientProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HomeExercisePlan" ADD CONSTRAINT "HomeExercisePlan_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HomeExercisePlan" ADD CONSTRAINT "HomeExercisePlan_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HomeExercisePlan" ADD CONSTRAINT "HomeExercisePlan_carePlanId_fkey" FOREIGN KEY ("carePlanId") REFERENCES "CarePlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
