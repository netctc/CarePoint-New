# CarePoint 0.9 Closed Pilot Runbook

Status: **PREPARATION / NOT YET DEPLOYED**  
Phase A baseline: `d896e543a911fe9f171f8736ae80ee3d094867f6`  
Target: invite-only staging with synthetic data, no public healthcare launch

## 1. Scope and safety boundary

The private pilot is for controlled product validation by named testers. It is not approved for real patient data, real payment cards, public registration, emergency dispatch or commercial telemedicine. The edge must enforce identity allowlisting before traffic reaches Admin or API. Application login is a second control and does not replace the edge allowlist.

The pilot starts with Admin operations, providers, doctors, appointments and security views; Patient profile, search, clinic/home-visit booking and visit timeline; Doctor and Other Provider queue/snapshot/service completion where available; and in-app/synthetic notifications only.

The pilot excludes patient self-registration; payments, insurance and claims; telehealth; emergency ambulance; external notification delivery; real PHI; real cards; public indexing; and public SMART/FHIR exposure.

## 2. Isolated synthetic infrastructure profile

The closed pilot may use the explicit `isolated-synthetic` infrastructure profile. This profile is a sequencing mechanism for synthetic private validation only. It does not weaken or replace the normal production preflight path and it is not production-equivalent evidence for R3-R10.

The profile is active only when all of the following are explicit:

| Variable | Required value |
| --- | --- |
| `NODE_ENV` | `production` |
| `CAREPOINT_PRIVATE_PILOT` | `true` |
| `CAREPOINT_PRIVATE_PILOT_INFRA_PROFILE` | `isolated-synthetic` |
| `CAREPOINT_PRIVATE_PILOT_DATA_MODE` | `synthetic-only` |
| `CAREPOINT_PRIVATE_PILOT_AUDIT_MODE` | `database-local` |
| `CAREPOINT_PRIVATE_PILOT_TELEMETRY_MODE` | `structured-local` |
| `CAREPOINT_PRIVATE_PILOT_SMART_FHIR_ENABLED` | `false` |
| `CAREPOINT_PATIENT_SELF_REGISTRATION_ENABLED` | `false` |
| `CAREPOINT_PAYMENTS_ENABLED` | `false` |
| `CAREPOINT_TELEHEALTH_ENABLED` | `false` |
| `CAREPOINT_EXTERNAL_NOTIFICATIONS_ENABLED` | `false` |
| `EMERGENCY_AMBULANCE_ENABLED` | `false` |
| `NOTIFICATION_GATEWAY_PROVIDER` | `mock` |
| `SIEM_EXPORT_ENABLED` | `false` |
| `SIEM_WORKER_ENABLED` | `false` |

The profile keeps production cookies, HSTS/security headers, CORS/origin rules, MFA policy, release identity, inbound body limits, provider response limits and application authorization active. Normal production startup remains unchanged when `CAREPOINT_PRIVATE_PILOT_INFRA_PROFILE` is absent.

Under this profile, audit events remain durable in the isolated PostgreSQL database but are not exported to an external SIEM. HTTP telemetry remains active as structured local request logs with request, trace and span correlation. SMART/FHIR modules are not mounted. These are pilot-safe equivalents only and do not close the corresponding public-production gates.

The appointment notification orchestrator must remain enabled in the isolated synthetic pilot so booking/status lifecycle notifications continue to be processed. `APPOINTMENT_REMINDER_OFFSETS_MINUTES` may be omitted under this profile because no launch-market reminder timing policy has been approved for the synthetic pilot. When omitted, scheduled appointment reminder creation remains inactive while lifecycle/status notifications continue through the mock/in-app path. This exception is limited to the explicit `isolated-synthetic` profile; normal production still fails closed when reminder offsets are absent.

## 3. Isolated dependency requirements

### PostgreSQL

Use a dedicated authenticated PostgreSQL endpoint reachable only over loopback/private/internal networking. The database name must contain `pilot`, `staging` or `uat`, and `DATABASE_URL` must include an explicit `connection_limit`. Do not point the pilot at any existing non-pilot CarePoint database.

A local/private non-TLS database connection is permitted only by this explicit isolated-synthetic profile. Normal production continues to require the production PostgreSQL TLS/HA/PITR contract.

