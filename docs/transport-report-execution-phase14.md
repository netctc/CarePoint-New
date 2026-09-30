# Transport Phase 14 — Durable Report Execution Ledger

Branch: `feature/transport-report-execution-phase14-20260930`

## Objective

Phase 14 turns the Phase 13 management-report schedule definitions into a durable,
auditable execution ledger without claiming that CarePoint already owns an automatic
email/report-delivery worker.

The phase remains layered on Phase 13.

## Included

- durable `TransportManagementReportRun` records
- idempotency by `(scheduleId, scheduledFor)`
- due-schedule queueing
- one-catch-up-run-per-schedule bounded queue behavior
- explicit execution claim
- five-minute execution lease
- stale lease recovery
- bounded retry policy with a maximum of five attempts
- sanitized report snapshot generation through the Phase 12 management-report service
- SHA-256 snapshot integrity hash
- report summary / row-count / truncation evidence
- execution success/failure audit events
- Admin execution ledger UI
- explicit external-delivery boundary

## Database

New model:

`TransportManagementReportRun`

Important fields:

- scheduleId
- scheduledFor
- status
- attemptCount
- claimedAt
- leaseExpiresAt
- startedAt
- completedAt
- failedAt
- lastError
- reportGeneratedAt
- reportFilename
- reportFormat
- rowCount
- truncatedSource
- snapshotHash
- snapshotJson
- createdByAccountId

Unique constraint:

`(scheduleId, scheduledFor)`

This makes queueing the same scheduled occurrence idempotent.

## Run states

Supported persisted states:

- `QUEUED`
- `RUNNING`
- `SUCCEEDED`
- `FAILED`

A run must be `QUEUED` before execution.

A successfully completed run is immutable from the Phase 14 execution API.

## Queueing contract

`POST /admin/transport/report-runs/queue-due`

The endpoint:

1. selects enabled schedules whose `nextRunAt <= now`;
2. creates at most one run for each due schedule;
3. uses the unique schedule/due timestamp pair to prevent duplicates;
4. advances `nextRunAt` to the following cadence occurrence;
5. does not generate or deliver the report.

Queueing is intentionally bounded to one overdue occurrence per schedule per invocation.
This prevents an unexpectedly old schedule from creating an unbounded backlog in one request.

## Execution contract

`POST /admin/transport/report-runs/:runId/execute`

Execution:

1. atomically claims a `QUEUED` run;
2. increments `attemptCount`;
3. establishes a five-minute lease;
4. generates the sanitized Phase 12 management report using the schedule filters;
5. persists only a management snapshot, not the report rows;
6. calculates a SHA-256 integrity hash over the persisted snapshot;
7. marks the run `SUCCEEDED`;
8. updates the schedule `lastRunAt`.

The execution response does not expose the generated CSV rows.

## Snapshot boundary

The durable snapshot contains:

- schedule/run identity
- scheduled occurrence
- generation timestamp
- report filename/format
- row count
- source truncation indicator
- report filters
- aggregate management summary
- sensitive-data policy
- delivery-state metadata

It does not persist:

- patient identity
- patient contact
- pickup address
- destination address
- coordinates
- the complete per-request CSV row set

## Failure and retry

If generation fails:

- the run becomes `FAILED`;
- `lastError` is bounded to 1,000 characters;
- the lease is released;
- the failure is audited.

`POST /admin/transport/report-runs/:runId/retry`

Only failed runs below the five-attempt limit can be returned to `QUEUED`.

## Stale lease recovery

`POST /admin/transport/report-runs/recover-stale`

A `RUNNING` run whose lease expired:

- returns to `QUEUED` when attempts remain;
- becomes `FAILED` when the maximum attempt count has been reached.

This follows the existing CarePoint production scheduler requirement that background
work use a durable lease/idempotency mechanism.

## Read API

`GET /admin/transport/report-runs?status=ALL&limit=100`

Supported status filters:

- ALL
- QUEUED
- RUNNING
- SUCCEEDED
- FAILED

Limit is bounded to 1–200.

## Security

All Phase 14 Admin endpoints retain:

`TRANSPORT_OPERATE`

The Admin proxy continues to:

- validate path segments;
- bound request bodies;
- require same-origin for writes;
- validate report-run query parameters.

## Delivery boundary

Phase 14 still does not claim automatic delivery.

The persisted execution contract reports:

- `executionMode: DURABLE_LEDGER_EXTERNAL_TRIGGER`
- `automaticDeliveryAvailable: false`
- `reportDeliveryPerformed: false`

A production Cloud Scheduler / Cloud Run Job or equivalent authenticated worker can call
these endpoints in a later deployment/integration phase. Phase 14 provides the durable
application-side ledger needed for that integration.

## Infrastructure alignment

The repository's GCP worker/scheduler model already requires:

- Cloud Run Jobs for scheduled work
- Cloud Scheduler
- authenticated OIDC/service-account invocation
- lease/idempotency
- failed work to remain recoverable
- no public unauthenticated invocation

Phase 14 implements the application-side durable execution semantics without adding a
second scheduler technology.

## Environment

No new environment variables.

No `.env` file is added.

## Explicitly unchanged

- Patient Mobile
- Doctor Mobile
- Health Provider Mobile
- Transport Provider Mobile
- transport booking lifecycle
- transport GPS/telemetry lifecycle
- provider assignment authority
- payment behavior
- patient/location privacy boundaries

## Validation

Phase 14 adds:

`npm run v2:transport-phase14`

The smoke contract verifies:

- Prisma run model and schedule relation
- migration / unique idempotency key
- execution module registration
- lease/retry semantics
- sanitized snapshot boundary
- Admin proxy/UI wiring
- package test-chain registration
- documentation delivery boundary
