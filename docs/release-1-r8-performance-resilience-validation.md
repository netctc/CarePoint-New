# Release 1 — R8 Performance, Resilience and Failure-Mode Validation

## 1. Purpose

R8 is the Release 1 performance, capacity, resilience and continuity validation workstream.

Canonical branch:

`release/release-1-integration-go-live-readiness`

R8 starting baseline:

`17ee34635f412ae018a0c216e03817e0d841a548`

R8 tracker: #88

Dedicated P0 closure issues:

- #89 — versioned Release 1 load/performance harness and threshold gate;
- #90 — production-equivalent resilience, failure-injection and continuity acceptance.

R8 converts the approved CarePoint non-functional requirements into measurable Release Candidate evidence. It does not treat source review, configuration preflight or a functional smoke test as proof that a production topology meets performance, availability or recovery objectives.

## 2. Approved Release 1 source requirements

The approved functional/technical specification defines the following Release 1 objectives.

### 2.1 Performance

**NFR-PERF-01**

- common API reads: p95 < 500 ms under target load;
- search: p95 < 800 ms under target load, excluding external-provider latency.

The specification does not define a concrete Release 1 peak-RPS, virtual-user or concurrency number. R8 therefore must not invent one. Product, Operations and Infrastructure must approve the target load model used for the release gate.

### 2.2 Scale and availability

**NFR-SCALE-01**

Application services must be stateless and horizontally scalable, without local sticky-session dependency.

**NFR-AVAIL-01**

- initial availability objective: 99.9%;
- architecture prepared for 99.95% in critical domains.

R8 validates failure and capacity characteristics that support these objectives. Long-term production availability measurement belongs to ongoing operations as well as Release 1 acceptance.

### 2.3 Continuity

**NFR-RPO-01**

- transactional-data RPO <= 15 minutes;
- PITR enabled;
- later objective <= 5 minutes.

**NFR-RTO-01**

- MVP RTO <= 2 hours;
- later objective <= 30 minutes for critical components.

The later targets are not promoted into Release 1 unless separately approved.

### 2.4 Observability

**NFR-OBS-01** requires metrics, structured logs, distributed traces and SLO alerts.

### 2.5 Required test categories

The approved quality strategy requires load testing using k6, Gatling, Locust or an equivalent tool for:

- search;
- concurrent booking;
- telemedicine token/join;
- webhooks.

It also requires load coverage for:

- slot concurrency;
- mass search;
- events;
- notifications;
- spikes at the beginning of video calls.

The approved resilience strategy explicitly requires failure testing for:

- PSP failure;
- timeouts;
- retries;
- Redis loss;
- database replica lag;
- unavailable telemedicine provider.

### 2.6 Release-integrity acceptance criteria

R8 must preserve and prove the release-level integrity expectations that overlap performance/resilience:

- **AC-05** — two concurrent requests for the final slot must not double-book;
- **AC-09** — a repeated payment webhook must not duplicate a charge or state transition;
- **AC-10** — temporary notification-provider outage must not prevent unaffected reads.

## 3. Current repository baseline

Overall R8 status: **BLOCKED / IN PROGRESS**.

The Release 1 tree has substantial code-side production readiness, observability and deterministic resilience smoke coverage. It does not yet provide the measured production-equivalent acceptance required to close R8.

### 3.1 Existing observability foundation

The API has a global request observability interceptor that:

- accepts or generates a bounded request ID;
- creates/propagates trace and span context;
- measures request duration with a monotonic high-resolution timer;
- records HTTP method, route, response status and duration;
- emits structured request logs;
- exports request observations to the CarePoint OTLP exporter.

The OTLP exporter includes:

- HTTP request count metrics;
- HTTP request-duration histogram metrics;
- explicit duration buckets from milliseconds through 10 seconds;
- trace sampling;
- a bounded in-memory trace queue;
- a dropped-span counter;
- bounded exporter timeouts;
- rate-limited/sanitized exporter-failure logs.

Production configuration forbids `OTEL_SDK_DISABLED=true` and requires configured OTLP endpoints.

This is a strong instrumentation basis for R8 measurements. It is not evidence that the selected collector, dashboards, alerts or production environment are operational; that deployment evidence remains linked to R3 #79.

### 3.2 Existing Redis readiness controls

Production Redis preflight verifies, among other controls:

- an authenticated TLS Redis endpoint;
- writable-primary role;
- write/read/delete probe;
- configured minimum connected replicas;
- explicit persistence model;
- expected persistence status where directly inspectable;
- bounded connection/request behavior;
- secret-redacted failures.

