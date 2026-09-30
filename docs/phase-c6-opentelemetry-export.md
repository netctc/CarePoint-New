# Phase C6 - OpenTelemetry OTLP Export Readiness

## Purpose

Phase C6 closes the application-side production observability export gap left after the Slice 9 resilience/observability baseline and the C1-C5 infrastructure preflights. CarePoint must not silently enter production with telemetry export misconfigured, disabled, pointed to an unsafe collector endpoint, or capable of leaking credentials or patient-sensitive request content.

C6 starts from the fully accepted Phase C5 head `13fc4a2b441514de3e22d6d2c0ca8ed313ea9e38`.

C6 provides application-side OTLP/HTTP JSON readiness for traces and HTTP server metrics. It does not claim that a production collector cluster, SIEM backend, alerting stack or cross-region observability service has been deployed; those remain infrastructure/release evidence.

## Startup boundary

Production startup now executes the readiness chain before NestJS accepts traffic:

```text
Phase C1 application KMS preflight
    |
    v
Phase C3 private object-storage preflight
    |
    v
Phase C5 PostgreSQL preflight
    |
    v
Phase C4 Redis preflight
    |
    v
Phase C6 OpenTelemetry preflight
    |
    +--> validate OTLP endpoints/protocol/headers/timeouts/sampler
    +--> in required mode, verify trace + metric collector reachability
    +--> sanitize any transport/preflight failure
    |
    +--> any required-mode failure: do not create NestJS / do not accept traffic
    |
    v
NestFactory.create(...)
```

This keeps telemetry readiness in the same fail-closed production boundary as KMS, storage, PostgreSQL and Redis.

## Export modes

Production requires an explicit `CAREPOINT_OTEL_EXPORT_MODE`.

### `required`

The API validates configuration and performs a startup OTLP readiness probe for both traces and metrics. A collector/configuration failure prevents application startup.

Use this when the production architecture requires telemetry export as a release invariant.

### `best-effort`

The API still validates the complete OTLP configuration but does not make collector network availability a startup dependency.

Use this only when the release architecture explicitly accepts temporary collector unavailability. Runtime export remains bounded and failures must be monitored outside the application process.

## OTLP endpoint and protocol policy

C6 supports OTLP over HTTP/JSON for traces and metrics.

Production requires either:

- `OTEL_EXPORTER_OTLP_ENDPOINT`, from which `/v1/traces` and `/v1/metrics` are derived; or
- explicit signal endpoints through `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` and `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT`.

When telemetry is enabled:

- traces and metrics protocols must resolve to `http/json`;
- production endpoints must use `https://`;
- loopback collector hosts are rejected in production;
- embedded URL credentials are rejected;
- `OTEL_SDK_DISABLED=true` is forbidden in production.

Signal-specific endpoint/protocol/header/timeout variables may override the common values only within these same safety rules.

## Header and credential safety

OTLP headers are configuration data and may contain collector authentication material. C6 therefore:

- parses common and signal-specific header sets explicitly;
- rejects CR/LF and other invalid header content;
- rejects attempts to override structural/sensitive HTTP headers such as `content-type`, `content-length`, `host`, `connection` and `transfer-encoding`;
- never prints configured OTLP headers during normal startup;
- sanitizes preflight errors before they are propagated.

The preflight sanitizer redacts:

- configured OTLP endpoint values;
- encoded and decoded configured header values; and
- the credential portion of `Authorization` values after an authentication scheme such as `Bearer` or `Basic`.

Collector credentials belong in the runtime secret manager and must not be committed to source control.

## Service/resource metadata

C6 supports bounded resource metadata through:

- `OTEL_SERVICE_NAME`;
- `OTEL_SERVICE_NAMESPACE`;
- `OTEL_SERVICE_VERSION`;
- `OTEL_DEPLOYMENT_ENVIRONMENT`; and
- `AWS_REGION`, exported as cloud region when present.

Values are length-limited/sanitized before export. Production defaults the deployment environment to `production` when no explicit value is supplied.

## HTTP trace data minimization

C6 intentionally exports a narrow server-request telemetry model. The application records operational attributes such as:

- HTTP request method;
- normalized route;
- HTTP status code;
- validated request identifier;
- duration/timestamps;
- trace/span identifiers and W3C parent context.

The exporter does not intentionally include:

- authorization headers;
- cookies;
- raw URLs or query strings;
- request or response bodies;
- secure-message content;
- clinical notes;
- email addresses or patient identifiers as telemetry attributes.

Route normalization is important: telemetry must describe the route shape rather than turn user-controlled URL material into high-cardinality or PHI-bearing attributes.

## W3C trace context and sampling

Incoming W3C `traceparent` values are parsed conservatively. Invalid or all-zero trace/span identifiers are rejected and a new local context can be generated.

Supported sampler names are:

- `always_on`;
- `always_off`;
- `traceidratio`;
- `parentbased_always_on`;
- `parentbased_always_off`;
- `parentbased_traceidratio`.

`OTEL_TRACES_SAMPLER_ARG`, when required, must be between 0 and 1.

C6 makes ratio boundaries exact:

