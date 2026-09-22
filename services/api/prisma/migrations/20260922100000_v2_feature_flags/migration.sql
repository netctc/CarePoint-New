CREATE TABLE "FeatureFlag" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "description" TEXT,
  "defaultEnabled" BOOLEAN NOT NULL DEFAULT true,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdByActorId" TEXT,
  "updatedByActorId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FeatureFlag_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FeatureFlag_version_check" CHECK ("version" >= 1),
  CONSTRAINT "FeatureFlag_key_check" CHECK ("key" ~ '^[A-Z][A-Z0-9_]{2,79}$')
);

CREATE TABLE "FeatureAssignment" (
  "id" TEXT NOT NULL,
  "featureFlagId" TEXT NOT NULL,
  "environment" TEXT NOT NULL DEFAULT '*',
  "jurisdiction" TEXT NOT NULL DEFAULT '*',
  "role" TEXT NOT NULL DEFAULT '*',
  "providerCategory" TEXT NOT NULL DEFAULT '*',
  "enabled" BOOLEAN NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "version" INTEGER NOT NULL DEFAULT 1,
  "reasonCode" TEXT,
  "updatedByActorId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FeatureAssignment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FeatureAssignment_version_check" CHECK ("version" >= 1),
  CONSTRAINT "FeatureAssignment_environment_check" CHECK (char_length("environment") BETWEEN 1 AND 40),
  CONSTRAINT "FeatureAssignment_jurisdiction_check" CHECK (char_length("jurisdiction") BETWEEN 1 AND 40),
  CONSTRAINT "FeatureAssignment_role_check" CHECK ("role" IN ('*','PATIENT','DOCTOR','OTHER_PROVIDER','ADMIN','SUPPORT')),
  CONSTRAINT "FeatureAssignment_category_check" CHECK (char_length("providerCategory") BETWEEN 1 AND 80)
);

CREATE UNIQUE INDEX "FeatureFlag_key_key" ON "FeatureFlag"("key");
CREATE INDEX "FeatureFlag_active_key_idx" ON "FeatureFlag"("active", "key");
CREATE UNIQUE INDEX "FeatureAssignment_scope_key"
  ON "FeatureAssignment"("featureFlagId", "environment", "jurisdiction", "role", "providerCategory");
CREATE INDEX "FeatureAssignment_featureFlagId_active_idx" ON "FeatureAssignment"("featureFlagId", "active");
CREATE INDEX "FeatureAssignment_scope_idx"
  ON "FeatureAssignment"("environment", "jurisdiction", "role", "providerCategory", "active");

ALTER TABLE "FeatureAssignment"
  ADD CONSTRAINT "FeatureAssignment_featureFlagId_fkey"
  FOREIGN KEY ("featureFlagId") REFERENCES "FeatureFlag"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FeatureAssignment"
  ADD CONSTRAINT "FeatureAssignment_updatedByActorId_fkey"
  FOREIGN KEY ("updatedByActorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "FeatureFlag" (
  "id", "key", "description", "defaultEnabled", "active", "version", "createdAt", "updatedAt"
) VALUES
  ('feature-telehealth', 'TELEHEALTH', 'Telehealth patient/provider API surface', true, true, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('feature-payments', 'PAYMENTS', 'Payment intent, refund and payout API surface', true, true, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('feature-patient-self-registration', 'PATIENT_SELF_REGISTRATION', 'Patient self-registration API surface', true, true, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('feature-external-notifications', 'EXTERNAL_NOTIFICATIONS', 'External push, email and SMS delivery', true, true, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