The deterministic C4 smoke covers accepted and rejected configurations.

This proves startup/readiness policy. It does not simulate live Redis loss or managed failover under active CarePoint traffic.

### 3.3 Existing PostgreSQL readiness and recovery controls

Production PostgreSQL preflight checks:

- TLS on the active connection;
- writable primary rather than a recovery/read-only endpoint;
- minimum PostgreSQL version;
- minimum streaming replicas when `DATABASE_HA_MODE=replicated`;
- WAL/archive prerequisites when native PITR mode is configured.

C11 additionally provides a deterministic CI disaster-recovery drill that:

1. deploys the schema to an isolated source PostgreSQL instance;
2. seeds a synthetic PHI-free recovery fixture;
3. creates a logical custom-format backup;
4. restores it to an independent clean PostgreSQL instance;
5. verifies the fixture and migration state;
6. starts the CarePoint API against the restored database;
7. requires the health endpoint to become healthy.

C11 proves a useful functional recovery path. It does **not** demonstrate the selected managed production topology's PITR window, failover behavior or measured end-to-end Release 1 RPO/RTO.

### 3.4 Existing notification/outbox resilience

The notification worker smoke demonstrates code-side behavior for:

- bounded batches;
- leases;
- retries/backoff;
- finite attempt count;
- transient-provider failure requeue;
- terminal failure state;
- failure auditing;
- no persistence of raw provider error detail;
- production prohibition of the mock external notification gateway.

This supports AC-10 at the implementation layer. R8 still requires an actual provider-outage exercise while unaffected application traffic is running.

### 3.5 Existing payment failure boundaries

The payment gateway implementation provides:

- idempotency keys for external payment/refund/payout write requests;
- bounded financial gateway timeout policy;
- redirect rejection;
- bounded provider response parsing;
- normalized provider transport/response failures;
- trusted hosted-action URL validation;
- production prohibition of the mock PSP.

The gateway itself does not establish a production-equivalent PSP outage/replay acceptance result. R8 must prove the complete financial orchestration and webhook behavior with the R4-approved provider profile.

### 3.6 Existing telehealth provider boundary

Production telehealth requires LiveKit and server-side credentials; the mock provider is not allowed in production. Join tokens are scoped to room/participant and webhook verification uses LiveKit server-side credentials.

The token-mint path is not equivalent to a live provider room/join/media operation. R8 provider-unavailability testing must exercise the actual launch room/join/network path in conjunction with R4 #80 and, where native clients are required, R5 #81.

## 4. Identified Release 1 gaps

### 4.1 No visible dedicated load/performance harness

The inspected Release 1 `.ci` inventory, `services/api/scripts` inventory, API package scripts and root package scripts expose extensive functional, security, preflight and recovery smokes, but do not expose a dedicated k6/Gatling/Locust or equivalent versioned load harness or performance-threshold command.

This is tracked as P0 #89.

The absence of that harness means the repository currently cannot demonstrate source-derived p95 thresholds or produce a reproducible Release Candidate capacity profile from the standard release workflow.

### 4.2 Target launch load model is not defined in the approved specification

The specification gives latency objectives and scenario classes but does not provide concrete peak concurrency/RPS, user population, request mix, burst multiplier or dataset-size targets.

R8 requires an approved load model before a final capacity verdict. Engineering must not choose arbitrary production numbers merely to make a test pass.

Minimum load-model inputs:

| Input | Required decision/evidence |
| --- | --- |
| Active user mix | Patient / Doctor / Other Provider / Admin proportions |
| Request mix | Search, reads, booking, messages, finance, admin, telemetry-sensitive flows |
| Peak concurrency/arrival rate | Approved launch assumption |
| Burst model | Appointment opening, reminder wave, campaign/marketing or other approved peak event |
| Dataset scale | Patients, providers, services, slots, appointments and operational records represented in test |
| External providers | Which paths are mocked for isolated API measurement vs real for end-to-end provider acceptance |
| Test duration | Smoke, ramp, steady-state, spike and optional soak durations |
| Headroom policy | Approved safe operating margin before scale-up/degradation |

### 4.3 Production-equivalent failure injection is missing

Static/preflight tests do not substitute for:

- Redis loss/failover under traffic;
- PostgreSQL failover/replica-lag/PITR exercises in the selected managed topology;
- notification-provider outage under normal application traffic;
- PSP timeout/error/replay under the selected provider contract;
- LiveKit/provider/network outage at actual join/media path;
- OTLP collector outage/recovery;
- worker death during leased durable work.

