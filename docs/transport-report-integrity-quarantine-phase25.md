# Transport Phase 25 — Integrity Quarantine + Manual Reverification

Branch: `feature/transport-report-integrity-quarantine-phase25-20261001`

## Objective

Phase 25 turns a confirmed Phase 24 artifact integrity mismatch into an operational
quarantine and gives an authorized ADMIN a controlled way to reverify the private artifact.

No new database fields are required. The existing durable integrity state is the source of
truth.

## Quarantine state

A report artifact is quarantined when:

`artifactIntegrityStatus = MISMATCH`

This is a confirmed content/evidence mismatch, not a transient storage error.

`CHECK_FAILED` remains a failed verification attempt and does not by itself prove that the
artifact bytes are wrong.

## Quarantine effects

While `MISMATCH` is active:

- new secure-download grants are blocked;
- delivery handoff preparation is blocked;
- recipient inbox reports `artifactAvailable: false`;
- Admin hides Secure download;
- Admin hides Prepare handoff;
- the execution ledger shows `QUARANTINED`.

Legal hold remains independent. A quarantined artifact may still be placed on legal hold so
retention purge can be prevented while the integrity incident is investigated.

## Pending grant invalidation

When the background verifier confirms a mismatch, all unconsumed one-time download grants
for that run are invalidated by marking them consumed.

Manual reverification that confirms a mismatch performs the same invalidation.

A previously issued grant that escaped invalidation would still be protected by the Phase 19
download-path SHA-256/byte verification.

## Manual reverification

Endpoint:

`POST /admin/transport/report-runs/:runId/integrity/reverify`

Permission:

`TRANSPORT_OPERATE`

Requirements:

- successful report run
- live private artifact
- persisted SHA-256
- artifact not purged
- no active purge claim

The operation re-reads private storage immediately and recomputes:

- SHA-256
- byte length

Possible results:

- `VERIFIED`
- `MISMATCH`
- `CHECK_FAILED`

If the artifact is verified, quarantine is automatically cleared because the durable status
moves from `MISMATCH` to `VERIFIED`.

## Audit evidence

Manual request:

`ADMIN_TRANSPORT_REPORT_ARTIFACT_REVERIFY_REQUESTED`

The resulting verification still writes one of the Phase 24 immutable events:

- `SYSTEM_TRANSPORT_REPORT_ARTIFACT_INTEGRITY_VERIFIED`
- `SYSTEM_TRANSPORT_REPORT_ARTIFACT_INTEGRITY_MISMATCH`
- `SYSTEM_TRANSPORT_REPORT_ARTIFACT_INTEGRITY_CHECK_FAILED`

The Phase 23 governance timeline includes the manual request and final result.

## Race safety

Manual reverification is rejected if a purge claim is active.

The result update also requires:

- same object key
- artifact not deleted
- no purge claim

This prevents a manual verification from resurrecting or rewriting state for an artifact that
was purged concurrently.

## Admin UI

For a live successful artifact:

- `MISMATCH` shows `QUARANTINED`
- `MISMATCH` exposes `Reverify integrity`
- `CHECK_FAILED` also exposes `Reverify integrity`
- Secure download is hidden during confirmed mismatch
- Prepare handoff is hidden during confirmed mismatch
- Set/Clear legal hold remains available

## Environment

No new environment variables.

No `.env` file is added.

## Database

No database migration is required.

Phase 25 reuses the Phase 24 integrity state.

## Validation

`npm run v2:transport-phase25`

The smoke contract verifies:

- manual reverification endpoint
- ADMIN permission
- purge-claim rejection
- SHA-256/byte recomputation
- VERIFIED/MISMATCH/CHECK_FAILED outcomes
- mismatch grant invalidation
- handoff block
- inbox quarantine
- Admin quarantine/reverify UI
- governance timeline manual-request action
- package test-chain registration
