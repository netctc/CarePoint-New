# Transport Phase 21 — Report Artifact Retention + Secure Purge

Branch: `feature/transport-report-retention-phase21-20260930`

## Objective

Phase 21 adds configurable retention and secure deletion of private Transport
management-report CSV artifacts while preserving operational/audit evidence.

## Schedule retention policy

`TransportManagementReportSchedule` adds:

`artifactRetentionDays`

Default:

`90`

Allowed API range:

- minimum: 7 days
- maximum: 3650 days

The Admin schedule UI provides common choices:

- 30 days
- 90 days
- 180 days
- 365 days
- 730 days

Changing retention alone does not recalculate or shift the existing `nextRunAt`.

## Run purge evidence

`TransportManagementReportRun` adds:

`artifactDeletedAt`

When a private artifact reaches its configured retention age:

1. the worker deletes the object from private storage;
2. only after successful object deletion, the run is atomically marked purged;
3. `artifactObjectKey` is cleared;
4. `artifactDeletedAt` is recorded;
5. active one-time download grants are invalidated.

The following evidence remains:

- artifact SHA-256
- artifact byte count
- content type
- storage provider
- original stored-at timestamp
- sanitized run snapshot
- report/run metadata
- immutable audit history

## Storage behavior

`TransportReportArtifactStorageService.deleteCsv()` supports:

- private local non-production storage
- GCP Cloud Storage
- OCI Object Storage

Local delete treats an already missing file as an idempotent success.

Production deletion uses the existing provider-neutral runtime and the dedicated
`transport-management-reports` storage domain.

## Retention worker

`TransportReportRetentionService`

One cycle:

- scans bounded successful runs with live artifacts;
- evaluates expiry from each run's schedule policy;
- processes at most the configured bounded batch;
- deletes due private objects;
- records purge evidence;
- invalidates unconsumed download grants;
- writes success/failure audit evidence.

Storage failure is fail-closed:

- the database is not marked purged;
- the object key remains;
- a later worker invocation can retry.

## Cloud Run Job

The existing Transport report Cloud Run Job now runs:

1. report generation
2. report-ready delivery notification
3. artifact retention/purge

Structured worker output includes a `retention` result.

Any purge failure makes the job execution non-zero after the bounded cycle, while the
failed artifact remains durable for retry.

## Audit

Successful purge:

`SYSTEM_TRANSPORT_REPORT_ARTIFACT_PURGED`

Failed purge:

`SYSTEM_TRANSPORT_REPORT_ARTIFACT_PURGE_FAILED`

Purpose:

`DATA_RETENTION`

## Inbox and download behavior

A purged report:

- remains visible as historical evidence;
- shows `PURGED` in the execution ledger;
- is not offered for secure download;
- returns `artifactAvailable: false` in the recipient inbox;
- cannot receive a Phase 19 download grant because `artifactObjectKey` was cleared.

## Privacy

Retention processing does not read or expose patient identity/location data.

Audit metadata states:

- `patientIdentityIncluded: false`
- `patientLocationIncluded: false`

## Environment

No new environment variables.

No `.env` file is added.

## Database migration

`20261001005000_v2_transport_report_artifact_retention`

## Validation

`npm run v2:transport-phase21`

The smoke contract verifies:

- schedule retention policy
- run purge evidence
- private storage delete support
- bounded retention worker
- delete-before-database-purge ordering
- grant invalidation
- hash/byte evidence retention
- fail-closed purge behavior
- Admin retention controls
- PURGED ledger state
- recipient inbox artifact availability
- Cloud Run Job retention cycle
- package test-chain registration