This is tracked as P0 #90.

### 4.4 Measured RPO/RTO evidence is missing

The CI restore drill is deterministic but does not measure the production-equivalent recovery point or the complete operational recovery interval. R8/#90 and R3/#79 must provide measured evidence for:

- transactional RPO <= 15 minutes;
- MVP RTO <= 2 hours.

## 5. R8 performance test matrix

| ID | Scenario | Source objective | Required measurement | Current state |
| --- | --- | --- | --- | --- |
| R8-PERF-001 | Common API read mix | NFR-PERF-01 | p50/p95/p99, throughput, errors, saturation | BLOCKED — #89 + load model |
| R8-PERF-002 | Provider/service search | NFR-PERF-01 | p50/p95/p99; search p95 < 800 ms excluding named external latency | BLOCKED — #89 |
| R8-PERF-003 | Availability/slot reads | load strategy | latency, throughput, DB/cache load | BLOCKED — #89 |
| R8-PERF-004 | Concurrent final-slot booking | AC-05 / FR-SCH-002 | latency + exactly one valid capacity consumption + conflict results | BLOCKED — #89 / #75 |
| R8-PERF-005 | Booking/status write load | quality strategy | latency, errors, DB locks/contention, notification-outbox growth | BLOCKED — #89 / #78 |
| R8-PERF-006 | Webhook burst/replay | load strategy / AC-09 | ingress rate, latency, duplicate-side-effect count = 0 | BLOCKED — #89 / #80 |
| R8-PERF-007 | Notification/event load | load strategy | enqueue latency, queue depth, worker throughput, retry/failure rate | BLOCKED — #89 / #78/#80 |
| R8-PERF-008 | Telehealth-start spike | load strategy | token/session latency plus actual room/join success/latency | BLOCKED — #89 / #80/#81 |
| R8-PERF-009 | Horizontal scale | NFR-SCALE-01 | behavior across multiple application replicas; no local sticky-session requirement | BLOCKED — #79/#89 |
| R8-PERF-010 | Capacity/headroom | release capacity gate | saturation point, approved safe operating envelope | BLOCKED — load model/#79/#89 |

## 6. R8 resilience and failure-mode matrix

| ID | Fault | Source | Safe expectation | Current state |
| --- | --- | --- | --- | --- |
| R8-RES-001 | Notification provider unavailable | AC-10 / resilience strategy | unaffected reads continue; durable notifications recover without duplicate delivery | BLOCKED — #90/#80 |
| R8-RES-002 | Notification worker killed during lease | outbox reliability | work recovered after lease; no lost/duplicate terminal outcome | BLOCKED — #90/#79 |
| R8-RES-003 | PSP timeout/5xx/invalid response | resilience strategy | visible failure/pending state; no silent success; financial reconciliation preserved | BLOCKED — #90/#80 |
| R8-RES-004 | PSP request retry / webhook replay | AC-09 | no duplicate charge/refund/state transition | BLOCKED — #90/#80 |
| R8-RES-005 | Redis connection loss | resilience strategy | documented fail-closed/degraded behavior; no unsafe duplicate side effects | BLOCKED — #90/#79 |
| R8-RES-006 | Redis managed failover | resilience strategy | bounded disruption and safe recovery; no retry storm | BLOCKED — #90/#79 |
| R8-RES-007 | PostgreSQL primary failover | continuity/resilience | write integrity; service recovers within accepted operations envelope | BLOCKED — #90/#79 |
| R8-RES-008 | PostgreSQL replica lag | resilience strategy | read semantics remain safe for workflows assigned to replicas; no stale unsafe decision | BLOCKED — architecture/topology decision/#90 |
| R8-RES-009 | PITR restore | NFR-RPO-01 | recovery point within 15 minutes; integrity verified | BLOCKED — #90/#79 |
| R8-RES-010 | Full recovery | NFR-RTO-01 | accepted service restored within 2 hours | BLOCKED — #90/#79 |
| R8-RES-011 | LiveKit unavailable | resilience strategy | join failure is explicit; no false active-consultation state or cross-session leakage | BLOCKED — #90/#80/#81 |
| R8-RES-012 | Client/provider network interruption during telehealth | resilience strategy | safe/recoverable room state; operational events remain coherent | BLOCKED — #90/#80/#81 |
| R8-RES-013 | OTLP collector unavailable/slow | NFR-OBS-01 | application not unsafely coupled to telemetry; exporter failure/drops observable | BLOCKED — #90/#79 |
| R8-RES-014 | Critical dependency failure during booking | AC-05 / FR-OPS-001 | no ambiguous success or duplicate booking | BLOCKED — #90 |
| R8-RES-015 | Critical dependency failure during emergency request | patient-safety flow | no false dispatch success; retry/idempotency preserves one request | BLOCKED — #90 / launch dispatch model |
| R8-RES-016 | Critical dependency failure during clinical write | data integrity | committed or visibly failed; no silent partial/ambiguous clinical state | BLOCKED — #90 |

