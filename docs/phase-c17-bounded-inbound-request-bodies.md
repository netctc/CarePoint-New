# Phase C17 - Bounded inbound request bodies

## Purpose

Phase C17 makes CarePoint's inbound JSON and form parser limits explicit, validated and fail-closed in production.

Before C17, `main.ts` passed `Number(process.env.JSON_BODY_LIMIT_BYTES ?? 1048576)` and `Number(process.env.FORM_BODY_LIMIT_BYTES ?? 131072)` directly to Nest/Express body parsers. JavaScript numeric conversion accepts values such as `Infinity`, signed values, scientific notation and otherwise surprising configuration. It also provided no application maximum. A bad deployment value could therefore weaken the intended request-size boundary and amplify memory pressure before authentication or business validation runs.

This matters especially because CarePoint enables `rawBody: true` for compatibility. The application can retain raw request bytes in addition to the parsed representation, so an unnecessarily large accepted body has a higher memory cost than the wire payload alone.

C17 preserves `rawBody: true` and the development defaults but validates production body limits before Nest creates the application.

## Configuration

C17 uses the existing variables:

```text
JSON_BODY_LIMIT_BYTES=<integer bytes>
FORM_BODY_LIMIT_BYTES=<integer bytes>
```

Development/test defaults remain:

- JSON: 1,048,576 bytes (1 MiB)
- form-urlencoded: 131,072 bytes (128 KiB)

Production must set both values explicitly.

Accepted ranges are:

- JSON: 4,096 through 16,777,216 bytes
- form-urlencoded: 4,096 through 1,048,576 bytes

Only decimal digits are accepted. Values using signs, decimal points, exponent notation, unit suffixes, `Infinity`, `NaN` or other JavaScript numeric forms are rejected during startup.

## Clinical document sizing

Clinical document upload currently accepts binary files up to 8 MiB in `DocumentsService` and transports the file as a Base64 string inside JSON.

An 8 MiB binary requires 11,184,812 Base64 characters before JSON metadata and structural overhead. A production environment that needs the full existing document contract should therefore use a JSON body limit with adequate headroom. A practical initial value is:

```text
JSON_BODY_LIMIT_BYTES=12582912
```

which is 12 MiB.

This does not change the document-level `MAX_FILE_BYTES=8 * 1024 * 1024` validation. The global body parser is the outer resource boundary; the document service remains the inner business/file-size boundary.

If a deployment never accepts large Base64 clinical documents, it should use a smaller JSON limit rather than copying the 12 MiB example automatically.

## Startup behavior

`assertProductionInboundBodyLimitsReady()` runs before `NestFactory.create`.

The application then resolves the validated values once with `inboundBodyLimits()` and passes those integers to:

- `app.useBodyParser("json", { limit: bodyLimits.jsonBytes })`
- `app.useBodyParser("urlencoded", { limit: bodyLimits.formBytes, extended: true })`

The application no longer calls `Number(process.env.JSON_BODY_LIMIT_BYTES...)` or the equivalent form expression at parser registration time.

A production process fails startup when a required limit is missing, malformed or outside its permitted range.

## Runtime behavior

Requests larger than the configured parser limit are rejected by the underlying body parser before controller/business logic receives a parsed body. The normal expected response for an oversized request is HTTP 413 Payload Too Large.

C17 does not attempt to silently truncate request bodies. Truncation would make signed/idempotent/clinical payloads ambiguous and is therefore not an acceptable fallback.

## Reverse proxy and load balancer alignment

The application limit is the final CarePoint process boundary, not a substitute for upstream controls.

Production ingress should also enforce request-size limits at the edge/proxy/load balancer. Prefer an upstream limit equal to or slightly below the application limit so oversized traffic is rejected before consuming application connection and memory resources. When large clinical-document JSON is enabled, confirm the same effective limit throughout CDN/WAF, ingress, reverse proxy and application layers.

Do not configure an unlimited upstream body size simply because the application now has a limit.

## Memory considerations

Base64 expands binary content by approximately one third, and JSON parsing creates JavaScript strings/objects in addition to received bytes. `rawBody: true` can retain another copy/reference of the incoming data for framework compatibility.

Consequently, `JSON_BODY_LIMIT_BYTES` is not a direct statement of peak process memory per request. Capacity testing should assume a multiple of the accepted wire body size, especially under concurrent uploads.

The 16 MiB hard configuration ceiling is a safety guard, not a recommended default.

## Rollout

1. Inventory legitimate JSON and form request sizes in the target environment.
2. Decide whether the deployment must support the full 8 MiB clinical document upload contract.
3. Set both production variables explicitly.
4. Align CDN/WAF/load-balancer/reverse-proxy body-size controls.
5. Deploy the C17 candidate.
6. Confirm the preflight completes before Nest startup.
7. Exercise ordinary API requests and representative clinical uploads.
8. Verify an oversized test request is rejected and does not reach business logic.
9. Monitor 413 rates and application memory during rollout.

## Failure handling

A startup failure caused by these variables is a deployment configuration error. Do not bypass C17 by using `Infinity`, an enormous number or a code change that removes the parser limit.

If legitimate traffic is rejected:

1. identify the route and actual request size;
2. verify the payload is expected and safe;
3. confirm application-level inner limits still constrain the operation;
4. increase the configured byte limit only within the C17 hard maximum;
5. align upstream limits and rerun acceptance.

## Rollback

The frozen C16 SHA is the code rollback point. Existing explicit production body-limit values within the C17 ranges can be retained across rollback, but C16 does not validate them before parser registration.

A rollback should not be used to restore unlimited body sizes.

## Acceptance

After building the API, run:

```text
npm --workspace @carepoint/api run c17:bounded-inbound-bodies
```

The focused acceptance verifies:

- development defaults remain 1 MiB JSON and 128 KiB form;
- production requires both variables explicitly;
- strict decimal integer parsing;
- rejection of `Infinity`, `NaN`, exponent notation, decimal, signed and unit-suffixed values;
- JSON range 4 KiB through 16 MiB;
- form range 4 KiB through 1 MiB;
- the hard JSON maximum can accommodate the existing 8 MiB clinical document Base64 contract;
- the documented 12 MiB example provides Base64/metadata headroom;
- preflight and limit resolution execute before `NestFactory.create`;
- body parsers consume only the validated values;
- the old direct `Number(process.env...)` parser configuration is absent;
- `rawBody: true` remains intact for compatibility;
- no new dependency is introduced.

The full phase gate remains the four permanent workflows on the exact C17 candidate SHA: CI, Security Analysis, PostgreSQL Recovery and Slice 10 FHIR.
