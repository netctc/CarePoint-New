# Slice 10.7 — SMART Browser Launch, OIDC & Consent UX

## Purpose

Slice 10.7 extends the CarePoint SMART-on-FHIR foundation with a standalone browser authorization flow for patient-facing public clients. It adds explicit CarePoint sign-in, optional existing MFA continuation, patient consent, OpenID Connect identity, `fhirUser`, RS256 ID Token signing and public JWKS discovery.

This slice does **not** weaken or replace the clinical authorization model. SMART scopes remain an additional restriction on top of CarePoint patient isolation, consent, treatment relationship and clinical release rules.

## Public discovery

### SMART configuration

`GET /api/v1/fhir/R4/.well-known/smart-configuration`

Slice 10.7 advertises:

- `launch-standalone`
- `client-public`
- `context-standalone-patient`
- `sso-openid-connect`
- `permission-patient`
- `permission-v2`
- PKCE `S256`
- authorization-code grant
- token endpoint authentication method `none`
- `openid` and `fhirUser` scopes
- JWKS URI

The discovery authorization endpoint is now:

`/api/v1/smart/browser/authorize`

The Slice 10.6 host-mediated endpoint `/api/v1/smart/authorize` remains available for already integrated CarePoint-mediated clients, but is no longer the standalone discovery target.

### OpenID Connect discovery

`GET /api/v1/.well-known/openid-configuration`

The document advertises RS256 ID Token signing, the browser authorization endpoint, token endpoint, JWKS URI, supported scopes and PKCE S256.

### JWKS

`GET /api/v1/smart/jwks`

Returns the public RSA signing key used to verify CarePoint SMART ID Tokens.

## Browser authorization flow

1. A registered public SMART client sends the patient browser to `/api/v1/smart/browser/authorize` with `response_type=code`, exact registered `redirect_uri`, `aud`, `state`, requested scopes, PKCE challenge and optional OIDC `nonce`.
2. CarePoint validates the client, redirect URI, audience, scopes and PKCE before creating a browser transaction.
3. The browser transaction is represented by a high-entropy opaque handle. The transaction state is stored only in the distributed ephemeral security store and expires after 10 minutes.
4. CarePoint renders a no-store login page protected by CSP and anti-clickjacking headers.
5. The patient authenticates with the existing CarePoint IAM service. If the account has MFA enabled, the existing MFA challenge is continued before authorization can proceed.
6. Any temporary internal CarePoint session issued solely to verify browser identity is revoked after identity binding. It is never returned to the SMART application.
7. CarePoint renders a consent page naming the client and listing the exact requested SMART scopes.
8. Denial returns `error=access_denied` with the original `state` and no authorization code.
9. Approval consumes the browser transaction atomically and creates the existing short-lived one-time SMART authorization code.
10. The public client exchanges the code using the matching PKCE verifier.

## OIDC and fhirUser

OIDC scopes must be requested together:

- `openid`
- `fhirUser`

When OIDC is requested through the browser endpoint, `nonce` is mandatory.

Successful token exchange returns the existing SMART access-token fields plus an RS256 `id_token` containing:

- `iss`
- pairwise-style hashed `sub`
- `aud`
- `exp`
- `iat`
- `auth_time`
- `nonce`
- `jti`
- `fhirUser`

`fhirUser` identifies the authenticated CarePoint patient as the absolute FHIR Patient URL.

No refresh token is introduced in this slice.

## Signing key requirements

In production:

- `SMART_OIDC_PRIVATE_KEY_PEM` is required.
- `SMART_OIDC_KEY_ID` may identify the deployed signing key; otherwise the default key identifier is used.
- The private key must be RSA because Slice 10.7 signs with RS256.
- The same deployment key must be shared consistently across API instances so tokens and JWKS remain stable behind a load balancer.

In non-production/test mode, CarePoint generates an ephemeral RSA key at process startup when a private key is not configured. This is intentionally unsuitable for production multi-instance deployments.

## Browser hardening

SMART browser pages set:

- `Cache-Control: no-store`
- `Pragma: no-cache`
- `Referrer-Policy: no-referrer`
- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- CSP with `default-src 'none'`, `frame-ancestors 'none'`, same-origin form actions and no script execution

The UI contains no external JavaScript, images or third-party style resources.

## Authorization boundaries

The access token produced after browser authorization is still evaluated by `SmartTokenService` and the normal CarePoint FHIR/domain services.

Therefore:

- a patient cannot authorize access to another patient;
- a client cannot use a SMART token outside explicitly SMART-enabled FHIR routes;
- a client cannot access a FHIR resource interaction not present in the granted scopes;
- release restrictions remain effective for patient-visible reports and documents;
- SMART authorization cannot create treatment relationships or consent records;
- browser consent grants the external application only the listed OAuth/SMART permissions and does not alter clinical consent records.

## Audit events

Slice 10.7 adds/uses audit events for:

- browser authorization started;
- browser MFA required;
- browser patient identity verified;
- browser consent approved;
- browser consent denied;
- authorization-code issuance;
- access-token issuance;
- existing SMART scope/non-FHIR denials and revocation.

Raw passwords, authorization codes, browser transaction handles and bearer tokens are not written to audit metadata.

## Backward compatibility

The Slice 10.6 host-mediated flow remains available at `/api/v1/smart/authorize` for its previously supported non-OIDC scopes. OIDC `openid`/`fhirUser` scopes are intentionally restricted to the new browser endpoint because they require browser authentication and nonce-bound identity semantics.

The Slice 10.6 cumulative smoke was updated to accept later Slice 10 capability versions and the browser authorization URI without weakening its original token/scope/revocation assertions.

## Acceptance coverage

`services/api/scripts/slice107-smoke.mjs` validates:

- SMART standalone discovery;
- OIDC discovery;
- JWKS publication;
- Slice 10.7 CapabilityStatement metadata;
- browser login HTML security headers;
- explicit scope display on the consent page;
- approval redirect with preserved `state`;
- denial redirect with `access_denied` and no authorization code;
- PKCE S256 token exchange;
- RS256 ID Token signature verification against the live JWKS;
- `nonce`, `aud`, `iss`, `auth_time` and `fhirUser` claims;
- FHIR Patient read and Appointment search with the browser-issued SMART access token;
- cross-patient denial;
- authorization-code replay rejection;
- browser-consent transaction replay rejection;
- missing OIDC nonce rejection.

## Explicit non-goals

Slice 10.7 does not implement:

- refresh tokens;
- confidential SMART clients;
- dynamic client registration;
- provider or system scopes;
- SMART backend services;
- private-key JWT client authentication;
- EHR launch context;
- FHIR write scopes;
- fine-grained partial scope selection on the consent page;
- external identity-provider federation/social login;
- formal SMART certification claims.

A logical next increment is Slice 10.8: refresh-token rotation and confidential/backend client foundations, or EHR launch/provider context depending the target integration roadmap.
