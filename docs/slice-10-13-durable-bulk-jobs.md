# Slice 10.13 — Durable FHIR Bulk Jobs & Production Worker/Storage Hardening

## Objective

Close Phase A of the CarePoint interoperability roadmap by making FHIR Bulk Data jobs recoverable across API process restarts and transient Redis state loss without changing the validated Slice 10.10–10.12 export contract or clinical security boundaries.

## Durable job state

`FhirBulkExportJobState` is the PostgreSQL source of truth for Bulk Data job metadata. The existing Slice 10 job JSON remains the payload format so rolling upgrades do not require a second domain representation.

The durable row stores:

- job id and owning SMART backend client id;
- current status and complete validated job payload;
- next `availableAt` execution time;
- `leaseOwner` / `leaseUntil` for multi-instance claims;
- processing attempt count and last safe error;
- `purgeAt` retention deadline.

No clinical ciphertext, plaintext clinical notes, document binary content, PACS credentials, SMART private keys or bearer tokens are added by this migration. The payload contains the same scope/client/job metadata already held by the Slice 10.10–10.12 job state.

## Redis compatibility

Redis remains required for distributed security controls, rate limiting, cancellation markers and the existing processing lock. During rolling deployment the durable layer also mirrors the legacy `carepoint:fhir:bulk-export:<jobId>` state so old and new API instances can coexist.

Reads prefer PostgreSQL and can restore the compatibility key if Redis state is absent. `BULK_EXPORT_REDIS_COMPAT_WRITE=false` can be used only after all running instances no longer depend on the legacy state key.

## Worker and recovery

Every API instance may run the recovery worker. PostgreSQL `updateMany` conditions atomically claim a job only when:

- status is `QUEUED` or `RUNNING`;
- `availableAt` has arrived;
- retention has not expired;
- no live lease exists.

A claimant writes `leaseOwner`, `leaseUntil` and increments `attemptCount`. If the instance crashes, the lease expires and another instance may recover the job. The existing Redis processing lock remains defense in depth while mixed-version instances are deployed.

Object keys remain deterministic (`<jobId>/<resourceType>-NNNNN.ndjson`), so a recovered attempt safely overwrites its own private output instead of creating unbounded duplicate objects.

## Retry policy

Only the generic transient failure `FHIR bulk export processing failed.` is eligible for automatic retry. Validation, authorization and safety-limit failures remain terminal.

Retries are bounded by `BULK_EXPORT_MAX_ATTEMPTS` and use exponential backoff based on `BULK_EXPORT_RETRY_BASE_SECONDS`, capped at five minutes.

## Expiration and cleanup

The worker periodically selects rows whose `purgeAt` has passed, removes every recorded private artifact and deletes both PostgreSQL and Redis compatibility state. Production S3 lifecycle configuration remains mandatory defense in depth if application cleanup cannot run.

## Configuration

- `BULK_EXPORT_WORKER_ENABLED` — enable recovery/cleanup worker.
- `BULK_EXPORT_WORKER_POLL_MS` — recoverable-job scan interval.
- `BULK_EXPORT_WORKER_LEASE_SECONDS` — claim lease duration.
- `BULK_EXPORT_WORKER_BATCH_SIZE` — maximum recoverable jobs per pass.
- `BULK_EXPORT_MAX_ATTEMPTS` — maximum retry attempts for transient failures.
- `BULK_EXPORT_RETRY_BASE_SECONDS` — exponential retry base delay.
- `BULK_EXPORT_CLEANUP_INTERVAL_SECONDS` — expired-job cleanup interval.
- `BULK_EXPORT_CLEANUP_BATCH_SIZE` — cleanup batch size.
- `BULK_EXPORT_REDIS_COMPAT_WRITE` — rolling-deployment compatibility mirror.

Existing storage and safety configuration remains unchanged.

## Acceptance

The Slice 10.13 smoke test verifies:

1. a normal `$export` kickoff is persisted in PostgreSQL before the request completes;
2. a `QUEUED` job that exists only in PostgreSQL is claimed and completed by the worker;
3. lease/attempt metadata records worker recovery;
4. deleting completed-job Redis state does not lose status because PostgreSQL rebuilds compatibility state;
5. expired durable rows are removed by cleanup;
6. the complete Slice 10.0–10.12 regression suite remains green.

## Scope boundaries

Slice 10.13 does not add resources, SMART scopes, interactive clinical access, `_typeFilter` capabilities or new clinical storage. All Slice 10.12 encryption, attestation, RELEASED gates, client ownership, rate limits, NDJSON limits and SHA-256 integrity checks remain in force.
