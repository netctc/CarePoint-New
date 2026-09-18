# Release 1 — R8 Versioned Performance Harness

Status: **SOURCE HARNESS IMPLEMENTED / FINAL TARGET-LOAD ACCEPTANCE PENDING**  
Primary blocker: #89  
R8 tracker: #88  
Canonical branch: `release/release-1-integration-go-live-readiness`

## Purpose

This document defines the repository-side Release 1 load/performance harness required by #89. It creates a reproducible, versioned performance contract without inventing production traffic volumes, user concurrency, arrival rates, error budgets, capacity targets or infrastructure saturation thresholds.

The final Release 1 performance gate still requires an approved traffic model and execution against the exact Release Candidate in the production-equivalent topology accepted under #79, with real enabled providers under #80 where the scenario depends on them.

## Versioned harness

Harness:

`node .ci/release-performance-harness.mjs`

Draft scenario catalog:

`ops/release-1/performance-traffic-model.example.json`

Repository validation workflow:

`.github/workflows/performance-harness-contract.yml`

The harness uses only Node.js platform APIs. It does not add a runtime dependency or embed credentials. Request/response bodies, URLs containing resolved fixture identifiers, bearer tokens and provider signatures are deliberately excluded from result evidence.

## Mandatory Release 1 scenarios

The harness contract requires every approved traffic model to enable all nine scenario kinds:

1. `common-read` — authenticated patient/application read mix.
2. `search` — structured provider/service discovery.
3. `availability-read` — service/modality slot reads.
4. `booking-race` — distinct idempotency keys racing for the same final slot.
5. `booking-lifecycle` — controlled appointment lifecycle load on synthetic fixtures.
6. `webhook-replay` — repeated enabled-provider webhook ingestion/replay.
7. `notification-event` — lifecycle load that exercises durable notification/outbox production.
8. `telehealth-start` — backend consultation join/session-token spike.
9. `admin-read` — representative operational Admin read load.

The draft catalog maps these categories to existing Release 1 routes such as `/api/v1/services/discovery`, `/api/v1/availability`, `/api/v1/bookings`, `/api/v1/telehealth/appointments/:appointmentId/join`, `/api/v1/telehealth/webhooks/livekit` and `/api/v1/admin/operations/analytics/workspace`.

The catalog is intentionally **not executable**: `approved=false`, scenarios are disabled, load stages are empty and launch thresholds/references are pending. Product/Operations/Infrastructure must approve the real traffic model before execution.

## Source-derived performance thresholds

The following thresholds are hard-coded as mandatory Release 1 gates and cannot be relaxed by the traffic model:

- `common-read`: p95 **< 500 ms**.
- `search`: p95 **< 800 ms**.

The harness records p50/p95/p99 latency, throughput, HTTP/network errors, timeout rate, response-status distribution and the configured concurrency stage profile.

Additional limits such as maximum error rate, maximum timeout rate, p99, minimum throughput, capacity/headroom and saturation policy are **not invented by engineering**. The approved traffic model must provide the error and timeout thresholds; optional throughput/p99 thresholds may be added only when approved.

## Exact candidate and environment binding

A real run refuses to execute unless all of the following are true:

- `model.approved=true`;
- an approved traffic-model reference is present;
- the model source SHA is a full Git SHA and exactly matches the checked-out repository SHA;
- an immutable RC artifact digest and build reference are supplied;
- the environment is explicitly classified `production-equivalent`;
- the base URL resolves to HTTPS and is not localhost;
- R3 topology/environment evidence references exist;
- OTLP observation-window, saturation and autoscaling evidence references exist;
- all nine mandatory scenarios are enabled;
- every scenario has approved error and timeout thresholds;
- `CAREPOINT_PERF_EXECUTION_APPROVED=true` is set by the operator inside the authorized performance window.

The harness deliberately refuses direct production traffic by default. This is a safety control, not a statement that production testing can never be approved through a separate governed process.

## Traffic model and secret handling

Copy the example only after the target load model is approved. Keep the approved model free of secrets and real PHI. Sensitive headers and fixture identifiers use environment placeholders such as:

