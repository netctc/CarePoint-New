CREATE TABLE "EmergencyAccessGrant" (
  "id" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "purpose" TEXT NOT NULL DEFAULT 'EMERGENCY_TREATMENT',
  "reasonCode" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "requestedTtlMinutes" INTEGER NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "requestDigest" TEXT NOT NULL,
  "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "revokedByActorId" TEXT,
  "reviewStatus" TEXT NOT NULL DEFAULT 'PENDING',
  "reviewedAt" TIMESTAMP(3),
  "reviewedByActorId" TEXT,
  "reviewOutcome" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EmergencyAccessGrant_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "EmergencyAccessGrant_ttl_check" CHECK ("requestedTtlMinutes" BETWEEN 5 AND 60),
  CONSTRAINT "EmergencyAccessGrant_interval_check" CHECK ("expiresAt" > "grantedAt"),
  CONSTRAINT "EmergencyAccessGrant_purpose_check" CHECK ("purpose" = 'EMERGENCY_TREATMENT'),
  CONSTRAINT "EmergencyAccessGrant_status_check" CHECK ("status" IN ('ACTIVE', 'REVOKED')),
  CONSTRAINT "EmergencyAccessGrant_review_status_check" CHECK ("reviewStatus" IN ('PENDING', 'REVIEWED'))
);

CREATE TABLE "EmergencyAccessReview" (
  "id" TEXT NOT NULL,
  "grantId" TEXT NOT NULL,
  "reviewerId" TEXT NOT NULL,
  "outcome" TEXT NOT NULL,
  "reasonCode" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EmergencyAccessReview_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "EmergencyAccessReview_outcome_check" CHECK ("outcome" IN ('APPROPRIATE', 'INAPPROPRIATE', 'NEEDS_FOLLOW_UP'))
);

CREATE UNIQUE INDEX "EmergencyAccessGrant_actorId_idempotencyKey_key"
  ON "EmergencyAccessGrant"("actorId", "idempotencyKey");
CREATE INDEX "EmergencyAccessGrant_provider_patient_scope_active_idx"
  ON "EmergencyAccessGrant"("providerId", "patientId", "scope", "status", "expiresAt");
CREATE INDEX "EmergencyAccessGrant_patient_active_idx"
  ON "EmergencyAccessGrant"("patientId", "status", "expiresAt");
CREATE INDEX "EmergencyAccessGrant_review_queue_idx"
  ON "EmergencyAccessGrant"("reviewStatus", "grantedAt");
CREATE INDEX "EmergencyAccessReview_grant_created_idx"
  ON "EmergencyAccessReview"("grantId", "createdAt");
CREATE INDEX "EmergencyAccessReview_reviewer_created_idx"
  ON "EmergencyAccessReview"("reviewerId", "createdAt");

ALTER TABLE "EmergencyAccessGrant"
  ADD CONSTRAINT "EmergencyAccessGrant_patientId_fkey"
  FOREIGN KEY ("patientId") REFERENCES "PatientProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EmergencyAccessGrant"
  ADD CONSTRAINT "EmergencyAccessGrant_providerId_fkey"
  FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EmergencyAccessGrant"
  ADD CONSTRAINT "EmergencyAccessGrant_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EmergencyAccessGrant"
  ADD CONSTRAINT "EmergencyAccessGrant_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "AuthSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EmergencyAccessReview"
  ADD CONSTRAINT "EmergencyAccessReview_grantId_fkey"
  FOREIGN KEY ("grantId") REFERENCES "EmergencyAccessGrant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EmergencyAccessReview"
  ADD CONSTRAINT "EmergencyAccessReview_reviewerId_fkey"
  FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION carepoint_reject_emergency_access_delete()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'emergency access evidence cannot be hard deleted';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION carepoint_reject_emergency_access_review_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'emergency access reviews are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "EmergencyAccessGrant_no_hard_delete"
BEFORE DELETE ON "EmergencyAccessGrant"
FOR EACH ROW EXECUTE FUNCTION carepoint_reject_emergency_access_delete();

CREATE TRIGGER "EmergencyAccessReview_append_only"
BEFORE UPDATE OR DELETE ON "EmergencyAccessReview"
FOR EACH ROW EXECUTE FUNCTION carepoint_reject_emergency_access_review_mutation();

REVOKE DELETE ON "EmergencyAccessGrant" FROM PUBLIC;
REVOKE UPDATE, DELETE ON "EmergencyAccessReview" FROM PUBLIC;
