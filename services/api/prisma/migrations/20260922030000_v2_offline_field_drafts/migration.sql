CREATE TABLE "OfflineFieldDraft" (
  "id" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "appointmentId" TEXT NOT NULL,
  "currentVersion" INTEGER NOT NULL DEFAULT 0,
  "lastSyncedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OfflineFieldDraft_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OfflineFieldDraft_version_ck" CHECK ("currentVersion" >= 0)
);

CREATE TABLE "OfflineFieldDraftRevision" (
  "id" TEXT NOT NULL,
  "draftId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "clientDraftId" TEXT NOT NULL,
  "clientRevision" INTEGER NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "requestDigest" TEXT NOT NULL,
  "sourceConflictId" TEXT,
  "algorithm" TEXT NOT NULL,
  "keyId" TEXT NOT NULL,
  "wrappedKey" TEXT NOT NULL,
  "iv" TEXT NOT NULL,
  "ciphertext" TEXT NOT NULL,
  "authorActorId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OfflineFieldDraftRevision_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OfflineFieldDraftRevision_version_ck" CHECK ("version" > 0),
  CONSTRAINT "OfflineFieldDraftRevision_client_revision_ck" CHECK ("clientRevision" > 0)
);

CREATE TABLE "OfflineFieldSyncConflict" (
  "id" TEXT NOT NULL,
  "draftId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "appointmentId" TEXT NOT NULL,
  "clientDraftId" TEXT NOT NULL,
  "clientRevision" INTEGER NOT NULL,
  "baseServerVersion" INTEGER NOT NULL,
  "serverVersionAtConflict" INTEGER NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "requestDigest" TEXT NOT NULL,
  "algorithm" TEXT NOT NULL,
  "keyId" TEXT NOT NULL,
  "wrappedKey" TEXT NOT NULL,
  "iv" TEXT NOT NULL,
  "ciphertext" TEXT NOT NULL,
  "actorId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "resolution" TEXT,
  "resolvedByActorId" TEXT,
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OfflineFieldSyncConflict_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OfflineFieldSyncConflict_client_revision_ck" CHECK ("clientRevision" > 0),
  CONSTRAINT "OfflineFieldSyncConflict_versions_ck" CHECK ("baseServerVersion" >= 0 AND "serverVersionAtConflict" > 0),
  CONSTRAINT "OfflineFieldSyncConflict_state_ck" CHECK (
    ("status" = 'PENDING' AND "resolution" IS NULL AND "resolvedByActorId" IS NULL AND "resolvedAt" IS NULL)
    OR
    ("status" = 'RESOLVED' AND "resolution" IN ('KEEP_SERVER', 'USE_CLIENT') AND "resolvedByActorId" IS NOT NULL AND "resolvedAt" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "OfflineFieldDraft_providerId_appointmentId_key" ON "OfflineFieldDraft"("providerId", "appointmentId");
CREATE INDEX "OfflineFieldDraft_providerId_updatedAt_idx" ON "OfflineFieldDraft"("providerId", "updatedAt");
CREATE INDEX "OfflineFieldDraft_patientId_updatedAt_idx" ON "OfflineFieldDraft"("patientId", "updatedAt");

CREATE UNIQUE INDEX "OfflineFieldDraftRevision_idempotencyKey_key" ON "OfflineFieldDraftRevision"("idempotencyKey");
CREATE UNIQUE INDEX "OfflineFieldDraftRevision_draftId_version_key" ON "OfflineFieldDraftRevision"("draftId", "version");
CREATE INDEX "OfflineFieldDraftRevision_draftId_createdAt_idx" ON "OfflineFieldDraftRevision"("draftId", "createdAt");
CREATE INDEX "OfflineFieldDraftRevision_clientDraftId_clientRevision_idx" ON "OfflineFieldDraftRevision"("clientDraftId", "clientRevision");

CREATE UNIQUE INDEX "OfflineFieldSyncConflict_idempotencyKey_key" ON "OfflineFieldSyncConflict"("idempotencyKey");
CREATE INDEX "OfflineFieldSyncConflict_providerId_status_createdAt_idx" ON "OfflineFieldSyncConflict"("providerId", "status", "createdAt");
CREATE INDEX "OfflineFieldSyncConflict_draftId_status_createdAt_idx" ON "OfflineFieldSyncConflict"("draftId", "status", "createdAt");
CREATE INDEX "OfflineFieldSyncConflict_clientDraftId_clientRevision_idx" ON "OfflineFieldSyncConflict"("clientDraftId", "clientRevision");

ALTER TABLE "OfflineFieldDraft" ADD CONSTRAINT "OfflineFieldDraft_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OfflineFieldDraft" ADD CONSTRAINT "OfflineFieldDraft_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "PatientProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OfflineFieldDraft" ADD CONSTRAINT "OfflineFieldDraft_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OfflineFieldDraftRevision" ADD CONSTRAINT "OfflineFieldDraftRevision_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "OfflineFieldDraft"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OfflineFieldSyncConflict" ADD CONSTRAINT "OfflineFieldSyncConflict_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "OfflineFieldDraft"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OfflineFieldSyncConflict" ADD CONSTRAINT "OfflineFieldSyncConflict_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OfflineFieldSyncConflict" ADD CONSTRAINT "OfflineFieldSyncConflict_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "PatientProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OfflineFieldSyncConflict" ADD CONSTRAINT "OfflineFieldSyncConflict_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION carepoint_reject_offline_field_revision_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Offline field draft revisions are append-only';
END;
$$;

CREATE TRIGGER "OfflineFieldDraftRevision_append_only_trg"
BEFORE UPDATE OR DELETE ON "OfflineFieldDraftRevision"
FOR EACH ROW EXECUTE FUNCTION carepoint_reject_offline_field_revision_mutation();

CREATE OR REPLACE FUNCTION carepoint_guard_offline_sync_conflict_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Offline field sync conflicts cannot be deleted';
  END IF;
  IF NEW."draftId" IS DISTINCT FROM OLD."draftId"
     OR NEW."providerId" IS DISTINCT FROM OLD."providerId"
     OR NEW."patientId" IS DISTINCT FROM OLD."patientId"
     OR NEW."appointmentId" IS DISTINCT FROM OLD."appointmentId"
     OR NEW."clientDraftId" IS DISTINCT FROM OLD."clientDraftId"
     OR NEW."clientRevision" IS DISTINCT FROM OLD."clientRevision"
     OR NEW."baseServerVersion" IS DISTINCT FROM OLD."baseServerVersion"
     OR NEW."serverVersionAtConflict" IS DISTINCT FROM OLD."serverVersionAtConflict"
     OR NEW."idempotencyKey" IS DISTINCT FROM OLD."idempotencyKey"
     OR NEW."requestDigest" IS DISTINCT FROM OLD."requestDigest"
     OR NEW."algorithm" IS DISTINCT FROM OLD."algorithm"
     OR NEW."keyId" IS DISTINCT FROM OLD."keyId"
     OR NEW."wrappedKey" IS DISTINCT FROM OLD."wrappedKey"
     OR NEW."iv" IS DISTINCT FROM OLD."iv"
     OR NEW."ciphertext" IS DISTINCT FROM OLD."ciphertext"
     OR NEW."actorId" IS DISTINCT FROM OLD."actorId"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'Offline field sync conflict payload is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "OfflineFieldSyncConflict_immutable_payload_trg"
BEFORE UPDATE OR DELETE ON "OfflineFieldSyncConflict"
FOR EACH ROW EXECUTE FUNCTION carepoint_guard_offline_sync_conflict_mutation();

CREATE OR REPLACE FUNCTION carepoint_reject_offline_field_draft_delete()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Offline field draft anchors cannot be deleted';
END;
$$;

CREATE TRIGGER "OfflineFieldDraft_no_delete_trg"
BEFORE DELETE ON "OfflineFieldDraft"
FOR EACH ROW EXECUTE FUNCTION carepoint_reject_offline_field_draft_delete();

REVOKE UPDATE, DELETE ON "OfflineFieldDraftRevision" FROM PUBLIC;
REVOKE DELETE ON "OfflineFieldDraft", "OfflineFieldSyncConflict" FROM PUBLIC;
