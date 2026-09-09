# Phase C19 — Browser origin readiness

## Objective

Phase C19 hardens the browser-origin allowlist used by the CarePoint API CORS layer.

The API enables credentialed CORS and explicitly accepts the `Authorization` header. `ALLOWED_ORIGINS` therefore controls which browser origins may issue cross-origin authenticated CarePoint requests. Before C19, production required the variable to be non-empty but then split and passed its raw string values directly to Nest CORS without validating that each item was actually a safe browser origin.

C19 validates and canonicalizes that configuration before `NestFactory.create()` and supplies the same validated list to `app.enableCors()`.

## Audit finding

Before C19, `main.ts` implemented:

```text
ALLOWED_ORIGINS -> trim -> split(',') -> trim -> filter(Boolean) -> enableCors(origin: origins)
```

The only production guard was that the overall string existed.

That left deployment configuration able to contain values that do not represent an intended secure browser origin, including:

- clear-text HTTP production sites;
- URL paths, query strings or fragments;
- embedded URL credentials;
- `localhost`, loopback or unspecified hosts;
- the special wildcard/null values that should never be used with authenticated browser traffic;
- duplicate origins written with different case/default-port/trailing-slash forms;
- accidental empty comma-separated entries.

The C19 audit also reviewed the remaining client-facing DICOM and FHIR Bulk Data URL surfaces before selecting this phase:

- DICOM/PACS references are validated against the configured PACS base but are not dereferenced by HTTP in the current implementation; the FHIR `ImagingStudy` representation exposes DICOM UIDs, not the PACS URL, and the internal descriptor remains `proxyRequired: true`.
- FHIR Bulk Data `Content-Location` and file URLs are built from `SMART_FHIR_BASE_URL`, whose public destination is already protected by C18. Bulk files are downloaded through authenticated CarePoint endpoints rather than external presigned URLs.

C19 therefore targets the remaining active browser trust boundary rather than creating controls for a future DICOM proxy.

## Controls implemented

### 1. One canonical origin parser

`services/api/src/infrastructure/http/browser-origin-readiness.ts` is now the single parser for `ALLOWED_ORIGINS`.

Production still requires the variable explicitly. Non-production retains the historical default:

```text
http://localhost:3000
```

The parser accepts a comma-separated list and returns canonical `URL.origin` strings.

For example:

```text
https://ADMIN.CarePoint.Example/,https://patient.carepoint.example:443
```

becomes:

```text
https://admin.carepoint.example
https://patient.carepoint.example
```

### 2. Origin-only URL rule

Every entry must:

- be an absolute `http://` or `https://` URL;
- not be `*`;
- not be the opaque origin value `null`;
- contain no embedded username/password credentials;
- contain no application path other than `/`;
- contain no query string;
- contain no URL fragment.

This reflects the browser `Origin` header model: the allowlist stores origins, not arbitrary application URLs.

### 3. Production transport and destination rule

When `NODE_ENV=production`, every configured browser origin must use HTTPS and must not target:

- `localhost` or `*.localhost`;
- IPv4 loopback in `127.0.0.0/8`;
- IPv6 loopback `::1`;
- unspecified IPv4 `0.0.0.0`;
- unspecified IPv6 `::`.

C19 deliberately does not reject an HTTPS RFC1918/private-network origin solely because it is private. A controlled enterprise/VPN deployment can legitimately expose an Admin or clinical web application only on a private address or DNS zone.

### 4. Duplicate and list-size fail closed behavior

Canonical duplicates are rejected. This catches configuration such as:

```text
https://admin.example.com,https://ADMIN.example.com/
```

rather than silently retaining redundant policy entries.

The allowlist is capped at 32 origins to keep a production security boundary reviewable and to reject obviously malformed/unbounded configuration.

Empty entries such as a trailing comma are rejected rather than silently discarded.

### 5. Validation before Nest creation

`browserOrigins(process.env)` now executes before `NestFactory.create()`.

The returned list is retained and passed directly to:

```text
app.enableCors({ origin: origins, credentials: true, ... })
```

`main.ts` no longer contains a second raw `ALLOWED_ORIGINS` parser. This prevents startup validation and runtime CORS behavior from interpreting the same configuration differently.

## Configuration

The existing API `.env.example` already contains:

```text
ALLOWED_ORIGINS=http://localhost:3000
```

which remains valid for development.

Production should list the exact HTTPS origins presented by browsers, for example:

```text
ALLOWED_ORIGINS=https://admin.example.com,https://patient.example.com,https://doctor.example.com
```

Do not include route paths such as `/admin`, `/login` or `/app`; CORS compares origins, not pages.

If an application is available on a non-default HTTPS port, include that port explicitly:

```text
ALLOWED_ORIGINS=https://portal.example.com:8443
```

## Acceptance

The API workspace exposes:

```text
npm run c19:browser-origin-readiness
```

and C19 is appended to the existing C3→C19 API test chain.

The smoke verifies:

- development default compatibility;
- production requires `ALLOWED_ORIGINS`;
- canonical origin normalization;
- wildcard and `null` rejection;
- unsupported-scheme rejection;
- embedded-credential rejection;
- path/query/fragment rejection;
- HTTPS enforcement in production;
- localhost, IPv4/IPv6 loopback and unspecified-host rejection;
- private HTTPS origin compatibility;
- duplicate canonical-origin rejection;
- empty-entry rejection;
- maximum 32-origin policy;
- execution before Nest creation;
- use of the exact validated list by `enableCors`;
- removal of the old second parser from `main.ts`;
- continued presence of `ALLOWED_ORIGINS` in `.env.example`;
- no new direct CORS dependency.

The permanent Admin/browser acceptance, mobile analysis, FHIR, Recovery and Security/CodeQL workflows remain unchanged and provide regression coverage around the new startup policy.

## Change boundaries

C19 introduces no:

- database migration;
- package dependency;
- `package-lock.json` change;
- mobile dependency or lock change;
- body-size policy change;
- reverse-proxy trust change;
- permanent workflow change;
- DICOM proxy implementation.

The phase is limited to deterministic validation and canonicalization of the credentialed browser-origin trust boundary.
