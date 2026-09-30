CREATE TABLE "FeatureFlag" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "currentVersion" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FeatureFlag_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FeatureFlagVersion" (
  "id" TEXT NOT NULL,
  "featureFlagId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "defaultEnabled" BOOLEAN NOT NULL,
  "createdByActorId" TEXT,
  "reasonCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FeatureFlagVersion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FeatureAssignment" (
  "id" TEXT NOT NULL,
  "featureFlagVersionId" TEXT NOT NULL,
  "selectorKey" TEXT NOT NULL,
  "environment" TEXT,
  "jurisdiction" TEXT,
  "role" TEXT,
  "providerCategoryId" TEXT,
  "enabled" BOOLEAN NOT NULL,
  "priority" INTEGER NOT NULL DEFAULT 0,
  "createdByActorId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FeatureAssignment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FeatureFlag_key_key" ON "FeatureFlag"("key");
CREATE INDEX "FeatureFlag_active_key_idx" ON "FeatureFlag"("active", "key");
CREATE UNIQUE INDEX "FeatureFlagVersion_featureFlagId_version_key" ON "FeatureFlagVersion"("featureFlagId", "version");
CREATE INDEX "FeatureFlagVersion_featureFlagId_createdAt_idx" ON "FeatureFlagVersion"("featureFlagId", "createdAt");
CREATE UNIQUE INDEX "FeatureAssignment_featureFlagVersionId_selectorKey_key" ON "FeatureAssignment"("featureFlagVersionId", "selectorKey");
CREATE INDEX "FeatureAssignment_featureFlagVersionId_priority_idx" ON "FeatureAssignment"("featureFlagVersionId", "priority");

ALTER TABLE "FeatureFlagVersion"
  ADD CONSTRAINT "FeatureFlagVersion_featureFlagId_fkey"
  FOREIGN KEY ("featureFlagId") REFERENCES "FeatureFlag"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FeatureAssignment"
  ADD CONSTRAINT "FeatureAssignment_featureFlagVersionId_fkey"
  FOREIGN KEY ("featureFlagVersionId") REFERENCES "FeatureFlagVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FeatureFlag"
  ADD CONSTRAINT "FeatureFlag_current_version_check" CHECK ("currentVersion" > 0);
ALTER TABLE "FeatureFlagVersion"
  ADD CONSTRAINT "FeatureFlagVersion_version_check" CHECK ("version" > 0);
ALTER TABLE "FeatureAssignment"
  ADD CONSTRAINT "FeatureAssignment_priority_check" CHECK ("priority" BETWEEN -1000 AND 1000);

CREATE OR REPLACE FUNCTION carepoint_reject_feature_policy_history_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'feature policy history is immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "FeatureFlagVersion_immutable"
BEFORE UPDATE OR DELETE ON "FeatureFlagVersion"
FOR EACH ROW EXECUTE FUNCTION carepoint_reject_feature_policy_history_mutation();
CREATE TRIGGER "FeatureAssignment_immutable"
BEFORE UPDATE OR DELETE ON "FeatureAssignment"
FOR EACH ROW EXECUTE FUNCTION carepoint_reject_feature_policy_history_mutation();

REVOKE UPDATE, DELETE ON "FeatureFlagVersion" FROM PUBLIC;
REVOKE UPDATE, DELETE ON "FeatureAssignment" FROM PUBLIC;

-- Preserve the realtime feature introduced before BE-055. Dynamic governance starts enabled.
INSERT INTO "FeatureFlag" ("id", "key", "active", "currentVersion", "createdAt", "updatedAt")
VALUES ('00000000-0000-4000-8000-000000000055', 'V2_REALTIME', true, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT INTO "FeatureFlagVersion" ("id", "featureFlagId", "version", "defaultEnabled", "createdAt")
VALUES ('00000000-0000-4000-8000-000000000551', '00000000-0000-4000-8000-000000000055', 1, true, CURRENT_TIMESTAMP);
