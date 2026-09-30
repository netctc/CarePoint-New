# Transport Phase 23 — Governance Evidence + Hold/Purge Timeline

Branch: `feature/transport-report-governance-timeline-phase23-20261001`

## Objective

Phase 23 provides a read-only governance timeline for every Transport management-report
run by reusing the immutable CarePoint audit chain.

No new lifecycle table is introduced.

## Endpoint

`GET /admin/transport/report-runs/:runId/governance-timeline`

Permission:

`TRANSPORT_OPERATE`

The endpoint returns:

- sanitized run summary
- current artifact governance state
- retention policy
- legal-hold state
- notification/download receipt counts
- ordered lifecycle events
- audit-chain sequence
- payload hash
- previous hash
- event hash

## Artifact governance state

Possible values:

- `LIVE_PRIVATE`
- `LEGAL_HOLD`
- `PURGED`
- `NOT_AVAILABLE`

The timeline never returns the private object-storage key.

## Audit-event scope

Only explicitly approved Transport report governance actions are included, such as:

- run success/failure/requeue
- delivery outbox/handoff
- one-time download grant issuance
- download success/failure/integrity failure
- legal hold set/clear
- secure artifact purge/purge failure

Generic audit metadata is intentionally not returned.

## Integrity evidence

For each included `AuditEvent`, Phase 23 resolves the matching
`AuditIntegrityRecord` and exposes:

- sequence
- payloadHash
- previousHash
- eventHash
- integrityEvidenceAvailable

BigInt audit sequence values are converted to strings for JSON safety.

## Privacy boundary

The response explicitly excludes:

- raw audit metadata
- object-storage key
- CSV content
- patient identity
- patient contact
- pickup/destination addresses
- coordinates

The API emits:

- `rawAuditMetadataIncluded: false`
- `objectStorageKeyIncluded: false`
- `patientIdentityIncluded: false`
- `patientContactIncluded: false`
- `patientLocationIncluded: false`
- `csvContentIncluded: false`

## Governance-read audit

Reading the governance timeline writes:

`ADMIN_TRANSPORT_REPORT_GOVERNANCE_TIMELINE_READ`

under object type:

`TRANSPORT_REPORT_GOVERNANCE`

This avoids recursively adding governance-view reads to the run's own lifecycle timeline.

## Admin UI

The Transport administration page adds:

`Report Governance Evidence`

Features:

- recent report-run selector
- current artifact state
- run/delivery state
- retention days
- notification count
- download receipt count
- artifact SHA-256 evidence
- legal-hold reason
- purge timestamp
- immutable timeline table
- audit sequence/event hash

## Environment

No new environment variables.

No `.env` file is added.

## Database

No database migration is required.

Phase 23 reuses:

- `AuditEvent`
- `AuditIntegrityRecord`
- existing Transport report run/delivery models

## Validation

`npm run v2:transport-phase23`

The smoke contract verifies:

- exact approved audit-action whitelist
- audit-integrity lookup
- BigInt sequence string conversion
- no raw audit metadata
- no object-storage key
- no patient/contact/location/CSV exposure
- separate governance-read audit object type
- Admin governance panel
- package test-chain registration
