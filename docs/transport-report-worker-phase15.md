# Transport Phase 15 — Cloud Run Job Worker Integration

Branch: `feature/transport-report-worker-phase15-20260930`

## Objective

Phase 15 connects the durable Phase 14 report ledger to a production-shaped scheduled
worker without introducing another queue, database, service image, or static credential.

## Runtime

The worker uses the same immutable API release image and starts a Nest application
context only. It does not start an HTTP listener.

Command:

`node dist/scripts/run-transport-report-scheduler.js`

The intended GCP runtime is:

- Cloud Run Job
- region `me-central2`
- triggered by Cloud Scheduler
- OIDC service-account invocation
- no public unauthenticated invocation
- no static service-account keys
- no static access tokens

## Worker cycle

Each invocation performs one bounded cycle:

1. recover stale Phase 14 execution leases;
2. queue schedules that are due;
3. select oldest queued runs;
4. execute at most 25 runs sequentially;
5. persist Phase 14 success/failure evidence;
6. emit one structured cycle result.

The worker does not create a second scheduling state machine.

## Durability

Phase 15 reuses:

- `TransportManagementReportRun`
- unique `(scheduleId, scheduledFor)`
- five-minute lease
- five-attempt maximum
- stale-run recovery
- SHA-256 sanitized snapshot integrity

## System actor

Worker audit evidence uses:

`system:transport-report-scheduler`

with session marker:

`cloud-run-job:transport-report-worker`

This is an internal application-context principal only. It is not an HTTP bearer token,
credential, service-account key, or reusable external secret.

## Failure semantics

A failed report run is persisted as `FAILED` by Phase 14 and the cycle continues to the
next selected run. If any selected run fails, the process exits non-zero after the cycle so
Cloud Run Job execution evidence reflects partial failure.

Fatal bootstrap failures also exit non-zero.

## Privacy and delivery boundary

The worker preserves the Phase 14 privacy boundary:

- patient identity not persisted
- patient location not persisted
- complete report rows not persisted
- sanitized management snapshot only

Automatic report delivery remains unavailable:

- `automaticDeliveryAvailable: false`
- `reportDeliveryPerformed: false`

## Deployment contract

`ops/release-1/gcp-transport-report-worker-contract.json`

The repository contract intentionally keeps:

`productionAcceptance: false`

until live Cloud Scheduler / Cloud Run Job evidence exists.

## Environment

No new environment variables are introduced by Phase 15.

No `.env` file is added.

The worker consumes the same production runtime configuration already required by the API
image for database, audit/SIEM and approved cloud infrastructure.

## Validation

`npm run v2:transport-phase15`

validates:

- application-context worker entrypoint
- bounded batch size
- same-image command
- Cloud Run Job / Cloud Scheduler contract
- OIDC/no-static-key boundary
- lease/idempotency reuse
- privacy boundary
- no automatic delivery claim
- package test-chain registration
