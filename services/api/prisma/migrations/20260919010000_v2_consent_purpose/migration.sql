-- CarePoint V2 / BE-020: add structured purpose to consent grants without
-- invalidating legacy consent rows. Existing grants remain purpose-neutral and
-- retain their original semantics; new V2 callers may bind a grant to purpose.
ALTER TABLE "Consent" ADD COLUMN "purpose" TEXT;

CREATE INDEX "Consent_patientId_providerId_scope_purpose_state_idx"
ON "Consent"("patientId", "providerId", "scope", "purpose", "state");
