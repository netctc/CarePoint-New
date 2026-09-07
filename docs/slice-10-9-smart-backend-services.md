# Slice 10.9 — SMART Confidential Clients & Backend Services Hardening

## Status

Implemented as an incremental extension of the validated Slice 10.0–10.8 FHIR/SMART interoperability foundation.

This slice adds a deliberately narrow SMART backend-services authorization model for trusted machine-to-machine integrations. It does not replace the existing patient-mediated SMART browser flow and it does not convert CarePoint service accounts into ordinary CarePoint users.

## Goals

Slice 10.9 provides:

- pre-registered asymmetric SMART backend clients;
- OAuth 2.0 `client_credentials` token issuance;
- `private_key_jwt` client authentication;
- registered client JWKS verification;
- one-time client assertion replay protection;
- short-lived opaque system access tokens;
- explicit `system/...` FHIR scopes;
- dedicated system-level FHIR Patient and Appointment handlers;
- backend token revocation authenticated with a fresh client assertion;
- complete audit events without storing assertions, private keys or bearer values;
- strict isolation from non-FHIR CarePoint APIs.

## Supported backend scopes

The initial system scope allowlist is intentionally small:

| Scope | FHIR interactions enabled |
| --- | --- |
| `system/Patient.rs` | Patient read and Patient search |
| `system/Appointment.rs` | Appointment read and Appointment search |

No wildcard system scope is accepted.

No system scope is provided in this slice for Encounter, Observation, MedicationRequest, ServiceRequest, DiagnosticReport, DocumentReference, ImagingStudy or Practitioner.

The absence of those scopes is a security boundary, not an implementation omission to be bypassed.

## Client registration

Backend clients are configured separately from public SMART applications through:

`SMART_BACKEND_CLIENTS_JSON`

Example structure:

```json
[
  {
    "clientId": "example-backend-client",
    "name": "Example Backend Integration",
    "allowedScopes": [
      "system/Patient.rs",
      "system/Appointment.rs"
    ],
    "jwks": {
      "keys": [
        {
          "kty": "RSA",
          "kid": "integration-key-2026-01",
          "alg": "RS384",
          "use": "sig",
          "key_ops": ["verify"],
          "n": "...",
          "e": "AQAB"
        }
      ]
    }
  }
]
```

### Registration validation

CarePoint rejects backend configuration when:

- a client id collides with a public SMART client id;
- a client requests patient scopes instead of system scopes;
- no JWKS key is supplied;
- more than five keys are registered for one client;
- duplicate `kid` values exist;
- the JWK is not RSA;
- `alg` is not `RS384`;
- `use`, when supplied, is not `sig`;
- `key_ops`, when supplied, is not exactly `verify`;
- private RSA parameters such as `d`, `p`, `q`, `dp`, `dq` or `qi` are present;
- the RSA public key material is structurally invalid.

Only public verification material is stored in application configuration. CarePoint never receives or stores the backend client's private signing key.

## Discovery

SMART discovery continues at:

`GET /api/v1/fhir/R4/.well-known/smart-configuration`

Slice 10.9 additionally advertises:

- `client-confidential-asymmetric`;
- `permission-system`;
- `client_credentials`;
- `private_key_jwt`;
- `RS384` client assertion signing;
- `system/Patient.rs`;
- `system/Appointment.rs`.

The OpenID Provider metadata also advertises `client_credentials`, `private_key_jwt` and `RS384` for token endpoint client authentication.

The public FHIR CapabilityStatement version is:

`slice-10.9`

The CapabilityStatement advertises the SMART-on-FHIR REST security service and Patient `search-type` support. Patient search is explicitly documented as system-scope functionality.

## Client assertion requirements

A backend client requests a token from:

`POST /api/v1/smart/token`

with:

- `grant_type=client_credentials`;
- `client_id`;
- requested `scope`;
- `client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer`;
- `client_assertion`.

The assertion is a compact JWT signed with the client's registered private key.

