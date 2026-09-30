-- CarePoint V2 ADM-091 — immutable managed consent-policy versions.
-- Hard-coded ClinicalConsentPolicies remains the non-expandable safety ceiling.

CREATE TABLE "ConsentPolicyDefinition" (
  "id" TEXT NOT NULL,
  "scopePattern" TEXT NOT NULL,
  "jurisdiction" TEXT NOT NULL DEFAULT 'GLOBAL',
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ConsentPolicyDefinition_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ConsentPolicyVersion" (
  "id" TEXT NOT NULL,
  "policyId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "titleLabels" JSONB NOT NULL,
  "bodyLabels" JSONB NOT NULL,
  "allowedPurposes" JSONB NOT NULL,
  "eligibleRoles" JSONB NOT NULL,
  "temporaryShareable" BOOLEAN NOT NULL DEFAULT false,
  "requireExpiry" BOOLEAN NOT NULL DEFAULT false,
  "maxGrantMinutes" INTEGER,
  "regrantAllowed" BOOLEAN NOT NULL DEFAULT true,
  "createdByActorId" TEXT,
  "activatedAt" TIMESTAMP(3),
  "retiredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ConsentPolicyVersion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ConsentPolicyVersion_version_ck" CHECK ("version" > 0),
  CONSTRAINT "ConsentPolicyVersion_status_ck" CHECK ("status" IN ('DRAFT','ACTIVE','RETIRED')),
  CONSTRAINT "ConsentPolicyVersion_expiry_ck" CHECK (
    ("maxGrantMinutes" IS NULL OR "maxGrantMinutes" BETWEEN 5 AND 525600)
    AND ("requireExpiry" = false OR "maxGrantMinutes" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "ConsentPolicyDefinition_scopePattern_jurisdiction_key"
ON "ConsentPolicyDefinition"("scopePattern", "jurisdiction");

CREATE INDEX "ConsentPolicyDefinition_active_scopePattern_jurisdiction_idx"
ON "ConsentPolicyDefinition"("active", "scopePattern", "jurisdiction");

CREATE UNIQUE INDEX "ConsentPolicyVersion_policyId_version_key"
ON "ConsentPolicyVersion"("policyId", "version");

CREATE INDEX "ConsentPolicyVersion_status_activatedAt_idx"
ON "ConsentPolicyVersion"("status", "activatedAt");

ALTER TABLE "ConsentPolicyVersion"
ADD CONSTRAINT "ConsentPolicyVersion_policyId_fkey"
FOREIGN KEY ("policyId") REFERENCES "ConsentPolicyDefinition"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Consent"
  ADD COLUMN "policyVersionId" TEXT,
  ADD COLUMN "policyJurisdiction" TEXT;

CREATE INDEX "Consent_policyVersionId_idx" ON "Consent"("policyVersionId");