- `${CAREPOINT_PERF_PATIENT_TOKEN}`;
- `${CAREPOINT_PERF_PROVIDER_TOKEN}`;
- `${CAREPOINT_PERF_ADMIN_TOKEN}`;
- `${CAREPOINT_PERF_FINAL_SLOT_ID}`;
- `${CAREPOINT_PERF_LIVEKIT_WEBHOOK_AUTHORIZATION}`.

The special `${CAREPOINT_PERF_REQUEST_ID}` placeholder is generated independently for each request. The booking-race example uses it in `idempotencyKey` so the concurrency test is not accidentally reduced to repeated execution of one idempotent request.

Do not place passwords, API keys, access/refresh tokens, private keys, patient names, MRNs, national identifiers or dates of birth in the versioned model or public result artifact.

## Scenario-specific acceptance evidence

HTTP timings alone are not sufficient for several high-risk cases, so the approved model must link additional sanitized evidence:

- `booking-race`: database/application integrity evidence showing that the final slot was not double-consumed.
- `webhook-replay`: provider/application idempotency-integrity evidence showing no duplicate state transition or financial side effect where applicable.
- `notification-event`: durable outbox/worker evidence.
- `telehealth-start`: real LiveKit/provider room/join/media capacity evidence from the R4-approved environment.

The Node harness measures the CarePoint backend telehealth start path; it deliberately does **not** pretend that HTTP token/session timing proves WebRTC media/provider capacity.

## Running the harness

Repository contract/self-test:

```bash
node .ci/release-performance-harness.mjs --self-test
node .ci/release-performance-harness.mjs --validate-draft ops/release-1/performance-traffic-model.example.json
```

Final controlled run after an approved non-secret model exists:

```bash
export CAREPOINT_PERF_EXECUTION_APPROVED=true
# Set the approved production-equivalent base URL, tokens and synthetic fixture identifiers through the controlled environment.
node .ci/release-performance-harness.mjs \
  --run ops/release-1/performance-traffic-model.json \
  --out performance-results
```

The output contains only sanitized metrics/evidence references:

- `performance-results/performance-result.json`;
- `performance-results/SHA256SUMS`.

A mandatory threshold or scenario invariant failure causes a non-zero process exit and must block Release 1 until the failure is resolved or the candidate changes and is retested.

## Booking race behavior

`booking-race` is a single burst against one pre-provisioned final slot. The approved model defines the number of attempts and expected success count. Each attempt receives a distinct runtime request ID/idempotency key. The harness checks the expected success count and rejects unexpected statuses, while the linked integrity evidence must confirm the persistent appointment/capacity state.

This complements, but does not replace, the existing transactional/idempotent scheduling acceptance tests.

## Results and observability

Every accepted run must preserve:

- exact Release Candidate SHA/version/artifact digest;
- approved traffic-model reference;
- production-equivalent environment/topology references;
- stage concurrency and observed duration;
- p50/p95/p99;
- throughput;
- error and timeout rates;
- status distribution;
- OTLP correlation-window reference;
- PostgreSQL/Redis/API saturation evidence reference;
- autoscaling/replica evidence reference;
- scenario-specific booking/webhook/outbox/provider evidence.

The results intentionally do not contain request paths after environment substitution, response bodies, tokens, provider signatures or patient/clinical data.

## What this advances and what remains open

This closes the repository/source gap identified by #89: Release 1 now has a versioned harness, mandatory scenario catalog, executable source-derived p95 gates, exact-SHA binding, concurrency-race semantics, metric collection, public-evidence sanitization and deterministic contract validation.

It **does not close #89**. Final closure still requires:

- an approved traffic/concurrency/ramp model from Product/Operations/Infrastructure;
- the production-equivalent environment/topology from #79;
- real enabled-provider paths/evidence from #80, especially LiveKit/provider capacity and webhook behavior;
- an exact final Release Candidate artifact from R10/#97;
- accepted target-load execution results;
- capacity/headroom and scaling observations;
- any failure-mode/continuity evidence owned by #90.

Until those external/operational inputs exist, R8 remains **BLOCKED / IN PROGRESS** and Release 1 remains NO-GO for production promotion.