### Required assertion rules

CarePoint requires:

- `alg=RS384`;
- registered `kid`;
- `iss == client_id`;
- `sub == client_id`;
- `aud` equal to the CarePoint SMART token endpoint;
- integer `iat`;
- integer `exp`;
- assertion lifetime no longer than five minutes;
- a non-trivial `jti`;
- a valid signature against the pre-registered public JWK.

The server accepts a small clock-skew window but rejects assertions issued outside the accepted time window.

### Key injection hardening

Assertions are rejected if their protected header attempts to supply alternate key material or key locations through:

- `jku`;
- `jwk`;
- `x5u`.

Only pre-registered key material can authenticate a backend client.

## Assertion replay prevention

Each accepted `jti` is atomically claimed in Redis using a `SET ... NX` equivalent.

The replay key contains hashes of the client id and `jti`, not the raw assertion.

A second use of the same assertion is rejected as `invalid_client`.

This protection is distributed across CarePoint API instances sharing Redis.

Replaying a client assertion does not revoke a system token already issued from the first legitimate use; it simply prevents duplicate client authentication.

## Backend access tokens

Successful client authentication issues an opaque bearer token with:

- five-minute lifetime;
- requested registered system scopes only;
- no Patient launch context;
- no `patient` response field;
- no ID Token;
- no refresh token;
- no user identity inheritance.

Raw bearer values are not persisted in PostgreSQL. Redis stores only hash-addressed token state.

The logical SMART authorization context records:

- authorization type `system`;
- client id;
- token id;
- scopes;
- expiry.

A synthetic internal principal is used only to pass through the existing API guard infrastructure. FHIR system handlers authorize from the SMART `system` context and system scopes, not from ordinary CarePoint role permissions.

## FHIR system access

### Patient read

`GET /api/v1/fhir/R4/Patient/{id}`

With `system/Patient.rs`, a backend integration may read a Patient resource without patient-self identity. The access is audited as system access.

### Patient search

`GET /api/v1/fhir/R4/Patient`

Allowed parameters:

- `_id` — exact CarePoint Patient resource id;
- `_count` — 1 through 100;
- `_offset` — CarePoint deterministic pagination control.

The query uses database-side count and pagination so `Bundle.total` remains exact.

### Appointment read

`GET /api/v1/fhir/R4/Appointment/{id}`

Requires `system/Appointment.rs`.

### Appointment search

`GET /api/v1/fhir/R4/Appointment`

For system tokens, `patient` is optional.

Allowed parameters:

- `patient`;
- `status`;
- `_count`;
- `_offset`.

Supported status values remain:

- `pending`;
- `booked`;
- `cancelled`;
- `fulfilled`;
- `noshow`;
- `entered-in-error`.

The system search performs database-side filtering, exact count and deterministic pagination.

Patient SMART access continues to use the existing patient-scoped Appointment search behavior from Slice 10.5. Slice 10.9 does not broaden patient tokens.

## Scope isolation

A token carrying only `system/Patient.rs` cannot access Appointment.

A backend client cannot request an unregistered scope such as `system/Observation.rs`.

A system token cannot access a resource whose `system/...` scope has not been explicitly registered and implemented.

All SMART tokens, patient or system, continue to be denied on CarePoint API routes that are not explicitly decorated as scoped FHIR endpoints.

For example, a system token cannot use `/api/v1/iam/accounts/me` or administrative CarePoint routes.

## Revocation

System access-token revocation uses:

`POST /api/v1/smart/revoke`

A backend client must authenticate the revocation request with a fresh `private_key_jwt` assertion whose audience is the revocation endpoint.

A token is deleted only when it belongs to the authenticated backend client.

The revocation assertion is independently replay-protected.

## Audit events

Slice 10.9 adds dedicated events including:

- `SMART_BACKEND_CLIENT_AUTHENTICATED`;
- `SMART_BACKEND_ACCESS_TOKEN_ISSUED`;
- `SMART_BACKEND_ACCESS_TOKEN_REVOKED`;
- `FHIR_SYSTEM_PATIENT_READ`;
- `FHIR_SYSTEM_PATIENT_SEARCH`;
- `FHIR_SYSTEM_APPOINTMENT_READ`;
- `FHIR_SYSTEM_APPOINTMENT_SEARCH`.

Audit metadata may include client id, token id, scope set, registered `kid`, hashed assertion `jti`, paging controls and result totals.

Audit records do not contain:

- private keys;
- raw client assertions;
- raw access tokens;
- patient browser passwords;
- refresh tokens.

## Coexistence with patient SMART authorization

Slices 10.6–10.8 remain intact:

- public clients continue to use authorization code + PKCE;
- standalone browser launch and explicit patient consent remain unchanged;
- OIDC `openid` / `fhirUser` remain patient-flow functionality;
- `offline_access` continues to use rotating patient refresh-token families;
- backend clients are not registered in the public client registry and cannot enter the browser authorization flow.

Patient scopes and system scopes cannot be mixed during registration or token issuance.

## Security properties

The implementation follows these principles:

1. **Asymmetric client authentication** — no reusable client secret is sent to CarePoint.
2. **Registered keys only** — assertions cannot point the server at attacker-controlled JWKS locations.
3. **Short-lived assertions** — a client assertion has a maximum five-minute validity.
4. **One-time assertion use** — `jti` replay is denied through distributed Redis state.
5. **Short-lived bearer tokens** — backend access tokens expire after five minutes.
6. **No refresh grant for systems** — backend processes must re-authenticate with their private key.
7. **Explicit scope allowlist** — no wildcard or implicit system resource access.
8. **FHIR-only boundary** — system bearers cannot become general CarePoint API credentials.
9. **Dedicated system handlers** — machine authorization does not masquerade as a patient, doctor or administrator.
10. **Auditable machine identity** — security events identify the registered client without exposing secrets.

## Deployment requirements

Production deployment must provide:

- `SMART_ISSUER_URL` over HTTPS;
- `SMART_FHIR_BASE_URL` over HTTPS;
- `REDIS_URL` for distributed token and assertion replay controls;
- `SMART_BACKEND_CLIENTS_JSON` for each approved M2M integration;
- secure operational procedures for registering, rotating and removing client public keys.

The private key stays with the external integration and must not be stored in CarePoint configuration.

Removing a backend client from CarePoint configuration causes existing system tokens to fail validation on their next use.

Removing a scope from that client's configured allowlist likewise invalidates tokens that still contain the removed scope.

## Validation

`services/api/scripts/slice109-smoke.mjs` validates with a runtime-generated RSA key pair:

- discovery metadata;
- `private_key_jwt` RS384 authentication;
- client-assertion replay rejection;
- wrong-audience rejection;
- wrong-signature rejection;
- unregistered-scope rejection;
- system Patient read across two different patients;
- Patient `_id` search and pagination;
- Appointment read and filtered search;
- narrower-scope denial;
- non-FHIR isolation;
- unsupported FHIR-resource denial;
- no refresh token / ID Token / patient context in backend grants;
- authenticated system-token revocation;
- post-revocation denial;
- machine-access audit events.

The dedicated Slice 10 workflow executes the cumulative Slice 10.0–10.9 interoperability suite.

## Explicit non-goals

Slice 10.9 does not add:

- symmetric client secrets;
- `client_secret_basic`;
- `client_secret_post`;
- dynamic client registration;
- remote `jwks_uri` fetching;
- arbitrary assertion key URLs;
- wildcard `system/*` scopes;
- provider/user SMART scopes;
- EHR launch context;
- backend refresh tokens;
- FHIR write scopes;
- bulk-data export;
- Encounter/Observation/Orders/Documents system access;
- formal SMART conformance or certification claims.

Those capabilities require separate threat modeling and acceptance criteria before being exposed.
