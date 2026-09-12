# Slice 10.8 — SMART Refresh Token Rotation, Revocation & Client Hardening

## Purpose

Slice 10.8 extends the validated CarePoint SMART-on-FHIR browser authorization foundation with controlled offline access for registered public clients.

The slice adds the `offline_access` scope and the OAuth `refresh_token` grant while preserving the central CarePoint security rule established in previous interoperability slices:

> SMART authorization can restrict CarePoint clinical access, but it can never expand it.

A refreshed SMART access token still passes through the same patient boundary, resource-scope, consent, treatment-relationship, release-gate and FHIR authorization controls as an access token issued directly from the authorization-code flow.

## Supported flow

A registered public SMART application may request:

- `launch/patient`
- one or more supported `patient/...` scopes
- optionally `openid fhirUser`
- optionally `offline_access`

`offline_access` is accepted only through the standalone browser authorization flow introduced in Slice 10.7:

`GET /api/v1/smart/browser/authorize`

It is deliberately rejected by the legacy/host-mediated endpoint:

`GET /api/v1/smart/authorize`

This guarantees that offline authorization is tied to the explicit browser consent screen rather than being silently added to an already authenticated CarePoint session.

## Discovery

### SMART configuration

`GET /api/v1/fhir/R4/.well-known/smart-configuration`

Slice 10.8 advertises:

- scope `offline_access`
- capability `permission-offline`
- grant types `authorization_code` and `refresh_token`

### OpenID Connect configuration

`GET /api/v1/.well-known/openid-configuration`

The discovery document now also advertises the `refresh_token` grant.

The existing Slice 10.7 OIDC/JWKS behavior remains unchanged:

- RS256 ID Tokens
- pairwise subject identifiers
- `fhirUser`
- public JWKS
- PKCE `S256`

## Token lifetime model

### Access token

- opaque bearer token
- 15-minute lifetime
- stored only as a hash-addressed ephemeral Redis security record
- no raw bearer value is persisted in PostgreSQL

### Refresh-token family

- absolute family lifetime: **30 days**
- the family expiry does not slide forward when a token is refreshed
- each refresh token is single-use
- every successful refresh rotates to a new opaque refresh token
- raw refresh bearer values are never persisted; Redis keys are derived from token hashes

The 30-day duration is an implementation policy for this slice, not a statement that all future CarePoint deployments must use that exact duration.

## Rotation model

A successful refresh request uses:

`POST /api/v1/smart/token`

with:

- `grant_type=refresh_token`
- `refresh_token=<opaque token>`
- `client_id=<registered public client>`

The server performs the following security sequence:

1. verifies that the refresh token belongs to the requesting registered client;
2. atomically consumes the active refresh-token record;
3. atomically writes a used-token marker;
4. verifies that the refresh family is still active;
5. verifies that the CarePoint patient account is still active and still maps to the same patient profile;
6. issues a new 15-minute access token;
7. issues a new refresh token when `offline_access` remains granted;
8. keeps the original absolute family expiry.

The Redis consume-and-mark operation is atomic so multiple API instances share the same one-time-use state.

## Refresh-token reuse detection

If a previously consumed refresh token is presented again, CarePoint treats it as possible token theft or unsafe concurrent reuse.

The server:

1. identifies the family from the used-token marker;
2. deletes the active refresh-family record;
3. emits the `SMART_REFRESH_TOKEN_REUSE_DETECTED` audit event;
4. returns OAuth `invalid_grant`;
5. invalidates descendant refresh tokens because their family no longer exists;
6. invalidates already issued family-bound access tokens during their next validation.

This is intentionally fail-closed.

## Access-token binding to refresh families

Access tokens issued from an offline authorization are tagged internally with a refresh-family identifier.

The bearer token itself remains opaque.

When CarePoint validates such an access token, it additionally verifies that the refresh family still exists and matches:

- client
- CarePoint user
- patient
- family identifier
- absolute family lifetime

Deleting the family therefore invalidates all access tokens linked to it without maintaining a database list of bearer values.

## Revocation semantics

`POST /api/v1/smart/revoke`

continues to follow non-disclosing revocation behavior: an unknown, expired or mismatched token does not reveal token existence.

### Revoking a family-bound access token

If a valid access token belongs to a refresh family:

- that access token is removed;
- the refresh family is revoked;
- all refresh descendants become unusable;
- other family-bound access tokens fail on their next validation.

