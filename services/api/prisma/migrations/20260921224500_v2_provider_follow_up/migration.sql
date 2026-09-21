CREATE TABLE "ProviderFollowUpRecommendation" (
  "id" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "requestDigest" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "appointmentId" TEXT NOT NULL,
  "recommendationType" TEXT NOT NULL,
  "recommendedFor" TIMESTAMP(3),
  "algorithm" TEXT NOT NULL,
  "keyId" TEXT NOT NULL,
  "wrappedKey" TEXT NOT NULL,
  "iv" TEXT NOT NULL,
  "ciphertext" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProviderFollowUpRecommendation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProviderFollowUpRecommendation_type_ck" CHECK ("recommendationType" IN ('FOLLOW_UP_VISIT','PRIMARY_CARE_REVIEW','SPECIALIST_REVIEW','CARE_REVIEW','OTHER'))
);

CREATE UNIQUE INDEX "ProviderFollowUpRecommendation_idempotencyKey_key" ON "ProviderFollowUpRecommendation"("idempotencyKey");
CREATE INDEX "ProviderFollowUpRecommendation_patientId_createdAt_idx" ON "ProviderFollowUpRecommendation"("patientId", "createdAt");
CREATE INDEX "ProviderFollowUpRecommendation_providerId_patientId_createdAt_idx" ON "ProviderFollowUpRecommendation"("providerId", "patientId", "createdAt");
CREATE INDEX "ProviderFollowUpRecommendation_appointmentId_createdAt_idx" ON "ProviderFollowUpRecommendation"("appointmentId", "createdAt");

ALTER TABLE "ProviderFollowUpRecommendation" ADD CONSTRAINT "ProviderFollowUpRecommendation_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "PatientProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProviderFollowUpRecommendation" ADD CONSTRAINT "ProviderFollowUpRecommendation_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProviderFollowUpRecommendation" ADD CONSTRAINT "ProviderFollowUpRecommendation_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION carepoint_reject_follow_up_recommendation_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Provider follow-up recommendations are append-only';
END;
$$;

CREATE TRIGGER "ProviderFollowUpRecommendation_append_only_trg"
BEFORE UPDATE OR DELETE ON "ProviderFollowUpRecommendation"
FOR EACH ROW EXECUTE FUNCTION carepoint_reject_follow_up_recommendation_mutation();

REVOKE UPDATE, DELETE ON "ProviderFollowUpRecommendation" FROM PUBLIC;
