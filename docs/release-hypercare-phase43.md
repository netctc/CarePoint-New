# Release Phase 43 — Hypercare + Operational Exit Contract

Phase 43 defines the mandatory hypercare period after Phase 42 release closure.

Hypercare may not start before Phase 42 is explicitly CLOSED and its Phase 42 validation result confirms the closure.

Exit requires **6 exit criteria** to PASS with evidence:
- no open Sev1/Sev2 incidents;
- stable error rate;
- latency within bound;
- stable background jobs;
- support handoff complete;
- rollback window formally closed.

An EXITED record also requires hypercare owner, start/end timestamps, and incident-review reference.

Only after EXITED does the contract report operational handoff complete and the release lifecycle complete.

Commands:
- `npm run v2:release-phase43`
- `npm run v2:release-phase43-hypercare -- <hypercare-record.json> <phase42-closure.json> <phase42-validation-result.json>`

No new production environment variables.

No .env file is added.

No database migration.
