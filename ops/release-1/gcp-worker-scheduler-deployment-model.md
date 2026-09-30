# CarePoint Release 1 — GCP worker and scheduler deployment model

Status: **engineering readiness contract / not production acceptance**

This document defines the Release 1 GCP deployment model for CarePoint background workers, scheduled jobs and one-shot operational jobs. It is additive to the OCI profile and does not replace the OCI deployment model.

## Fixed Release 1 scope

- Provider: Google Cloud Platform.
- Jurisdiction: Saudi Arabia (`SA`).
- Approved GCP region: Dammam `me-central2`.
- Exact immutable Release Candidate image digests are required. Mutable image tags are not acceptance evidence.
- No service-account JSON keys, static access tokens, `.env` files, PHI, production connection strings or secret values belong in the repository.

The machine-readable companion contract is `ops/release-1/gcp-worker-scheduler-deployment-contract.json`. CI validates that this document and that contract remain aligned.

## 1. Existing background/outbox workers

Release 1 currently contains background/outbox processing that is started with the API runtime. This slice does not pretend that those workers already have a separate executable or deployment artifact.

For the initial GCP profile, these workers therefore remain **API-colocated**. The Cloud Run service hosting the API must be configured so background work can continue reliably:

- scale-to-zero is forbidden while API-colocated durable workers are required;
- at least one warm instance is required;
- CPU allocation/billing must permit background processing outside active request handling;
- worker code must continue to use its existing database lease, retry, idempotency and durable-outbox semantics;
- unauthenticated public invocation of worker-only surfaces is forbidden;
- database and Redis connectivity must use the approved private production data plane;
- runtime identity must use the attached service account, never a downloadable service-account key.

A future change may split workers into a dedicated runtime only after a real worker entry point, independent health model, scaling semantics and release artifact have been implemented and reviewed.

## 2. Scheduled and batch work

Explicit scheduled/batch entry points should use **Cloud Run Jobs** in `me-central2`. Time-based invocation should use **Cloud Scheduler** in `me-central2` with authenticated OIDC/service-account invocation.

Required controls:

- the job uses the same exact Release Candidate image digest as the corresponding approved application release unless a separately versioned operational image is explicitly approved;
- the job has its own least-privilege service account when its permissions differ from the API;
- Cloud Scheduler may not invoke an unauthenticated public job surface;
- schedules, retry policy, timeout and concurrency are externally controlled and included in acceptance evidence;
- repeated invocation must be safe through idempotency, leases or another reviewed duplicate-suppression mechanism;
- migration/bootstrap or other destructive jobs require manual CAB/operator execution rather than an automatic recurring schedule;
- secrets are resolved at runtime from the approved regional secret path and are never embedded in scheduler payloads.

## 3. Queue-driven work

The current Release 1 durable pattern remains the database-backed outbox where already implemented. This model does not silently replace application durability semantics with a cloud queue.

For future discrete asynchronous work, Cloud Tasks may be used only after a dedicated contract is reviewed. Any such queue must remain in `me-central2`, use authenticated targets, bounded retries and a recoverable failure path.

## 4. Residency and network boundary

All production worker/job execution covered by this GCP Release 1 profile must remain in the approved `me-central2` region. Data-plane access must preserve the same Release 1 controls as the API runtime:

- private Cloud SQL connectivity;
- private/authenticated Redis connectivity;
- regional Secret Manager;
- approved Cloud KMS and Cloud Storage region bindings;
- OTLP and SIEM destination-region controls;
- no static cloud credentials.

Multi-zone execution inside Dammam is availability engineering; it is **not** evidence of geographic disaster recovery.

## 5. Observability and failure handling

Workers and jobs must emit structured operational logs and participate in the approved OTLP/SIEM path. Acceptance evidence must show enough information to correlate execution with the exact release artifact without logging PHI, secret values or raw credentials.

Production configuration must define bounded retries and timeouts. Failed durable work must remain recoverable and must not be silently discarded. A successful process exit is not sufficient evidence if application work remains pending or was abandoned.

## 6. Live evidence required before R3-GCP acceptance

This document and its CI smoke are design/readiness evidence only. Live acceptance still requires evidence from the real GCP environment showing:

1. exact immutable image digests deployed;
2. runtime service-account identities and least-privilege bindings;
3. API-colocated workers operating with the approved non-zero/minimum-instance and background-CPU model;
4. authenticated Cloud Scheduler invocation of a Cloud Run Job in `me-central2` where scheduled jobs are used;
5. lease/idempotency behavior under duplicate or concurrent execution;
6. bounded retry and recoverable-failure behavior;
7. private database/cache access and regional secret resolution;
8. OTLP/SIEM telemetry with no PHI or secret leakage;
9. operational recovery rehearsal and final measured RPO/RTO through the broader Release 1 gates.

`productionAcceptance` remains `false` in the repository contract. CI must never convert this document into self-approved live production evidence.

## 7. Geographic DR boundary

The current GCP profile still has no second approved Google Cloud KSA region. Cloud Run/Cloud Scheduler/Cloud Tasks availability in Dammam and multi-zone behavior do not close the separate geographic-DR decision. The Release 1 GCP tracker remains open until that decision and the required live recovery evidence are formally accepted.