## 7. Load-harness contract for #89

R8 does not prescribe k6 over Gatling/Locust if another approved equivalent is more appropriate. It does require the selected harness to be repository-versioned and reproducible.

### 7.1 Configuration must be externalized

The harness should receive environment-specific values through approved runtime configuration/secrets rather than hard-coding:

- API base URL;
- synthetic test accounts/tokens;
- provider test endpoints where applicable;
- test data/fixture references;
- concurrency/arrival-rate model;
- duration/ramp profile;
- scenario selection;
- evidence/result output location.

### 7.2 Mandatory safety controls

- Production must not be the default target.
- A deliberate environment guard must prevent accidental destructive load against an unapproved host.
- Real PHI must not be required.
- Payment test data must use PSP test/sandbox tokens/accounts.
- Provider secrets must not be logged or persisted in test artifacts.
- Load-generated state must be identifiable and cleanable under an approved procedure.

### 7.3 Required result fields

Every accepted run must record:

- exact Git SHA/build;
- execution timestamp;
- target environment identifier;
- infrastructure topology/version reference;
- load-harness version;
- scenario;
- dataset scale;
- user/request mix;
- arrival rate/concurrency;
- ramp/steady/spike duration;
- p50/p95/p99;
- throughput;
- HTTP/application failure rate;
- timeout rate;
- API CPU/memory/replicas where available;
- PostgreSQL connections/locks/latency/saturation indicators where available;
- Redis latency/connections/failover indicators where available;
- worker queue depth/throughput where applicable;
- external-provider latency/error data where included;
- OTLP/dashboard/correlation evidence reference;
- PASS/FAIL/BLOCKED;
- defect and retest reference.

## 8. Performance threshold policy

### 8.1 Mandatory source-derived thresholds

The following thresholds are Release 1 requirements and may not be weakened by the load harness without an explicit approved requirements change:

| Measure | Release 1 threshold |
| --- | --- |
| Common API reads | p95 < 500 ms under approved target load |
| Search | p95 < 800 ms under approved target load, excluding explicitly identified external-provider latency |

### 8.2 Thresholds requiring launch approval

The source does not prescribe exact values for:

- tolerated HTTP/application error percentage under target load;
- maximum DB/Redis utilization;
- exact throughput/RPS;
- maximum queue depth/age;
- exact autoscale trigger;
- spike multiplier;
- soak duration;
- capacity headroom percentage.

Those values must come from the approved launch traffic/SLO/operations model. R8 must label them as management/operations decisions, not as source requirements.

## 9. Failure-injection procedure contract for #90

Each failure exercise must record five phases.

### A. Baseline

- exact Release Candidate healthy;
- normal synthetic traffic running;
- telemetry/correlation window recorded;
- critical data-integrity counters captured before the fault.

### B. Fault injection

Record the exact controlled fault and start timestamp. Examples include provider network block, service stop, managed failover action, worker kill or collector blackhole according to the approved environment.

### C. Degraded behavior

Record:

- affected functions;
- unaffected functions;
- latency/error changes;
- user-visible behavior;
- queue/retry behavior;
- any fail-open/fail-closed decision;
- booking/payment/emergency/clinical integrity.

### D. Recovery

Record:

- dependency-recovery timestamp;
- application automatic/manual recovery steps;
- backlog drain/replay behavior;
- duplicate count;
- integrity verification;
- alert recovery.

### E. Acceptance

Mark PASS only if the documented safe expectation and applicable source target are satisfied. Otherwise create a release-blocking defect and retest after correction.

## 10. Continuity measurement method

### 10.1 RPO

For the production-equivalent PITR/restore exercise:

1. create a sequence of timestamped synthetic transactional markers through normal application/database paths;
2. declare the recovery-point test time;
3. execute the approved backup/PITR recovery method into an isolated restored environment;
4. identify the latest correctly restored transactional marker;
5. calculate the recovery-point gap;
6. verify it is <= 15 minutes;
7. validate representative relational, audit and application integrity.