- ratio `0` never samples a locally decided trace;
- ratio `1` always samples it;
- intermediate ratios compare the high 53-bit trace-id sample space with an exclusive threshold.

This avoids the edge case where a nominal zero sampling ratio could still select the minimum trace-id bucket.

## Bounded runtime buffering

Trace export is deliberately bounded. `CAREPOINT_OTEL_MAX_QUEUE` controls the maximum pending span queue and must be a positive integer. The exporter tracks dropped spans when the queue cannot accept more work.

HTTP duration metrics are aggregated into fixed duration buckets and flushed on the configured interval. `OTEL_METRIC_EXPORT_INTERVAL` must be a positive integer.

OTLP network timeouts are explicit through the common and/or signal-specific timeout variables, preventing unbounded exporter waits.

C6 does not claim durable telemetry delivery. In-process telemetry queues can be lost on process termination, and collector/network durability must be provided by the production observability architecture.

## Deterministic C6 acceptance

`services/api/scripts/c6-otel-preflight-smoke.mjs` runs without production collector credentials. It covers:

- non-production bypass;
- required OTLP endpoint presence;
- HTTP/JSON protocol enforcement;
- production HTTPS enforcement;
- loopback endpoint rejection;
- embedded URL credential rejection;
- explicit `required|best-effort` export mode;
- structural header override rejection;
- header injection rejection;
- positive timeout validation;
- supported sampler validation;
- sampler argument bounds;
- production rejection of `OTEL_SDK_DISABLED=true`;
- valid/invalid W3C traceparent handling;
- exact `traceidratio` boundary behavior for 0, 1 and an intermediate ratio;
- required-mode trace/metric readiness probes;
- best-effort startup behavior;
- endpoint and authentication-value redaction on preflight failure;
- trace/metric payload construction; and
- absence of authorization, configured test credentials, patient/email markers, query strings and bodies from deterministic payloads.

The C6 smoke is chained after C3, C4 and C5 inside the API workspace test gate.

## CI acceptance

The final C6 validation preserved the existing C2 supply-chain boundary and the full functional regression suite:

- canonical npm lock verification: 442 packages;
- npm audit: 0 vulnerabilities at acceptance;
- Node build and API test chain including C1 and C3-C6 preflights;
- all Prisma migrations and bootstrap acceptance;
- Admin B1-B9 acceptance;
- Slice 2-Slice 9 application smoke coverage;
- Flutter shared/mobile analysis and tests; and
- FHIR Slice 10.0-Slice 10.13 acceptance.

No temporary GitHub Actions workflow remains in the accepted branch.

## Production configuration reference

The repository `.env.example` documents the supported variable names and safe placeholders. The principal C6 variables are:

```text
CAREPOINT_OTEL_EXPORT_MODE
CAREPOINT_OTEL_MAX_QUEUE
OTEL_EXPORTER_OTLP_ENDPOINT
OTEL_EXPORTER_OTLP_TRACES_ENDPOINT
OTEL_EXPORTER_OTLP_METRICS_ENDPOINT
OTEL_EXPORTER_OTLP_PROTOCOL
OTEL_EXPORTER_OTLP_TRACES_PROTOCOL
OTEL_EXPORTER_OTLP_METRICS_PROTOCOL
OTEL_EXPORTER_OTLP_HEADERS
OTEL_EXPORTER_OTLP_TRACES_HEADERS
OTEL_EXPORTER_OTLP_METRICS_HEADERS
OTEL_EXPORTER_OTLP_TIMEOUT
OTEL_EXPORTER_OTLP_TRACES_TIMEOUT
OTEL_EXPORTER_OTLP_METRICS_TIMEOUT
OTEL_SERVICE_NAME
OTEL_SERVICE_NAMESPACE
OTEL_SERVICE_VERSION
OTEL_DEPLOYMENT_ENVIRONMENT
OTEL_METRIC_EXPORT_INTERVAL
OTEL_TRACES_SAMPLER
OTEL_TRACES_SAMPLER_ARG
```

Do not place real collector tokens, passwords or long-lived credentials in `.env.example` or repository documentation.

## Production infrastructure evidence still required

Before KSA/GCC go-live, C6 still requires operational evidence for controls outside the application process:

- production collector/provider deployment and ownership;
- collector HA, capacity, backpressure and failover behavior;
- private networking/DNS/firewall policy where applicable;
- collector authentication secret lifecycle and rotation;
- TLS certificate issuance/rotation and trust policy;
- telemetry retention, residency and data-processing policy for KSA/GCC deployments;
- backend RBAC and separation of duties;
- SIEM integration and security-event routing;
- alert definitions, escalation and on-call ownership;
- SLO/dashboard coverage for application, PostgreSQL, Redis, KMS, object storage and FHIR jobs;
- collector/exporter saturation and dropped-telemetry alerts;
- load/soak testing at expected production cardinality and throughput;
- disaster-recovery and cross-region observability strategy; and
- periodic review proving telemetry remains PHI-minimized as application routes evolve.

These controls require infrastructure and operations evidence; C6 intentionally does not reduce them to self-declared environment flags.
