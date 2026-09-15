# CarePoint 0.9 Closed Pilot Runbook

Status: **PREPARATION / NOT YET DEPLOYED**  
Runtime baseline: `5f508d95b387507ba3ef2b8ac44af3792764205d`  
Target: invite-only staging with synthetic data, no public healthcare launch

## 1. Scope and safety boundary

The private pilot is for controlled product validation by named testers. It is not approved for real patient data, real payment cards, public registration, emergency dispatch or commercial telemedicine. The edge must enforce identity allowlisting before traffic reaches Admin or API. Application login is a second control and does not replace the edge allowlist.

The pilot starts with:

- Admin operations, providers, doctors, appointments and security views;
- Patient profile, search, clinic/home-visit booking and visit timeline;
- Doctor and Other Provider queue/snapshot/service completion where available;
- in-app/synthetic notifications only.

The pilot excludes:

- patient self-registration;
- payments, insurance and claims routes;
- telehealth and Admin telehealth routes;
- emergency ambulance routes;
- external notification delivery;
- real PHI, real cards and public indexing.

## 2. Required controlled inputs

Keep values in the deployment platform or restricted evidence store. Do not commit them.

1. Named pilot owner and stop-pilot authority.
2. Tester allowlist containing only approved identities.
3. Restricted defect-reporting channel and daily triage owner.
4. Immutable API and Admin artifact digests for the approved RC.
5. Pilot database name containing `pilot`, `staging` or `uat`.
6. Logical database snapshot reference captured immediately before fixture creation.

## 3. Runtime configuration

Add these values manually to the private pilot deployment. No `.env` file is part of this change.

| Variable | Required value | Purpose |
| --- | --- | --- |
| `NODE_ENV` | `production` | Retains production cookies, transport rules and security preflights. |
| `CAREPOINT_PRIVATE_PILOT` | `true` | Activates the constrained pilot policy. |
| `CAREPOINT_PATIENT_SELF_REGISTRATION_ENABLED` | `false` | Makes public patient registration unavailable. |
| `CAREPOINT_PAYMENTS_ENABLED` | `false` | Removes Billing, Finance and Claims API modules. |
| `CAREPOINT_TELEHEALTH_ENABLED` | `false` | Removes Telehealth and Admin Telehealth API modules. |
| `CAREPOINT_EXTERNAL_NOTIFICATIONS_ENABLED` | `false` | Skips external notification provider activation. |
| `EMERGENCY_AMBULANCE_ENABLED` | `false` | Removes emergency ambulance API modules. |
| `NOTIFICATION_GATEWAY_PROVIDER` | `mock` | Keeps notification processing synthetic/in-app. |
| `CAREPOINT_RELEASE_VERSION` | `0.9-closed-pilot.1` | Pilot runtime identity. |
| `CAREPOINT_RELEASE_SHA` | exact deployed source SHA | Must match the artifact source. |
| `CAREPOINT_RELEASE_SOURCE_REF` | pilot branch/ref | Sanitized runtime correlation only. |
| `CAREPOINT_RELEASE_ARTIFACT_DIGEST` | immutable API digest | Must be `sha256:<64 hex>`. |

All other production security, database, Redis, KMS, object storage, observability, SIEM, CORS and secret settings remain required unless a separate accepted gate says otherwise. Disabled provider credentials are not required by the pilot runtime preflight.

## 4. Edge access control

Configure Cloudflare Access, VPN or an equivalent identity-aware allowlist for every pilot hostname. Use deny-by-default policy and add only named testers. Do not use a shared password as the only edge control.

Verify before deployment:

- an allowlisted identity reaches the application login;
- an unlisted identity is denied at the edge;
- an unauthenticated browser is denied at the edge;
- Admin responses include `X-Robots-Tag: noindex, nofollow, noarchive`;
- the site is absent from public navigation and no public self-registration link is distributed.

## 5. Database snapshot and synthetic fixtures

Capture a logical snapshot before fixture creation and retain its restricted reference. Then build the API and run the idempotent fixture command with values supplied only through the deployment secret/configuration interface:

```bash
npm ci
npm run build
npm --workspace @carepoint/api run db:deploy
npm --workspace @carepoint/api run db:bootstrap
npm --workspace @carepoint/api run db:pilot-fixtures
```

The fixture command additionally requires:

- `CAREPOINT_PILOT_FIXTURES_CONFIRM=CREATE_SYNTHETIC_PRIVATE_PILOT_FIXTURES`
- `CAREPOINT_PILOT_FIXTURE_EMAIL_DOMAIN=<controlled-test-domain>`
- `CAREPOINT_PILOT_FIXTURE_PASSWORD=<restricted-value-at-least-16-characters>`

It creates Patient A/B, Doctor A/B, Other Provider A/B and Admin A. It creates only synthetic providers, verified synthetic credentials, zero-price clinic/home-visit services and no emergency, telehealth or payment fixture. Existing matching users are preserved and role conflicts fail closed. The command never prints passwords or database identifiers.

## 6. Deployment sequence

1. Freeze the pilot source SHA and immutable API/Admin digests.
2. Record the currently deployed version and rollback target.
3. Confirm edge allowlist and stop-pilot authority.
4. Capture the pre-pilot logical database snapshot.
5. Apply migrations and create synthetic fixtures.
6. Deploy the exact immutable artifacts.
7. Verify `/api/v1/health` and `/api/v1/health/ready` return the expected release identity and healthy PostgreSQL/Redis dependencies.
8. Execute the smoke matrix below.
9. Open the pilot only to the named allowlist.
10. Record daily triage, safety signals and unresolved defects.

## 7. Minimum smoke matrix

| ID | Journey | Required result |
| --- | --- | --- |
| PILOT-SMOKE-001 | Edge deny | Unlisted identity cannot reach application login. |
| PILOT-SMOKE-002 | Release identity | Health/readiness identify the exact deployed SHA and digest. |
| PILOT-SMOKE-003 | Admin MFA | Admin A completes required MFA and sees only authorized operations. |
| PILOT-SMOKE-004 | Public registration | Patient registration returns unavailable and creates no account. |
| PILOT-SMOKE-005 | Discovery and booking | Patient A finds synthetic clinic/home service and books once without double booking. |
| PILOT-SMOKE-006 | Clinical isolation | Patient A and Doctor A cannot access Patient B/Doctor B restricted data without authority. |
| PILOT-SMOKE-007 | Provider operations | Doctor A and Other Provider A see only their assigned synthetic work. |
| PILOT-SMOKE-008 | Notifications | In-app/synthetic notification path works without external delivery. |
| PILOT-SMOKE-009 | Disabled routes | Payment, claims, telehealth and emergency route families return 404. |
| PILOT-SMOKE-010 | Admin indexing | Admin response carries the no-index header. |
| PILOT-SMOKE-011 | Logout/session | Logout revokes the session; refresh/reuse does not restore it. |
| PILOT-SMOKE-012 | Rollback readiness | Previous artifact and stop-pilot procedure are immediately available. |

Record PASS/FAIL, tester, time, exact SHA, sanitized correlation/evidence reference and defect reference. Do not put passwords, tokens, PHI, tester emails or private infrastructure details in GitHub.

## 8. Stop-pilot and rollback

Immediately stop new access when any patient-safety, cross-account authorization, privacy, financial-integrity, data-loss or Critical/High security signal appears.

1. Disable the edge allowlist policy or remove all non-owner pilot identities.
2. Preserve logs and sanitized correlation references.
3. Stop background jobs that could create external side effects.
4. Roll back to the previously recorded immutable artifact if the failure is application-related.
5. If data integrity is uncertain, isolate the environment and restore the pre-pilot logical snapshot to a separate validation target before any destructive action.
6. Open a restricted incident record and link only sanitized references from GitHub.

The pilot may reopen only after the blocking defect is fixed, retested on the exact candidate and accepted by the pilot owner plus the relevant security/clinical owner.

## 9. Ready decision

Declare the pilot READY only when all twelve smoke cases pass, the edge allowlist is proven, synthetic fixtures exist, the pre-pilot snapshot and rollback target are recorded, a defect channel is active, and named support/stop-pilot ownership is documented. Until then the environment remains closed and the Release 1 public Go-Live status remains NO-GO.