Do not use real PHI in continuity fixtures.

### 10.2 RTO

Measure from the formally declared start of the recovery operation/incident clock defined by the approved runbook until the restored environment satisfies the Release 1 acceptance condition:

- required infrastructure available;
- database/schema integrity accepted;
- API health/readiness accepted;
- authentication and representative critical read/write functions pass;
- required workers/integrations are in an accepted state;
- operations declares the recovered service usable.

The Release 1 result must be <= 2 hours.

The exact RTO clock definition must be agreed before the exercise; it must not be changed after seeing the result.

## 11. Critical integrity invariants during R8

Performance or failure testing is unacceptable if it achieves throughput by weakening correctness.

R8 must explicitly verify:

### Booking

- the last capacity unit is consumed once;
- retry does not duplicate the appointment;
- failed/rolled-back requests do not silently consume slot capacity;
- post-fault availability remains consistent with committed bookings.

### Financial

- idempotency key reuse does not create duplicate external financial effects;
- webhook replay does not duplicate state transitions;
- provider timeout does not become silent `SUCCEEDED`;
- reconciliation can distinguish pending/failed/succeeded states after recovery.

### Clinical

- a clinical write is durably committed or visibly fails;
- a dependency failure does not expose another patient's/provider's data;
- retries do not produce duplicate finalized clinical artifacts where idempotency/uniqueness is expected.

### Emergency

- a request is not presented as successfully dispatched unless the backend has durably accepted the request according to the approved dispatch model;
- retry/network interruption must not create multiple independent emergency requests when the same idempotent operation is retried;
- patient-facing degraded/failure state must remain explicit.

## 12. R8 evidence template

Use one record for each accepted performance or resilience run.

```text
R8 Evidence ID:
Scenario ID:
Candidate SHA/build:
Environment/topology:
External-provider profile:
Harness/procedure version:
Synthetic dataset reference:
Traffic/fault model reference:
Start timestamp:
End timestamp:

Expected result:
Actual result:

p50:
p95:
p99:
Throughput:
Error rate:
Timeout rate:
Capacity/saturation observations:
Queue/worker observations:
Database observations:
Redis observations:
Provider observations:
Telemetry/dashboard reference:

Booking integrity result:
Financial integrity result:
Clinical integrity result:
Emergency integrity result:

RPO measurement (if applicable):
RTO measurement (if applicable):

PASS / FAIL / BLOCKED:
Defect/reference:
Retest reference/date:
Tester/operator:
Approver:
```

Sensitive evidence must not be copied into the public repository. Use sanitized references when the detailed run output contains infrastructure-sensitive data.

## 13. Dependencies

### R3 #79

Required for:

- production-equivalent topology;
- managed PostgreSQL/Redis behavior;
- PITR/HA/failover mechanisms;
- OTLP/SLO dashboard/alert evidence;
- actual compute/autoscale topology;
- recovery operations.

### R4 #80

Required for real-provider R8 scenarios involving:

- PSP;
- notifications;
- LiveKit;
- any other launch external provider placed in the tested critical path.

### R5 #81

Required where real-device/native mobile behavior is part of the telehealth, emergency/location or client-network resilience evidence.

### Product / Operations / Infrastructure input

Required to approve:

- Release 1 target load model;
- traffic/request mix;
- burst scenario;
- dataset scale;
- headroom policy;
- test environment authority;
- RTO clock definition;
- fault-injection authority;
- operational approvers.

## 14. Exit criteria

R8 may close only when all of the following are true:

- #89 is closed with a versioned, reproducible load/performance harness and accepted Release Candidate result;
- #90 is closed with production-equivalent resilience/failure-injection and continuity evidence;
- the approved load model is linked;
- common API reads meet p95 < 500 ms at approved target load;
- search meets p95 < 800 ms at approved target load excluding explicitly identified external-provider latency;
- AC-05 concurrent booking integrity passes under load;
- AC-09 financial replay/idempotency behavior passes;
- AC-10 notification outage behavior passes;
- required Redis/PostgreSQL/provider/worker/observability failure modes pass;
- transactional RPO <= 15 minutes is measured and accepted;
- MVP RTO <= 2 hours is measured and accepted;
- no release-blocking performance, data-integrity, financial-integrity or patient-safety defect remains open;
- evidence is associated with the exact production-equivalent Release Candidate SHA/build.

Until these criteria are satisfied, R8 remains **BLOCKED / IN PROGRESS**.

`main` remains unchanged until final Release Candidate Go/No-Go.