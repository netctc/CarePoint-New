-- CarePoint V2 / BE-051:
-- database-level append-only audit controls plus integrity-chain and retention policy state.

CREATE TABLE "AuditIntegrityRecord" (
  "auditEventId" TEXT NOT NULL,
  "sequence" BIGSERIAL NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "previousHash" TEXT,
  "eventHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditIntegrityRecord_pkey" PRIMARY KEY ("auditEventId")
);

CREATE UNIQUE INDEX "AuditIntegrityRecord_sequence_key" ON "AuditIntegrityRecord"("sequence");
CREATE INDEX "AuditIntegrityRecord_createdAt_idx" ON "AuditIntegrityRecord"("createdAt");

ALTER TABLE "AuditIntegrityRecord"
  ADD CONSTRAINT "AuditIntegrityRecord_payload_hash_check"
  CHECK ("payloadHash" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "AuditIntegrityRecord_previous_hash_check"
  CHECK ("previousHash" IS NULL OR "previousHash" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "AuditIntegrityRecord_event_hash_check"
  CHECK ("eventHash" ~ '^[0-9a-f]{64}$');

ALTER TABLE "AuditIntegrityRecord"
  ADD CONSTRAINT "AuditIntegrityRecord_auditEventId_fkey"
  FOREIGN KEY ("auditEventId") REFERENCES "AuditEvent"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE TABLE "AuditRetentionPolicy" (
  "id" TEXT NOT NULL,
  "mode" TEXT NOT NULL DEFAULT 'INDEFINITE',
  "minimumRetentionDays" INTEGER,
  "legalHoldEnabled" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditRetentionPolicy_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "AuditRetentionPolicy"
  ADD CONSTRAINT "AuditRetentionPolicy_mode_check"
  CHECK ("mode" IN ('INDEFINITE', 'MINIMUM_DAYS')),
  ADD CONSTRAINT "AuditRetentionPolicy_days_check"
  CHECK (
    ("mode" = 'INDEFINITE' AND "minimumRetentionDays" IS NULL)
    OR ("mode" = 'MINIMUM_DAYS' AND "minimumRetentionDays" BETWEEN 30 AND 36500)
  );

INSERT INTO "AuditRetentionPolicy" (
  "id", "mode", "minimumRetentionDays", "legalHoldEnabled", "createdAt", "updatedAt"
) VALUES (
  'default', 'INDEFINITE', NULL, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
) ON CONFLICT ("id") DO NOTHING;

CREATE OR REPLACE FUNCTION carepoint_block_audit_event_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AuditEvent is append-only; update/delete is forbidden.' USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AuditEvent_append_only_trigger"
BEFORE UPDATE OR DELETE ON "AuditEvent"
FOR EACH ROW EXECUTE FUNCTION carepoint_block_audit_event_mutation();

CREATE OR REPLACE FUNCTION carepoint_block_audit_integrity_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AuditIntegrityRecord is append-only; update/delete is forbidden.' USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AuditIntegrityRecord_append_only_trigger"
BEFORE UPDATE OR DELETE ON "AuditIntegrityRecord"
FOR EACH ROW EXECUTE FUNCTION carepoint_block_audit_integrity_mutation();

REVOKE UPDATE, DELETE ON TABLE "AuditEvent" FROM PUBLIC;
REVOKE UPDATE, DELETE ON TABLE "AuditIntegrityRecord" FROM PUBLIC;
