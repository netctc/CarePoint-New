CREATE TABLE "RealtimeSubscription" (
  "id" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "topic" TEXT NOT NULL,
  "scopeKey" TEXT NOT NULL,
  "subjectType" TEXT NOT NULL,
  "subjectId" TEXT NOT NULL,
  "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastAuthorizedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "disconnectedAt" TIMESTAMP(3),
  "disconnectReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RealtimeSubscription_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RealtimeSubscription_topic_check" CHECK ("topic" IN ('CLINICAL_ALERTS','QUESTIONNAIRE_COMPLETIONS','OBSERVATIONS','PROVIDER_JOB_STATUS')),
  CONSTRAINT "RealtimeSubscription_subject_type_check" CHECK ("subjectType" IN ('PATIENT','PROVIDER'))
);

CREATE INDEX "RealtimeSubscription_actorId_connectedAt_idx"
  ON "RealtimeSubscription"("actorId", "connectedAt");
CREATE INDEX "RealtimeSubscription_sessionId_disconnectedAt_idx"
  ON "RealtimeSubscription"("sessionId", "disconnectedAt");
CREATE INDEX "RealtimeSubscription_topic_subject_idx"
  ON "RealtimeSubscription"("topic", "subjectType", "subjectId", "connectedAt");

ALTER TABLE "RealtimeSubscription"
  ADD CONSTRAINT "RealtimeSubscription_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RealtimeSubscription"
  ADD CONSTRAINT "RealtimeSubscription_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "AuthSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION carepoint_guard_realtime_subscription_update()
RETURNS trigger AS $$
BEGIN
  IF NEW."actorId" IS DISTINCT FROM OLD."actorId"
     OR NEW."sessionId" IS DISTINCT FROM OLD."sessionId"
     OR NEW."topic" IS DISTINCT FROM OLD."topic"
     OR NEW."scopeKey" IS DISTINCT FROM OLD."scopeKey"
     OR NEW."subjectType" IS DISTINCT FROM OLD."subjectType"
     OR NEW."subjectId" IS DISTINCT FROM OLD."subjectId"
     OR NEW."connectedAt" IS DISTINCT FROM OLD."connectedAt"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'realtime subscription identity evidence is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "RealtimeSubscription_guard_identity_update"
BEFORE UPDATE ON "RealtimeSubscription"
FOR EACH ROW EXECUTE FUNCTION carepoint_guard_realtime_subscription_update();

CREATE OR REPLACE FUNCTION carepoint_reject_realtime_subscription_delete()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'realtime subscription evidence cannot be hard deleted';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "RealtimeSubscription_no_hard_delete"
BEFORE DELETE ON "RealtimeSubscription"
FOR EACH ROW EXECUTE FUNCTION carepoint_reject_realtime_subscription_delete();

REVOKE DELETE ON "RealtimeSubscription" FROM PUBLIC;
