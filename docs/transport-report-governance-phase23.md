# Transport Phase 23 — Report Governance Dashboard

Branch: `feature/transport-report-governance-dashboard-phase23-20260930`

## Objective

Phase 23 provides a bounded, descriptive Admin governance view over Transport management
report artifacts, retention deadlines, legal holds, purge activity, delivery attention and
recipient download receipts.

It does not rank providers, predict outcomes or mutate report state.

## API

`GET /admin/transport/report-governance`

Permission:

`TRANSPORT_OPERATE`

Cache:

`no-store`

## Bounded source

The endpoint reads at most:

`2,000`

successful report runs with artifact history.

The response returns at most:

`250`

governance rows.

If the source cap is reached:

`summary.sourceCapped = true`

The UI explicitly warns that summary counts then cover the bounded source window only.

## Governance states

Each row is classified deterministically as one of:

- `LIVE`
- `DUE`
- `LEGAL_HOLD`
- `PURGE_CLAIMED`
- `PURGED`

Classification uses only persisted artifact/retention state and the current timestamp.

No machine learning or subjective scoring is used.

## Expiry calculation

For a live artifact:

`expiresAt = artifactStoredAt + schedule.artifactRetentionDays`

The API returns:

- exact expiresAt
- integer daysUntilExpiry
- configured retention days

## Summary

The dashboard reports:

- source runs
- source-cap flag
- live artifacts
- purged artifacts
- legal holds
- active purge claims
- retention-due artifacts
- artifacts expiring within 7 days
- artifacts expiring within 30 days
- recipient download receipts
- runs requiring delivery attention

## Row details

Each visible governance row includes:

- run ID
- report filename
- scheduled time
- artifact stored/deleted timestamps
- artifact byte count
- legal-hold state/reason/timestamp
- active purge-claim timestamp
- deterministic expiry timestamp
- days until expiry
- governance state
- delivery status
- recipient download-receipt count
- schedule name/ID/retention days

## Privacy boundary

The governance query does not select or return:

- artifactObjectKey
- patient identity
- patient contact
- pickup address
- destination address
- coordinates

Response policy explicitly states:

- `patientIdentityIncluded: false`
- `patientLocationIncluded: false`
- `objectStorageKeyIncluded: false`

## Audit

Read event:

`ADMIN_TRANSPORT_REPORT_GOVERNANCE_READ`

Purpose:

`DATA_RETENTION`

Audit metadata records bounded summary counts and the same privacy boundary.

## Admin UI

New panel:

`TransportReportGovernancePanel`

Title:

`Report Retention & Access Governance`

It provides summary cards and a bounded governance table.

Legal-hold mutation remains in the Phase 22 execution ledger rather than being duplicated
inside this read-only dashboard.

## Database / environment

No new Prisma model.

No Phase 23 database migration.

No new environment variables.

No `.env` file is added.

## Validation

`npm run v2:transport-phase23`

The smoke contract verifies:

- bounded 2,000-run source
- bounded 250-row response
- deterministic governance states
- retention expiry calculation
- source-cap disclosure
- governance summary
- object-storage key exclusion
- patient/location exclusion
- audit event
- Admin dashboard wiring
- package test-chain registration
