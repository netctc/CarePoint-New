# Phase C14 - Bounded external-provider responses

## Purpose

Phase C14 hardens CarePoint against oversized, malformed or incorrectly typed JSON returned by external integrations. Before C14, payment, insurance, claims and notification adapters used `Response.json()`, which can consume an upstream body without an application-level byte ceiling before parsing it.

C14 does not add a new inbound webhook surface and does not change financial state-transition rules. The current payment and claims integrations continue to reconcile through the established request/refresh flows.

## Threats addressed

An external provider, compromised upstream, proxy or integration defect can otherwise return:

- a very large declared JSON response;
- an unbounded chunked response with no `Content-Length`;
- HTML or another unexpected media type;
- malformed JSON or invalid UTF-8;
- a top-level JSON shape that does not match the adapter contract;
- an error body containing provider diagnostics, credentials or other material that should not be reflected by CarePoint.

C14 limits the amount of upstream data held for JSON parsing and fails closed before the adapter consumes an invalid provider payload.

## Scope

The shared response policy is used by the external adapters that parse JSON responses:

- payment gateway;
- insurance gateway;
- claims gateway;
- notification gateway.

The SIEM exporter is intentionally outside this parsing scope because it checks the upstream HTTP status and does not parse a response body. LiveKit remains SDK-managed rather than using these direct JSON adapters.

## Production configuration

Production must explicitly define:

```text
EXTERNAL_PROVIDER_MAX_RESPONSE_BYTES=<integer>
```

Allowed values are 4,096 through 1,048,576 bytes. The development/test default is 65,536 bytes. The checked-in example uses 65,536 bytes.

The API executes `assertProductionProviderResponsePolicyReady()` before `NestFactory.create`. A production process therefore refuses to start if the setting is missing, malformed or outside the allowed range.

The value is a global upper bound for the JSON integrations in this phase. Keep it close to the largest response size documented by the contracted providers. Do not increase it merely to make an unexplained upstream response pass.

## Runtime policy

For successful provider HTTP responses, CarePoint applies the following sequence before adapter-specific parsing:

1. Resolve and validate the configured maximum byte count.
2. Require `Content-Type`.
3. Accept `application/json` and structured JSON media types ending in `+json`.
4. If `Content-Length` is present, require a valid non-negative integer and reject it immediately if it exceeds the limit.
5. Read the Web `ReadableStream` incrementally.
6. Count actual bytes regardless of whether `Content-Length` was supplied.
7. Cancel the reader as soon as the actual byte count exceeds the configured ceiling.
8. Decode as strict UTF-8.
9. Parse JSON only after the bounded read completes.
10. Require a top-level JSON object before passing the payload to the provider-specific validator.

This means chunked transfer encoding cannot bypass the limit.

## Error-body handling

Provider responses with a non-success HTTP status are not parsed. CarePoint cancels/discards the upstream body and exposes only the HTTP status through the existing sanitized gateway exception.

For a successful HTTP status with an invalid media type, oversized body, malformed UTF-8/JSON or unsupported top-level JSON shape, each adapter emits a generic sanitized `BadGatewayException`. Raw provider response bodies are not copied into the application error message.

Operators should correlate the sanitized gateway error with provider-side telemetry using existing request, idempotency and provider reference mechanisms rather than logging raw upstream bodies in CarePoint.

## Relationship to earlier phases

C14 composes with the existing controls rather than replacing them:

- C12 continues to resolve integration credentials from KMS-encrypted mounted secret files in production.
- C13 continues to enforce HTTPS, URL restrictions, redirect rejection and request timeouts for payment, insurance and claims.
- C7 continues to provide durable notification delivery through the PostgreSQL outbox.
- C10 continues to scan the repository and CodeQL continues to analyze the codebase.

C14 adds no database migration and no npm dependency. The bounded reader uses the Node/Web Fetch response stream already present in the supported runtime.

## Operational sizing

Start with 65,536 bytes unless a verified integration contract requires another value. Before increasing the ceiling:

1. identify which provider and endpoint produced the rejection;
2. confirm the response is expected and contractually valid;
3. measure the expected upper percentile and legitimate maximum response size;
4. confirm that the response does not contain fields CarePoint should not consume;
5. set the smallest safe value that covers the verified contract;
6. rerun the C14 acceptance and the full CI suite.

A sudden increase in rejected oversized responses should be treated as an upstream integration or security signal, not as an automatic reason to raise the limit.

## Rollout

For production rollout:

1. set `EXTERNAL_PROVIDER_MAX_RESPONSE_BYTES` in the runtime configuration;
2. keep all C12 encrypted secret mounts and C13 gateway URL/timeout settings unchanged;
3. deploy the C14 build;
4. verify API startup succeeds;
5. exercise representative payment, insurance, claims and notification provider calls;
6. monitor sanitized 502/provider integration errors and upstream provider telemetry;
7. preserve the configured limit in infrastructure/configuration management.

## Rollback

Code rollback can return to the validated C13 SHA if a provider contract is found to require behavior not represented by C14. Do not work around a C14 rejection by disabling byte accounting or by reintroducing unbounded `Response.json()` calls. If the upstream contract legitimately requires a larger JSON response, change the configured limit within the supported range and revalidate.

## Acceptance

Run the focused acceptance after building the API:

```text
npm --workspace @carepoint/api run c14:bounded-provider-responses
```

The C14 smoke verifies:

- production requires an explicit bounded-response setting;
- configured values are restricted to 4 KiB through 1 MiB;
- ordinary JSON and `+json` responses are accepted;
- non-JSON media types are rejected;
- excessive declared `Content-Length` is rejected;
- chunked responses are stopped when their actual byte count crosses the limit;
- malformed JSON, invalid UTF-8 and top-level arrays are rejected;
- payment, insurance, claims and notification adapters all use the shared bounded reader;
- provider details are not reflected in sanitized adapter errors;
- the production preflight executes before Nest application creation;
- no JSON-streaming dependency is added.

The full release gate remains the permanent CI, Security Analysis, PostgreSQL Recovery and Slice 10 FHIR workflows on the exact C14 candidate SHA.
