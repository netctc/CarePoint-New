# Release Phase 32 — External Evidence Validator + Go-Live Gate Aggregator

Branch: `quality/release-external-evidence-validator-phase32-20261001`

## Objective

Phase 32 adds a deterministic validator for the eight external Go-Live gates declared by Phase 31.

It does **not** create evidence, approve evidence, merge code, or set production acceptance.

The validator exists so real sanitized evidence can be checked consistently against the exact final release candidate:

- PR #511
- source SHA `9974b72b76b45539e6513730c3b8fdbe0d1506f0`
- 25/25 canonical workflows successful
- 230/230 merged implementation traceability

## Evidence index

Template:

`ops/release-1/go-live-evidence-index.example.json`

The index contains exactly the eight Phase 31 gate IDs.

Default state:

- all gates: `PENDING`
- `finalDecision: BLOCKED`
- `productionAcceptance: false`
- `mainMergeAllowed: false`
- `humanReleaseAuthorizationRequired: true`

The example template is never accepted as live evidence.

## Accepted evidence path

Real sanitized evidence metadata must live under:

`ops/release-1/evidence/`

An accepted gate must provide:

- repository-relative evidence file
- SHA-256 of the exact JSON evidence file
- non-secret approver/acceptance reference
- acceptance timestamp

Files ending in `.example.json` are rejected.

## Release binding

If an evidence payload contains a release source SHA, it must match:

`9974b72b76b45539e6513730c3b8fdbe0d1506f0`

The evidence index itself must also match Phase 31 for:

- consolidated PR
- exact source SHA
- canonical workflow count
- canonical matrix conclusion

## Integrity

For every accepted gate, Phase 32 recomputes:

`SHA-256(evidence JSON bytes)`

and requires exact equality with the hash stored in the evidence index.

## Placeholder and secret rejection

Accepted evidence is rejected if it still contains placeholder/draft values such as:

- `REPLACE_WITH...`
- `CHANGE-ME`
- `TO-BE-SET`
- `PENDING`
- `BLOCKED`
- `DRAFT`
- `UNDECIDED`
- zero release SHA/digest placeholders
- the epoch placeholder timestamp

Evidence also rejects embedded credential fields such as plaintext:

- password
- access token
- refresh token
- private key
- secret value
- authorization/cookie values

Evidence references to restricted systems are allowed; the restricted material itself must remain outside the repository.

## Gate-specific acceptance

The validator preserves the semantics of each Phase 31 evidence schema.

Examples:

- production infrastructure controls/continuity must be accepted;
- enabled external integrations must be accepted;
- signed mobile artifacts and approvals must be accepted;
- independent security assessment must confirm independence/manual testing and known findings;
- applicable UAT cases and journey sign-offs must be accepted;
- resilience scenarios must be executed/enabled;
- applicable KSA market/clinical controls and blocking issues must be closed/accepted;
- deployment rehearsal must include predeploy readiness, deployment safety, rollback execution, reconciliation, PITR rehearsal, and approvals.

## Aggregated decision

If fewer than 8/8 gates are accepted:

`finalDecision = BLOCKED`

If all 8/8 gates are accepted:

`finalDecision = READY_FOR_HUMAN_RELEASE_AUTHORIZATION`

Even at 8/8:

- `productionAcceptance` remains false;
- `mainMergeAllowed` remains false;
- explicit human release authorization remains required.

Phase 32 never auto-merges and never converts external evidence into an automatic production decision.

## Commands

Structural contract:

`npm run v2:release-phase32`

Validate a real sanitized evidence index:

`npm run v2:release-phase32-evidence -- ops/release-1/evidence/go-live-evidence-index.json`

A valid but incomplete evidence set exits non-zero with a BLOCKED summary.

## Environment

No new production environment variables.

No .env file is added.

## Database

No database migration.
