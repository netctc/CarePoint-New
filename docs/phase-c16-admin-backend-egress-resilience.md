# Phase C16 — Admin backend egress resilience

## Objective

Phase C16 hardens the server-side HTTP boundary between the CarePoint Admin Next.js application and the CarePoint API. This boundary carries administrator credentials during login/MFA and bearer/refresh session material during authenticated operations, so destination validation and bounded network behavior are security controls rather than convenience settings.

C16 is intentionally limited to the Admin → CarePoint API path. It does not change API business logic, database schema, FHIR behavior, mobile applications, permanent GitHub workflows, or third-party dependencies.

## Threats addressed

Before C16, `apps/admin/lib/admin-auth.ts` and `apps/admin/lib/admin-api.ts` called `fetch()` directly using `CAREPOINT_API_URL` and then consumed `response.text()` without a byte cap. The runtime therefore depended on implicit Fetch defaults for redirects and network duration, and production could silently fall back to the development loopback URL.

The relevant failure modes were:

- administrator password/MFA or bearer material following an HTTP redirect;
- production credential routing to a malformed or unintended backend URL;
- an external production API endpoint using clear-text HTTP;
- an API-relative path escaping the configured `/api/v1` prefix;
- an indefinitely slow backend consuming server resources;
- a very large declared or chunked response being buffered without a limit.

## Controls implemented

### 1. Shared backend destination policy

`apps/admin/lib/admin-backend-policy.js` is the single policy used by Admin authentication and the Admin JSON proxy.

`CAREPOINT_API_URL`:

- is mandatory when `NODE_ENV=production`;
- must be an absolute `http://` or `https://` URL;
- must not embed username/password credentials;
- must not contain a query string or URL fragment;
- must target the exact `/api/v1` base path;
- must use HTTPS in production unless the host is numeric loopback (`127.0.0.1` or `::1`).

The numeric-loopback exception intentionally preserves the supported same-host topology in which Next.js reaches the API locally over `http://127.0.0.1:4000` while the public edge terminates TLS.

Non-production retains the historical default:

```text
http://127.0.0.1:4000/api/v1
```

### 2. API-relative path containment

Every target URL is constructed relative to the validated `/api/v1` base. Unsafe path forms are rejected, including:

- missing leading `/`;
- protocol-relative `//...` paths;
- backslashes, fragments, CR/LF or NUL;
- raw or percent-encoded `.` / `..` path segments;
- any normalized target that leaves the configured origin or `/api/v1` path.

Query strings remain supported for legitimate CarePoint API operations.

### 3. Redirect fail-closed

All Admin server-side CarePoint API calls now force:

```text
redirect: "error"
```

A 3xx response therefore cannot forward administrator credentials, MFA payloads, access tokens or refresh-session traffic to a second destination.

### 4. Bounded backend latency

All Admin backend calls carry an `AbortSignal.timeout()`.

`CAREPOINT_API_TIMEOUT_MS` is optional and defaults to `10000` ms. Accepted values are `100` through `30000` ms. An invalid value fails closed before the request is sent.

If a caller already supplies an abort signal, C16 combines it with the bounded timeout rather than weakening caller cancellation.

### 5. Bounded response bodies

Admin no longer uses unbounded `Response.text()` for CarePoint API responses. C16 stream-reads UTF-8 responses under a byte cap.

`CAREPOINT_API_MAX_RESPONSE_BYTES` is optional and defaults to `4194304` bytes (4 MiB). Accepted values are `1024` through `16777216` bytes (16 MiB).

The reader:

- rejects an invalid `Content-Length`;
- cancels a body before reading when the declared size exceeds the cap;
- counts actual streamed bytes so chunked/decompressed responses cannot bypass the cap;
- cancels the stream immediately when the cap is crossed;
- rejects invalid UTF-8 instead of passing ambiguous text to JSON parsing.

### 6. Existing session behavior preserved

Admin still applies the existing no-store response policy, same-origin mutation checks, secure production cookies and role validation. If the proxy has already rotated Admin session tokens and then detects an invalid/oversized backend response, the rotated cookies are preserved so the bounded-response control does not strand the browser on a consumed refresh token.

## Configuration

Production must explicitly provide a valid `CAREPOINT_API_URL`. Examples:

Same-host API behind the same TLS edge:

```text
CAREPOINT_API_URL=http://127.0.0.1:4000/api/v1
```

Separate/private API endpoint:

```text
CAREPOINT_API_URL=https://api.internal.example/api/v1
```

Optional bounded overrides:

```text
CAREPOINT_API_TIMEOUT_MS=10000
CAREPOINT_API_MAX_RESPONSE_BYTES=4194304
```

Do not place credentials in `CAREPOINT_API_URL`.

## Acceptance

The Admin workspace now exposes:

```text
npm run c16:admin-backend-egress
```

and wires it through its workspace `test` script, so the repository-root `npm test --workspaces --if-present` executes C16 automatically in the permanent CI workflow.

The smoke acceptance verifies:

- production URL fail-closed behavior;
- HTTPS versus numeric-loopback policy;
- path containment and encoded dot-segment rejection;
- timeout and response-size bounds;
- forced `cache: "no-store"` and `redirect: "error"`;
- an active abort signal on every backend call;
- declared oversize cancellation;
- chunked oversize cancellation;
- use of the shared helper by both authentication and Admin proxy code;
- absence of a new HTTP dependency.

## Change boundaries

C16 introduces no:

- database migrations;
- package dependencies;
- `package-lock.json` changes;
- permanent workflow changes;
- retries or automatic redirect handling.

Retries remain deliberately out of scope for credential-bearing Admin requests because replay safety is endpoint-specific.

## Operational note

A deployment that previously relied on the implicit production fallback to `http://127.0.0.1:4000/api/v1` must now set that same URL explicitly. This turns an implicit credential-routing decision into reviewed configuration without removing the valid same-host architecture.
