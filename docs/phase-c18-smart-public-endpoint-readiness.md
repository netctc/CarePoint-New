# Phase C18 — SMART public endpoint readiness

## Objective

Phase C18 hardens the public SMART on FHIR / OpenID Connect base URLs advertised by CarePoint to external clients.

`SMART_ISSUER_URL` is used to publish the SMART/OIDC issuer, authorization endpoint, token endpoint, revocation endpoint and JWKS URI. `SMART_FHIR_BASE_URL` identifies the FHIR R4 base used by SMART authorization and interoperability flows. In production, those values must identify a client-reachable CarePoint deployment rather than a local or unspecified address.

C18 is deliberately limited to the CarePoint public issuer and FHIR base URLs. It does not tighten registered SMART native-application loopback `redirect_uri` values, which remain supported by the existing SMART client policy.

## Audit finding

Before C18, `SmartConfigurationService` already provided several important controls:

- both `SMART_ISSUER_URL` and `SMART_FHIR_BASE_URL` were required in production;
- production bases had to use HTTPS;
- query strings, fragments and embedded URL credentials were rejected;
- SMART public-client redirect URIs were restricted to HTTPS or HTTP loopback;
- backend clients used pre-registered RSA/RS384 public key material.

The missing control was the destination of the two production public base URLs. Values such as:

```text
https://localhost/api/v1
https://127.0.0.1/api/v1
https://0.0.0.0/api/v1
https://[::1]/api/v1
```

still satisfied the previous HTTPS rule and could therefore be published through SMART/OIDC discovery. A patient/provider application would then be directed toward its own loopback/unspecified interface rather than the intended CarePoint identity/FHIR service.

The IAM audit performed immediately before selecting C18 also confirmed that this development line does not currently implement a password-reset/forgot-password link flow, so no speculative password-reset URL control is introduced in this phase.

## Controls implemented

### 1. Production SMART public-endpoint preflight

`services/api/src/security/production-smart-public-endpoints-preflight.ts` validates the two production bases before the Nest application is created.

Production requires both:

```text
SMART_ISSUER_URL
SMART_FHIR_BASE_URL
```

Each value must:

- be an absolute HTTP/HTTPS URL;
- use HTTPS in production;
- contain no embedded username/password credentials;
- contain no query string;
- contain no URL fragment;
- not target `localhost` or `*.localhost`;
- not target IPv4 loopback in `127.0.0.0/8`;
- not target IPv6 loopback `::1`;
- not target unspecified addresses `0.0.0.0` or `::`.

Trailing slashes are normalized for the preflight representation in the same way as the existing SMART base configuration.

C18 intentionally does not reject all RFC1918/private-network addresses or private DNS names. Enterprise deployments can legitimately expose SMART/FHIR services only to managed devices on a private network or VPN. Network reachability, DNS and certificate trust remain deployment/infrastructure concerns.

### 2. Fail closed before Nest creation

`assertProductionSmartPublicEndpointsReady()` runs before `NestFactory.create()`.

An invalid production issuer/FHIR destination therefore prevents the API from constructing the application and accepting traffic. The existing `SmartConfigurationService` then retains its own HTTPS/clean-base validation when Nest initializes SMART configuration, providing the established second layer for scheme, credentials, query and fragment rules.

### 3. Native SMART loopback redirects preserved

C18 does **not** apply the public-base destination restriction to registered SMART application redirect URIs.

The existing policy continues to allow a native application configuration such as:

```text
http://127.0.0.1:8787/callback
```

while still requiring HTTPS for non-loopback redirect destinations. The C18 acceptance test explicitly protects this behavior.

### 4. Deployment configuration documented

The API `.env.example` now exposes the existing SMART configuration variables that were previously required by runtime code but absent from the example:

```text
SMART_ISSUER_URL=
SMART_FHIR_BASE_URL=
SMART_PUBLIC_CLIENTS_JSON=
SMART_BACKEND_CLIENTS_JSON=
```

No live endpoints, client registrations, private keys or credentials are committed.

## Production example

A production deployment can use distinct identity and FHIR hosts:

```text
SMART_ISSUER_URL=https://identity.example.com/api/v1
SMART_FHIR_BASE_URL=https://fhir.example.com/api/v1/fhir/R4
```

or a single CarePoint public host where appropriate:

```text
SMART_ISSUER_URL=https://carepoint.example.com/api/v1
SMART_FHIR_BASE_URL=https://carepoint.example.com/api/v1/fhir/R4
```

`SMART_PUBLIC_CLIENTS_JSON` and `SMART_BACKEND_CLIENTS_JSON` remain deployment-specific registrations and should be managed as controlled configuration. Backend JWKS data must contain public verification material only, as enforced by the existing SMART configuration service.

## Acceptance

The API workspace exposes:

```text
npm run c18:smart-public-endpoint-readiness
```

and C18 is appended to the existing C3→C18 API test chain. No permanent GitHub workflow modification is needed.

The C18 smoke verifies:

- production requires issuer and FHIR base values;
- HTTPS enforcement;
- rejection of unsupported schemes;
- credential/query/fragment rejection;
- localhost, IPv4/IPv6 loopback and unspecified-host rejection;
- a private RFC1918 endpoint is not rejected solely for being private;
- a valid `SmartConfigurationService` instance publishes the expected issuer, authorization and token URLs;
- valid FHIR base publication;
- native HTTP loopback redirect URIs remain accepted in production client registration;
- the C18 preflight appears before `NestFactory.create()`;
- `.env.example` contains the SMART configuration variables;
- no new HTTP dependency is added.

The permanent FHIR/Slice 10 workflows remain responsible for the broader SMART/FHIR interoperability regression surface.

## Change boundaries

C18 introduces no:

- database migration;
- package dependency;
- `package-lock.json` change;
- mobile dependency/lock change;
- redirect-URI policy change;
- external network probe;
- retry behavior;
- permanent workflow change;
- password-reset flow.

The phase only adds deterministic production configuration validation for the public SMART/OIDC/FHIR endpoint boundary plus the missing deployment-example entries.
