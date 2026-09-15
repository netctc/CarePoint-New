# Phase C18 - Global raw-body minimization

## Purpose

Phase C18 removes Nest's global `rawBody` retention from the CarePoint API after confirming that the current application has no inbound route that consumes raw request bytes for signature verification or another protocol requirement.

C17 bounds request sizes, but `rawBody: true` can still retain the original request bytes alongside the parsed JSON/form representation. That extra copy/reference increases per-request memory cost, especially for Base64 clinical-document uploads. C18 removes that global retention rather than paying the cost for every request when no current controller needs it.

## Change

Nest application creation changes from a global raw-body configuration to the normal parsed-body configuration:

```text
NestFactory.create<NestExpressApplication>(AppModule, { cors: false })
```

The C17 JSON and form-urlencoded parser byte limits remain unchanged and continue to be registered explicitly after application creation.

C18 does not change request schemas, controllers, authentication, document limits, migrations, dependencies or mobile clients.

## Evidence of no current raw-body consumer

The focused C18 acceptance recursively scans all TypeScript source under `services/api/src` and fails if it finds:

- `RawBodyRequest`;
- property access to `.rawBody`;
- a `rawBody:` configuration property.

It also fails if a source file path introduces a module named with `webhook` or `callback`, forcing a future inbound integration to reconsider whether exact raw bytes are required before the global optimization is allowed to remain unquestioned.

The repository audit performed before C18 also found no current inbound webhook/callback route requiring provider signature verification over the original byte stream.

## Why not retain raw bytes globally

Raw bytes are appropriate when a specific protocol requires verification over the exact request representation, for example an HMAC-signed webhook whose signature covers the unparsed request bytes.

They are not needed for ordinary JSON/form controller inputs. Retaining them globally:

- increases request memory footprint;
- is especially expensive for large Base64 JSON uploads;
- broadens the lifetime of an additional copy of sensitive input;
- creates an unnecessary default that future developers may rely on without an explicit protocol boundary.

C18 therefore follows a least-retention model.

## Future signed webhooks or callbacks

If CarePoint later adds a provider webhook that genuinely requires exact request bytes, do not simply re-enable `rawBody: true` globally.

The new integration should instead:

1. define the exact inbound route and provider contract;
2. apply a dedicated small request-size limit;
3. capture raw bytes only for that route/content type;
4. verify signature/timestamp/replay protection before parsing or mutating state;
5. avoid logging the raw payload;
6. prove through a focused acceptance that other API routes do not retain raw bodies;
7. update the C18 smoke deliberately to recognize that scoped exception.

If the framework cannot scope raw-byte capture safely, that should be treated as an architectural decision rather than an implicit global toggle.

## Relationship to C17

C17 remains the outer request-size boundary:

- JSON is configured within 4 KiB..16 MiB;
- form-urlencoded is configured within 4 KiB..1 MiB;
- production requires explicit byte values;
- clinical documents retain their inner 8 MiB decoded-file limit.

C18 reduces duplication after those limits are applied. It does not replace them.

For an 8 MiB clinical document, Base64 already expands the JSON field to approximately 10.67 MiB before metadata. Avoiding an unnecessary global raw-body copy materially improves the memory profile of that existing flow.

## Rollout

1. Deploy the C18 candidate with the same C17 body-limit configuration.
2. Confirm API startup and all authentication/admin flows.
3. Exercise clinical document upload/download.
4. Exercise payment, insurance, claims, messaging and FHIR flows.
5. Monitor memory and request failures during representative large JSON uploads.
6. Confirm no integration team depends on undocumented raw request access.

## Rollback

The frozen C17 SHA is the rollback point. A rollback restores global raw-body retention but retains the validated C17 byte limits.

Do not re-enable global raw bodies merely as a speculative compatibility measure. A real protocol requirement should be identified and scoped.

## Acceptance

After building the API, run:

```text
npm --workspace @carepoint/api run c18:raw-body-minimization
```

The focused acceptance verifies:

- all API TypeScript source is scanned;
- no `RawBodyRequest`, `.rawBody` consumer or `rawBody:` configuration exists;
- Nest application creation no longer enables global raw-body retention;
- C17 JSON and form parser limits remain active;
- no webhook/callback module path exists without an explicit C18 review;
- no new raw-body dependency is introduced.

The full phase gate remains the four permanent workflows on the exact C18 candidate SHA: CI, Security Analysis, PostgreSQL Recovery and Slice 10 FHIR.
