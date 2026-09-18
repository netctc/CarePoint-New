# Slice 10.6 — SMART-on-FHIR Discovery and External OAuth Authorization

## Objective

Slice 10.6 adds a secure SMART App Launch 2.2-style authorization foundation to the existing CarePoint FHIR R4 read-only facade.

The implementation is deliberately additive. A SMART scope can reduce what an external application may do, but it never expands the underlying CarePoint user, patient, consent, treatment-relationship, document-release, diagnostic-release, or cross-patient authorization rules.

## Public discovery

FHIR base URL:

`{SMART_FHIR_BASE_URL}`

Discovery endpoint:

`GET {SMART_FHIR_BASE_URL}/.well-known/smart-configuration`

The discovery document publishes absolute authorization, token, and revocation endpoints plus the supported PKCE method and patient resource scopes.

Slice 10.6 supports public clients and PKCE `S256`. It does not issue client secrets.

## OAuth endpoints

Authorization endpoint:

`GET {SMART_ISSUER_URL}/smart/authorize`

Token endpoint:

`POST {SMART_ISSUER_URL}/smart/token`

Revocation endpoint:

`POST {SMART_ISSUER_URL}/smart/revoke`

The authorization endpoint accepts the OAuth authorization-code parameters:

- `response_type=code`
- `client_id`
- exact registered `redirect_uri`
- `scope`
- `state`
- `aud`, which must equal `SMART_FHIR_BASE_URL`
- `code_challenge`
- `code_challenge_method=S256`

The current Slice 10.6 authorization endpoint is host-mediated: it requires an already authenticated CarePoint patient bearer session. A SMART access token cannot be used to mint another SMART grant.

After successful approval, CarePoint returns an HTTP 302 redirect to the exact registered callback URI with a one-time authorization code and the unchanged `state` value.

## Token exchange

The token endpoint accepts `application/x-www-form-urlencoded` authorization-code exchanges with:

- `grant_type=authorization_code`
- `code`
- `client_id`
- exact `redirect_uri`
- `code_verifier`

Authorization codes expire after 180 seconds and are consumed atomically through Redis. A successfully exchanged code cannot be replayed.

Access tokens are opaque random bearer tokens with a 15-minute TTL. Raw tokens are never persisted to PostgreSQL and are never written to audit metadata. Redis keys use token hashes.

No refresh token is issued in this slice.

## Supported SMART scopes

Slice 10.6 uses SMART v2 granular interaction suffixes.

| Scope | CarePoint FHIR capability |
| --- | --- |
| `launch/patient` | Establish the authenticated CarePoint patient as launch context |
| `patient/Patient.r` | Read the in-context Patient |
| `patient/Appointment.rs` | Read/search appointments available to the patient |
| `patient/Encounter.r` | Read an authorized clinical encounter |
| `patient/Observation.s` | Search authorized vital/laboratory observations |
| `patient/MedicationRequest.r` | Read an authorized prescription order |
| `patient/ServiceRequest.r` | Read an authorized laboratory service request |
| `patient/DiagnosticReport.rs` | Read/search diagnostic reports after existing release rules |
| `patient/DocumentReference.rs` | Read/search clinical-document metadata after existing release rules |
| `patient/ImagingStudy.r` | Read a safe study-level imaging representation after existing release rules |

A client may request only scopes present in its deployment registration.

## External client registration

Slice 10.6 uses deployment-managed public client registration through:

`SMART_PUBLIC_CLIENTS_JSON`

Example shape:

```json
[
  {
    "clientId": "example-public-client",
    "name": "Example SMART App",
    "redirectUris": ["https://app.example.com/callback"],
    "allowedScopes": [
      "launch/patient",
      "patient/Patient.r",
      "patient/Appointment.rs"
    ]
  }
]
```

Redirect URIs are matched exactly after URL canonicalization. HTTPS is required except for HTTP loopback addresses used by native development clients. Embedded URL credentials and fragments are rejected.

