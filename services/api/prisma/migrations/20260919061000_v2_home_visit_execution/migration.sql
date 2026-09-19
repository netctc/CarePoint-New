-- CarePoint V2 / PRV-073, PRV-078.
-- Home-visit execution state with deterministic arrival/completion evidence.

CREATE TABLE "HomeVisitExecution" (
  "id" TEXT NOT NULL,
  "appointmentId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ASSIGNED',
  "arrivedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "completionChecklist" JSONB,
  "completionFormResponseId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "HomeVisitExecution_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "HomeVisitExecution_appointmentId_key" ON "HomeVisitExecution"("appointmentId");
CREATE INDEX "HomeVisitExecution_providerId_status_updatedAt_idx" ON "HomeVisitExecution"("providerId", "status", "updatedAt");
CREATE INDEX "HomeVisitExecution_patientId_updatedAt_idx" ON "HomeVisitExecution"("patientId", "updatedAt");

ALTER TABLE "HomeVisitExecution"
ADD CONSTRAINT "HomeVisitExecution_appointmentId_fkey"
FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HomeVisitExecution"
ADD CONSTRAINT "HomeVisitExecution_providerId_fkey"
FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HomeVisitExecution"
ADD CONSTRAINT "HomeVisitExecution_patientId_fkey"
FOREIGN KEY ("patientId") REFERENCES "PatientProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
