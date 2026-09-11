-- F4: durable exactly-once-per-observation bookkeeping for consent-scoped in-app availability alerts.
-- No external delivery channel, slot reservation or automatic booking is introduced by this migration.
ALTER TABLE "PatientAvailabilityNotice"
  ADD COLUMN "lastNotifiedVersion" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "PatientAvailabilityNotice"
  ADD CONSTRAINT "f4_notice_notified_version"
  CHECK ("lastNotifiedVersion" >= 0 AND "lastNotifiedVersion" <= "version");

CREATE INDEX "f4_request_scan_idx"
  ON "PatientAvailabilityRequest"("status", "toAt", "id");
CREATE INDEX "f4_notice_scan_idx"
  ON "PatientAvailabilityNotice"("active", "checkedAt", "id");