### Revoking an active refresh token

If the submitted token is the current refresh token:

- the token is removed;
- the family is revoked;
- family-bound access tokens become invalid.

### Revoking an already rotated refresh token

CarePoint can identify the family from the used-token marker and revoke the family without reactivating the old token.

## Scope handling during refresh

A refresh request may omit `scope`; in that case the current refresh-token scopes are retained.

A request may also provide a reduced scope set.

Rules:

- a refresh request cannot add a scope that was not present on the token being refreshed;
- patient launch context and at least one patient resource scope must remain;
- `openid` and `fhirUser` must be retained or removed together;
- a client may remove `offline_access`.

If `offline_access` is removed:

- no replacement refresh token is issued;
- the refresh family is closed;
- the newly issued access token is not family-bound and remains valid for its normal 15-minute lifetime.

This allows an application to deliberately downgrade an offline authorization to online-only access.

## OIDC behavior on refresh

Slice 10.8 does not emit a new ID Token from the refresh-token grant.

The original Slice 10.7 authorization-code exchange continues to issue an ID Token when `openid fhirUser` were approved.

This minimizes identity-token issuance and avoids introducing additional OIDC refresh semantics before they are explicitly required.

## Client hardening

This slice continues to support pre-registered public clients only.

A refresh token is bound to the `client_id` that received the original authorization. A request using the wrong client identifier is rejected before the active token is consumed, preventing a different public client from invalidating a legitimate application's refresh token merely by presenting its bearer value with the wrong identity.

The `/smart/token` endpoint also applies distributed rate limits to:

- source IP;
- client identifier;
- the submitted authorization-code or refresh-token credential.

The rate-limit identity is hashed before becoming a Redis key.

## Audit events

Relevant events include:

- `SMART_AUTHORIZATION_CODE_ISSUED`
- `SMART_ACCESS_TOKEN_ISSUED`
- `SMART_REFRESH_TOKEN_ROTATED`
- `SMART_REFRESH_TOKEN_REUSE_DETECTED`
- `SMART_REFRESH_FAMILY_REVOKED`
- `SMART_REFRESH_FAMILY_CLOSED`
- `SMART_ACCESS_TOKEN_REVOKED`

Audit metadata contains internal identifiers such as family IDs and refresh IDs, never raw access tokens, authorization codes or refresh-token bearer values.

## Persistence boundary

No PostgreSQL schema migration is introduced by Slice 10.8.

Security state remains in Redis:

- authorization codes
- browser authorization transactions
- SMART access-token records
- refresh-token records
- consumed refresh-token markers
- refresh-family records

Production already requires Redis for distributed security controls. Non-production memory fallback remains available for local development, but the CI acceptance workflow exercises Redis.

## Capability version

The public FHIR CapabilityStatement reports:

`slice-10.8`

Earlier cumulative smoke tests accept later Slice 10 minor versions while retaining their own functional assertions.

## Acceptance coverage

`services/api/scripts/slice108-smoke.mjs` validates:

- `offline_access` discovery;
- `permission-offline` capability;
- `refresh_token` grant discovery;
- browser-only offline consent;
- initial refresh-token issuance;
- refresh-token rotation;
- no ID Token re-issuance on refresh;
- wrong-client rejection without consuming the legitimate refresh token;
- patient isolation after refresh;
- old refresh-token replay detection;
- replay-triggered family compromise;
- invalidation of descendant refresh tokens;
- invalidation of family-bound access tokens;
- access-token revocation revoking the family;
- refresh-token revocation revoking the family;
- scope downgrade from offline to online-only access.

The dedicated Slice 10 workflow continues to execute all prior FHIR/SMART smoke tests before Slice 10.8.

## Explicit non-goals

Slice 10.8 does **not** add:

- confidential SMART clients;
- client secrets;
- private-key JWT client authentication;
- SMART backend services;
- `system/...` scopes;
- provider/user SMART scopes;
- dynamic client registration;
- EHR launch context;
- FHIR write permissions;
- persistent OAuth grant administration UI;
- user-facing authorization-management/revocation dashboard;
- formal SMART certification claims.

These remain candidates for later interoperability slices.

## Next logical increment

A suitable next slice is **Slice 10.9 — SMART Confidential Clients & Backend Services Hardening**, provided CarePoint needs machine-to-machine interoperability. That work should introduce asymmetric client authentication and `system/...` scopes separately from the patient-mediated public-client security model implemented here.