### Redis

Use a dedicated authenticated Redis endpoint on loopback/private/internal networking. Configure a pilot-scoped `CAREPOINT_PRIVATE_PILOT_REDIS_NAMESPACE` containing `pilot`, `staging` or `uat`. Do not reuse a public or unauthenticated Redis endpoint.

### Local synthetic cryptography

The isolated profile requires local providers for MFA, clinical records, orders/results, document metadata/content and secure messaging. Envelope keys must decode to exactly 32 bytes; signing secrets must decode to at least 32 bytes. Every local key identifier must contain `pilot`, `staging` or `uat`. Store values only in the restricted deployment configuration; never commit or print them.

Required provider values are `MFA_KEY_PROVIDER=local`, `CLINICAL_KEY_PROVIDER=local`, `ORDER_KEY_PROVIDER=local`, `ORDER_SIGNING_PROVIDER=local`, `DOCUMENT_KEY_PROVIDER=local`, `DOCUMENT_SIGNING_PROVIDER=local`, and `MESSAGING_KEY_PROVIDER=local`.

### Local synthetic storage and scanning

Set `DOCUMENT_STORAGE_PROVIDER=local`, `BULK_EXPORT_STORAGE_PROVIDER=local`, `DOCUMENT_SCAN_PROVIDER=mock` and `DICOMWEB_PROVIDER=mock`. `DOCUMENT_STORAGE_LOCAL_ROOT` and `BULK_EXPORT_STORAGE_LOCAL_ROOT` must be absolute dedicated paths containing `pilot`, `staging` or `uat`; generic `/tmp/carepoint-*` roots are rejected. Mount the directories privately and use restrictive host permissions.

The mock scanner/DICOM paths are synthetic-pilot-only. Real clinical document exchange remains out of scope.

## 4. Required controlled inputs

Keep values in the deployment platform or restricted evidence store. Do not commit them.

1. Named pilot owner and stop-pilot authority.
2. Tester allowlist containing only approved identities.
3. Restricted defect-reporting channel and daily triage owner.
4. Immutable API and Admin artifact digests for the approved pilot candidate.
5. Dedicated pilot PostgreSQL and Redis endpoints.
6. Pilot database name containing `pilot`, `staging` or `uat`.
7. Logical database snapshot reference captured immediately before fixture creation.
8. Restricted local synthetic encryption/signing keys and private storage roots.

## 5. Release identity

The deployment must provide:

| Variable | Required value |
| --- | --- |
| `CAREPOINT_RELEASE_VERSION` | `0.9-closed-pilot.<n>` |
| `CAREPOINT_RELEASE_SHA` | exact deployed source SHA |
| `CAREPOINT_RELEASE_SOURCE_REF` | approved pilot/release ref |
| `CAREPOINT_RELEASE_ARTIFACT_DIGEST` | exact immutable API digest |

Health and readiness must expose the exact release identity plus `pilotInfrastructureProfile: "isolated-synthetic"`.

## 6. Edge access control

Configure Cloudflare Access, VPN or an equivalent identity-aware allowlist for every pilot hostname. Use deny-by-default policy and add only named testers. Do not use a shared password as the only edge control.

Verify before opening tester access: an allowlisted identity reaches application login; an unlisted identity is denied at the edge; an unauthenticated browser is denied at the edge; Admin responses include `X-Robots-Tag: noindex, nofollow, noarchive`; and the site is absent from public navigation.

## 7. Database snapshot and synthetic fixtures

Before migration or fixture creation, record the previous runtime/artifact as the rollback target and capture a logical snapshot of the isolated pilot database. Store its checksum and restricted reference outside GitHub.

Run the approved migration/bootstrap/fixture commands from the exact candidate artifact/source context:

```bash
npm --workspace @carepoint/api run db:deploy
npm --workspace @carepoint/api run db:bootstrap
npm --workspace @carepoint/api run db:pilot-fixtures
```

The fixture command additionally requires:

- `CAREPOINT_PILOT_FIXTURES_CONFIRM=CREATE_SYNTHETIC_PRIVATE_PILOT_FIXTURES`
- `CAREPOINT_PILOT_FIXTURE_EMAIL_DOMAIN=<controlled-test-domain>`
- `CAREPOINT_PILOT_FIXTURE_PASSWORD=<restricted-value-at-least-16-characters>`

