CREATE TABLE "NutritionPlan" (
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
  CONSTRAINT "NutritionPlan_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "NutritionPlan_version_ck" CHECK ("version" >= 1),
  CONSTRAINT "NutritionPlan_status_ck" CHECK ("status" IN ('ACTIVE','PAUSED','COMPLETED','CANCELLED'))
);

CREATE TABLE "NutritionPlanRevision" (
  "id" TEXT NOT NULL,
  "nutritionPlanId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "algorithm" TEXT NOT NULL,
  "keyId" TEXT NOT NULL,
  "wrappedKey" TEXT NOT NULL,
  "iv" TEXT NOT NULL,
  "ciphertext" TEXT NOT NULL,
  "authorActorId" TEXT NOT NULL,
  "reasonCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NutritionPlanRevision_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "NutritionPlanRevision_version_ck" CHECK ("version" >= 1)
);

CREATE UNIQUE INDEX "NutritionPlan_idempotencyKey_key" ON "NutritionPlan"("idempotencyKey");
CREATE UNIQUE INDEX "NutritionPlan_carePlanId_key" ON "NutritionPlan"("carePlanId");
CREATE UNIQUE INDEX "NutritionPlan_providerId_appointmentId_key" ON "NutritionPlan"("providerId", "appointmentId");
CREATE INDEX "NutritionPlan_patientId_status_createdAt_idx" ON "NutritionPlan"("patientId", "status", "createdAt");
CREATE INDEX "NutritionPlan_providerId_patientId_status_idx" ON "NutritionPlan"("providerId", "patientId", "status");
CREATE UNIQUE INDEX "NutritionPlanRevision_nutritionPlanId_version_key" ON "NutritionPlanRevision"("nutritionPlanId", "version");
CREATE INDEX "NutritionPlanRevision_nutritionPlanId_createdAt_idx" ON "NutritionPlanRevision"("nutritionPlanId", "createdAt");

ALTER TABLE "NutritionPlan" ADD CONSTRAINT "NutritionPlan_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "PatientProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "NutritionPlan" ADD CONSTRAINT "NutritionPlan_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "NutritionPlan" ADD CONSTRAINT "NutritionPlan_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "NutritionPlan" ADD CONSTRAINT "NutritionPlan_carePlanId_fkey" FOREIGN KEY ("carePlanId") REFERENCES "CarePlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "NutritionPlanRevision" ADD CONSTRAINT "NutritionPlanRevision_nutritionPlanId_fkey" FOREIGN KEY ("nutritionPlanId") REFERENCES "NutritionPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION carepoint_reject_nutrition_plan_revision_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Nutrition plan revisions are append-only';
END;
$$;

CREATE TRIGGER "NutritionPlanRevision_append_only_trg"
BEFORE UPDATE OR DELETE ON "NutritionPlanRevision"
FOR EACH ROW EXECUTE FUNCTION carepoint_reject_nutrition_plan_revision_mutation();

REVOKE UPDATE, DELETE ON "NutritionPlanRevision" FROM PUBLIC;