Dynamic Client Registration is not implemented in this slice.

## Resource-server enforcement

The global API access guard now distinguishes two bearer-token classes:

1. normal CarePoint session tokens;
2. short-lived SMART access tokens stored through the distributed security store.

Normal CarePoint sessions keep their existing behavior.

SMART tokens are fail-closed. They can access only FHIR routes decorated with an explicit SMART resource/interaction requirement. A SMART token presented to `/iam`, `/clinical-documents`, `/billing`, `/claims`, or any other non-FHIR CarePoint route is denied.

For a SMART FHIR request, both checks must succeed:

`SMART resource scope` **AND** `existing CarePoint domain authorization`.

Examples:

- `patient/Patient.r` does not allow `Appointment` search.
- `patient/Appointment.rs` does not allow access to another patient's appointments.
- `patient/DocumentReference.rs` does not bypass document release-to-patient rules.
- `patient/DiagnosticReport.rs` does not expose unreleased reports.
- `patient/ImagingStudy.r` does not expose PACS routing details.

## FHIR CapabilityStatement

`GET /api/v1/fhir/R4/metadata` now reports software version `slice-10.6`.

The server security metadata includes the SMART OAuth URI extension for the authorization and token endpoints. The existing FHIR no-store and `nosniff` hardening remains unchanged.

## Distributed ephemeral security storage

The existing Redis security infrastructure now exposes a constrained ephemeral key/value facility for security artifacts.

Production continues to require Redis. Authorization codes and SMART access tokens therefore remain consistent across horizontally scaled API instances.

The non-production in-memory fallback is retained for local development only.

## Audit events

Slice 10.6 adds audit actions including:

- `SMART_AUTHORIZATION_CODE_ISSUED`
- `SMART_ACCESS_TOKEN_ISSUED`
- `SMART_ACCESS_TOKEN_REVOKED`
- `SMART_SCOPE_DENIED`
- `SMART_NON_FHIR_ROUTE_DENIED`

Audit records contain client, patient, scope, and expiry metadata where appropriate, but never authorization codes, PKCE verifiers, or raw bearer tokens.

## Production configuration

Production requires:

- `SMART_ISSUER_URL`, using HTTPS
- `SMART_FHIR_BASE_URL`, using HTTPS
- `REDIS_URL`

`SMART_PUBLIC_CLIENTS_JSON` is supplied when one or more external applications are enabled.

## Acceptance coverage

The dedicated Slice 10.6 smoke test verifies:

- `.well-known/smart-configuration` discovery;
- absolute authorization/token endpoint publication;
- FHIR CapabilityStatement SMART OAuth metadata;
- PKCE `S256`;
- exact redirect URI and audience checks;
- patient-mediated authorization-code issuance;
- form-encoded token exchange;
- one-time authorization-code consumption;
- granular SMART resource scope denial;
- existing patient isolation under SMART tokens;
- denial of SMART tokens on non-FHIR APIs;
- denial of SMART-token grant chaining;
- token revocation;
- no refresh or ID token issuance;
- compatibility with the cumulative Slice 10.0–10.5 tests.

## Non-goals

Slice 10.6 does not claim complete SMART App Launch certification. The following remain outside this increment:

- CarePoint-hosted browser login/consent UI for a fully independent standalone-launch user-agent flow;
- EHR launch identifiers and encounter launch context;
- OpenID Connect ID tokens, `openid`, or `fhirUser`;
- refresh tokens, `offline_access`, or `online_access`;
- provider/user scopes;
- backend-service `system/` scopes;
- confidential-client secrets;
- asymmetric private-key JWT client authentication;
- dynamic client registration;
- token introspection;
- SMART Brands publication;
- fine-grained scope search constraints;
- FHIR write operations.

These are intentionally deferred so that later slices can add them without weakening the validated CarePoint authorization boundaries.
