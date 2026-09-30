# Transport Phase 22 — Report Legal Hold + Purge Governance

Branch: `feature/transport-report-legal-hold-phase22-20260930`

## Objective

Phase 22 prevents automatic retention purge of a private Transport management-report
artifact when an authorized ADMIN places that artifact under an explicit legal/retention hold.

It also coordinates hold changes with the Phase 21 purge worker so a hold cannot race an
already-started object deletion.

## Persisted governance state

`TransportManagementReportRun` adds:

- `artifactLegalHold`
- `artifactLegalHoldReason`
- `artifactLegalHoldSetAt`
- `artifactLegalHoldSetByAccountId`
- `artifactPurgeClaimedAt`

Default:

`artifactLegalHold = false`

## Set hold

Endpoint:

`POST /admin/transport/report-runs/:runId/legal-hold`

Body:

`{ "reason": "..." }`

Requirements:

- caller has `TRANSPORT_OPERATE`
- run is successful
- private artifact still exists
- artifact has not already been purged
- no active purge claim exists

Reason is required and bounded to 3–500 printable characters.

A stale purge claim older than 15 minutes may be recovered while the hold is set.

Audit action:

`ADMIN_TRANSPORT_REPORT_ARTIFACT_LEGAL_HOLD_SET`

## Clear hold

Endpoint:

`POST /admin/transport/report-runs/:runId/legal-hold/clear`

Clearing removes hold reason/setter timestamps and makes the artifact eligible for the next
retention cycle if its retention age has already expired.

Audit action:

`ADMIN_TRANSPORT_REPORT_ARTIFACT_LEGAL_HOLD_CLEARED`

## Purge claim coordination

The retention worker processes only:

`artifactLegalHold = false`

Before deleting the private object it atomically claims the run by setting:

`artifactPurgeClaimedAt`

The claim succeeds only when:

- artifact is still live
- artifact is not on hold
- no current claim exists, or the prior claim is stale

Once a non-stale purge claim exists, setting a new legal hold is rejected.

This gives a deterministic authority boundary:

- hold wins if established before purge claim;
- purge wins if already claimed before the hold request.

## Failure recovery

If private object deletion fails:

- database is not marked purged
- purge claim is released
- artifact remains eligible for a later retry
- failure audit is preserved

Purge claims older than 15 minutes are considered stale and recoverable.

## Evidence preservation

Legal hold does not change:

- report bytes
- artifact hash
- artifact size
- report snapshot
- notification delivery state
- download receipts
- audit records

After a later authorized hold clear and purge, Phase 21 still preserves hash/size/snapshot
evidence while removing the private CSV object.

## Admin UI

The execution ledger now shows:

`LEGAL HOLD`

with the hold reason.

For a live successful artifact the ADMIN can:

- Set legal hold
- Clear hold
- Secure download
- Prepare delivery handoff, where applicable

A purged artifact cannot be placed on hold.

## Privacy

Hold metadata contains an operational/legal retention reason only.

No patient identity or patient location is added to the hold model or audit metadata.

## Environment

No new environment variables.

No `.env` file is added.

## Database migration

`20261001010500_v2_transport_report_legal_hold`

## Validation

`npm run v2:transport-phase22`

The smoke contract verifies:

- legal hold fields/default
- purge claim field/index
- set/clear endpoints
- reason bounds
- active claim blocks hold
- stale claim recovery
- retention query excludes held artifacts
- purge atomically claims before delete
- claim ownership is checked when recording purge
- failed purge releases claim
- Admin hold controls
- package test-chain registration
