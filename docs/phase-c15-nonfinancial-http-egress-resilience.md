# Phase C15 - Non-financial HTTP egress resilience

## Purpose

Phase C15 closes the remaining direct HTTP egress gaps identified after C13 and C14. Financial adapters already reject redirects and use bounded request timeouts; SIEM already rejects redirects. The remaining direct callers with weaker behavior were the external notification gateway and the OTLP/HTTP JSON exporter.

C15 does not add an endpoint, database migration, dependency, retry loop or new provider integration.

## Notification gateway

Production notification delivery now has a startup preflight that executes before `NestFactory.create`.

Production requires:

- `NOTIFICATION_GATEWAY_PROVIDER=external` explicitly;
- `NOTIFICATION_GATEWAY_BASE_URL` to be present;
- HTTPS;
- no embedded URL credentials;
- no URL fragment;
- no loopback target, including localhost, `.localhost`, IPv4 loopback and IPv6 loopback forms;
- `NOTIFICATION_GATEWAY_TIMEOUT_MS` to be explicitly set between 100 and 30000 milliseconds.

The notification adapter also sets Fetch `redirect: "error"`, preserving authorization and idempotency material from being forwarded through an upstream redirect.

C14 remains responsible for bounded JSON response parsing. C12 remains responsible for the KMS-encrypted notification API key in production. C7 remains responsible for durable notification outbox delivery.

## OTLP/HTTP JSON exporter

C15 keeps the existing C6 OTLP contract and adds egress fail-closed behavior:

- production must configure `OTEL_EXPORTER_OTLP_TIMEOUT` or both signal-specific timeouts;
- OTLP trace and metric timeouts must be between 100 and 30000 milliseconds;
- OTLP endpoint URLs reject fragments;
- existing production HTTPS, credential and loopback restrictions remain in force;
- OTLP Fetch calls set `redirect: "error"`;
- the response body is not parsed and is explicitly cancelled because CarePoint uses only the collector HTTP status.

Cancelling the unused body prevents an unexpected or unbounded collector response from keeping response resources active after headers have been received. The request timeout remains active through that cleanup path.

## Why redirects are rejected

Automatic redirects are inappropriate for authenticated service-to-service egress because they can change the effective destination after the application has already attached credentials, tenant headers or idempotency identifiers. C15 therefore aligns notifications and OTLP with the existing C13/SIEM policy: redirects are integration failures and must be fixed at configuration/provider level rather than followed automatically.

## Timeout policy

The accepted range is 100 to 30000 milliseconds. Production may not rely on the development default.

For OTLP, either configure one common timeout:

```text
OTEL_EXPORTER_OTLP_TIMEOUT=5000
```

or configure both signal-specific values:

```text
OTEL_EXPORTER_OTLP_TRACES_TIMEOUT=5000
OTEL_EXPORTER_OTLP_METRICS_TIMEOUT=5000
```

For notifications:

```text
NOTIFICATION_GATEWAY_TIMEOUT_MS=5000
```

Choose values from provider/collector SLOs and observed latency. Do not increase timeouts solely to mask connectivity or saturation problems.

## Operational behavior

A production configuration violating the notification egress policy fails during application preflight, before Nest creates the application.

OTLP configuration is also validated by the existing production OTLP preflight. In `required` mode the collector is contacted during startup; in `best-effort` mode configuration is validated without making startup dependent on collector reachability.

Runtime transport failures continue to use the existing sanitized error paths. No raw provider response body is introduced into errors or audit metadata.

## Rollout

1. Verify `NOTIFICATION_GATEWAY_PROVIDER=external` is explicitly configured.
2. Verify the notification endpoint is the final HTTPS endpoint and does not rely on redirects.
3. Verify `NOTIFICATION_GATEWAY_TIMEOUT_MS` is explicit and within 100..30000 ms.
4. Verify OTLP endpoint configuration contains no redirects or URL fragments.
5. Verify an OTLP common timeout or both signal-specific timeouts are explicit and within 100..30000 ms.
6. Deploy the C15 candidate.
7. Confirm startup preflights pass.
8. Exercise notification delivery and observe OTLP traces/metrics at the collector.
9. Keep upstream redirects disabled/fixed rather than adding redirect exceptions.

## Rollback

If a contracted provider unexpectedly returns redirects, do not weaken the redirect policy. Confirm the provider's canonical endpoint and update configuration. Code rollback to the frozen C14 SHA is available only as a release rollback, not as a recommended redirect workaround.

## Acceptance

After building the API, run:

```text
npm --workspace @carepoint/api run c15:nonfinancial-http-egress
```

The focused C15 acceptance verifies:

- production notification provider selection is explicit;
- notification endpoint HTTPS/credential/fragment/loopback rules;
- explicit bounded notification timeout;
- notification Fetch rejects redirects and carries an abort signal;
- production OTLP timeout declaration is explicit and bounded;
- OTLP endpoints reject URL fragments;
- OTLP Fetch rejects redirects;
- unused OTLP response bodies are cancelled;
- notification startup preflight executes before Nest application creation;
- no new HTTP dependency is introduced.

The full phase gate remains the four permanent workflows on the exact candidate SHA: CI, Security Analysis, PostgreSQL Recovery and Slice 10 FHIR.
