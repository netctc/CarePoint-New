# Phase C13 — Financial gateway egress resilience

## Objective

C13 places hard runtime bounds around CarePoint's outbound payment, insurance and claims HTTP calls. Before this phase, those three adapters could wait indefinitely for a provider transport and followed Fetch redirects by default. C13 makes production startup and runtime behavior fail closed instead.

C13 deliberately does **not** add automatic retries. Payment, prior-authorization and claim operations are financially significant; retry policy should be introduced only with provider-specific idempotency and rate-limit contracts. Existing idempotency keys remain preserved on outbound requests.

## Protected adapters

| Adapter | Endpoint variable | Timeout variable |
| --- | --- | --- |
| Payment PSP | `PAYMENT_GATEWAY_BASE_URL` | `PAYMENT_GATEWAY_TIMEOUT_MS` |
| Insurance / eligibility | `INSURANCE_GATEWAY_BASE_URL` | `INSURANCE_GATEWAY_TIMEOUT_MS` |
| Claims / clearinghouse | `CLAIMS_GATEWAY_BASE_URL` | `CLAIMS_GATEWAY_TIMEOUT_MS` |

Development/test defaults each timeout to 10 seconds. Production requires every timeout explicitly and accepts values from 100 through 30000 milliseconds.

## Startup preflight

`assertProductionFinancialGatewayEgressReady()` executes before `NestFactory.create()` and requires, for all three adapters:

- provider mode `external`;
- configured base URL;
- HTTPS in production;
- no username/password embedded in the URL;
- no URL fragment;
- no loopback target (`localhost`, `127.0.0.1`, `::1`);
- an explicit integer timeout between 100 and 30000 ms.

This preflight is intentionally independent of the C12 secret preflight. C12 proves the provider credential can be resolved securely; C13 proves the provider egress destination and transport bound are safe before accepting traffic.

## Runtime transport controls

Every outbound payment, insurance and claims request now uses:

```text
redirect: error
signal: AbortSignal.timeout(<provider timeout>)
```

A network error, TLS failure, redirect rejection, DNS failure or timeout is converted to a provider-specific `BadGatewayException` that does not copy the original transport exception. This prevents low-level errors from leaking connection details, provider internals or credential-bearing diagnostic text.

Provider non-2xx responses continue to be surfaced only as the HTTP status code; response bodies are not copied into CarePoint errors.

## Operational guidance

Choose timeouts from measured provider SLOs rather than setting every integration to the 30-second maximum. A practical starting point is 5–10 seconds for interactive authorization/eligibility APIs, then tune from production latency telemetry.

A timeout must be shorter than the upstream ingress/request deadline so CarePoint has time to return a controlled error rather than being terminated by a load balancer or gateway first.

Do not use automatic application retries as an outage workaround. If a provider requires retries, define a separate contract covering:

- which HTTP statuses and transport failures are retryable;
- idempotency-key retention and provider retention window;
- maximum attempts and total retry budget;
- `Retry-After` handling;
- duplicate-payment/claim reconciliation;
- circuit-breaking and observability.

## Acceptance

`npm test -w @carepoint/api` includes `c13:financial-gateway-egress` and verifies:

- production provider mode and explicit timeout requirements;
- timeout range validation;
- production HTTPS enforcement;
- embedded credentials, fragments and loopback destinations are rejected;
- all three adapters attach an `AbortSignal` and `redirect: "error"`;
- outbound authorization and idempotency headers remain present;
- transport exception content is not reflected in application errors;
- the C13 preflight runs before Nest application creation;
- no new HTTP/runtime dependency is introduced.

C13 adds no database migration and does not modify the C2 dependency graph.