It creates Patient A/B, Doctor A/B, Other Provider A/B and Admin A using synthetic credentials and zero-price clinic/home-visit services. Existing matching users are preserved and role conflicts fail closed. The command never prints passwords or database identifiers.

## 8. Deployment sequence

1. Freeze the reviewed pilot source SHA and immutable API/Admin digests.
2. Confirm all protected CI/security/container/release checks are green.
3. Record the currently deployed version and rollback target.
4. Confirm edge allowlist, pilot owner and stop-pilot authority.
5. Provision isolated authenticated PostgreSQL and Redis with pilot-only names/networking.
6. Create restricted pilot storage roots and deployment secrets/configuration.
7. Capture and checksum the pre-pilot logical database snapshot.
8. Apply migrations and create synthetic fixtures.
9. Deploy the exact immutable API/Admin artifacts by digest.
10. Verify health/readiness returns the expected SHA, digest, infrastructure profile and healthy PostgreSQL/Redis dependencies.
11. Execute the smoke matrix below.
12. Open the pilot only to the named tester allowlist.

Do not replace or restart an unrelated existing CarePoint runtime while preparing this pilot.

## 9. Minimum smoke matrix

| ID | Journey | Required result |
| --- | --- | --- |
| PILOT-SMOKE-001 | Edge deny | Unlisted identity cannot reach application login. |
| PILOT-SMOKE-002 | Release identity | Health/readiness identify exact SHA, digest and `isolated-synthetic` profile. |
| PILOT-SMOKE-003 | Admin MFA | Admin A completes required MFA and sees only authorized operations. |
| PILOT-SMOKE-004 | Public registration | Patient registration is unavailable and creates no account. |
| PILOT-SMOKE-005 | Discovery and booking | Patient A finds synthetic clinic/home service and books once without double booking. |
| PILOT-SMOKE-006 | Clinical isolation | Patient A and Doctor A cannot access Patient B/Doctor B restricted data without authority. |
| PILOT-SMOKE-007 | Provider operations | Doctor A and Other Provider A see only their assigned synthetic work. |
| PILOT-SMOKE-008 | Notifications | In-app/synthetic notification path works without external delivery. |
| PILOT-SMOKE-009 | Disabled routes | Payment, claims, telehealth, emergency and public SMART/FHIR route families are unavailable. |
| PILOT-SMOKE-010 | Admin indexing | Admin response carries the no-index header. |
| PILOT-SMOKE-011 | Logout/session | Logout revokes the session; refresh/reuse does not restore it. |
| PILOT-SMOKE-012 | Rollback readiness | Previous artifact and stop-pilot procedure are immediately available. |

Record PASS/FAIL, tester, time, exact SHA, sanitized correlation/evidence reference and defect reference. Do not put passwords, tokens, PHI, tester emails or private infrastructure details in GitHub.

## 10. Stop-pilot and rollback

Immediately stop new access when any patient-safety, cross-account authorization, privacy, financial-integrity, data-loss or Critical/High security signal appears.

1. Disable the edge allowlist policy or remove all non-owner pilot identities.
2. Preserve logs and sanitized correlation references.
3. Stop background jobs that could create external side effects.
4. Roll back to the previously recorded immutable artifact if the failure is application-related.
5. If data integrity is uncertain, isolate the environment and restore the pre-pilot logical snapshot to a separate validation target before destructive action.
6. Open a restricted incident record and link only sanitized references from GitHub.

The pilot may reopen only after the blocking defect is fixed, retested on the exact candidate and accepted by the pilot owner plus the relevant security/clinical owner.

## 11. Ready decision

Declare the pilot READY only when all twelve smoke cases pass, the edge allowlist is proven, synthetic fixtures exist, pre-pilot snapshot and rollback target are recorded, restricted local pilot controls are active, a defect channel is active, and named support/stop-pilot ownership is documented.

This profile is never evidence that public-production KMS/S3/SIEM/OTLP/SMART, HA/PITR, external-provider, signed-mobile, regulatory or CAB gates are complete. Until those independent gates are accepted, Release 1 public Go-Live remains **NO-GO**.
