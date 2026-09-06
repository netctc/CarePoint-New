# Slice 1.1 - Production IAM Persistence and Authorization

This slice replaces the Slice 1 in-memory IAM/governance runtime with PostgreSQL/Prisma-backed services and introduces default-deny API authentication and authorization.

## Security model

Engineering identifiers remain English. User interfaces remain EN/AR/FR/ES with Arabic RTL.

### Authentication

- Opaque bearer access tokens; only SHA-256 token hashes are stored.
- Access token lifetime: 15 minutes.
- Refresh token lifetime: 30 days.
- Refresh rotation creates a new session and revokes the previous session in one database transaction.
- Session revocation is persisted and effective across API replicas.
- Five failed password attempts apply a temporary 15-minute lockout.
- Suspended accounts cannot authenticate and their active sessions are revoked.

### MFA

- TOTP login challenges are persisted in `AuthChallenge`, making the flow safe for horizontally scaled stateless API replicas.
- MFA secrets are stored as AES-256-GCM encrypted envelopes (`version`, `algorithm`, `keyId`, `wrappedKey`, `iv`, `secretCiphertext`).
- Local/test environments use a static AES-KW adapter only when explicitly configured.
- Production deliberately rejects the local adapter. A deployment-specific KMS/HSM `KeyEncryptionKeyProvider` must be wired before production MFA is enabled.

### RBAC + ABAC

The API has a global bearer-token guard. Routes are protected unless marked `@Public()`.

Stable permissions currently include:

- `IAM_MANAGE_ACCOUNTS`
- `IAM_READ_AUDIT`
- `PROVIDER_REVIEW`
- `PROVIDER_SELF_ONBOARD`
- `PATIENT_MANAGE_CONSENT`
- `CATALOG_MANAGE`
- `EMERGENCY_REQUEST`
- `SELF_SESSION_MANAGE`

ABAC ownership rules are enforced inside services as a second boundary:

- users can manage only their own sessions unless they have account-management permission;
- doctors and Other Providers can modify only their own onboarding;
- patients can grant/revoke only their own consent;
- emergency ambulance requests derive the patient from the authenticated account instead of trusting `patientId` from the request body;
- provider review/approval/suspension requires the provider-review permission.

Denied authorization checks emit structured audit events when an authenticated actor exists.

## Public endpoints

- `GET /api/v1/health`
- `GET /api/v1/doctors/specialties`
- `GET /api/v1/other-provider-categories`
- `POST /api/v1/iam/register/patient`
- `POST /api/v1/iam/login`
- `POST /api/v1/iam/mfa/verify`
- `POST /api/v1/iam/sessions/refresh`

Everything else is protected by the global guard.

## PostgreSQL lifecycle

The repository now includes an explicit baseline migration at:

`services/api/prisma/migrations/20260906193000_initial_platform/migration.sql`

Fresh environment workflow:

```bash
npm install
npm run build
npm run db:deploy
npm run db:bootstrap
npm run dev:api
```

`db:bootstrap` seeds the initial medical specialties and non-doctor provider categories in EN/AR/FR/ES. It can also create the first ADMIN account when `BOOTSTRAP_ADMIN_EMAIL` and `BOOTSTRAP_ADMIN_PASSWORD` are supplied. It refuses to overwrite an existing admin account.

## Provider boundaries preserved

- `DOCTOR` onboarding requires a Doctor account plus an active medical specialty.
- `OTHER_PROVIDER` onboarding requires an Other Provider account plus an active non-doctor category.
- Doctors cannot enter Other Provider onboarding.
- Required credential types are validated at submission.
- Every credential must be `VERIFIED` before activation.
- Doctor activation materializes `DoctorProfile` + `DoctorSpecialty`.
- Other Provider activation materializes `OtherProviderProfile`.
- Suspending a provider revokes all active account sessions.

## CI validation

The Node CI job now runs a real PostgreSQL 16 service, builds the monorepo, executes tests, deploys the baseline migration, bootstraps reference data/admin, starts the API, registers a patient, logs in, verifies an authenticated `/iam/accounts/me` request, and confirms the same endpoint returns HTTP 401 without a bearer token.

## Remaining production-hardening items

1. Implement the selected cloud KMS/HSM adapter and key rotation runbook.
2. Add Redis-backed rate limiting and abuse controls around login/MFA/emergency endpoints.
3. Add database cleanup jobs for expired challenges and sessions.
4. Add integration tests for concurrent refresh-token replay and credential review races.
5. Add request validation DTOs/pipes and security headers/rate limits at gateway level.
6. Add device/session inventory UI and security notification delivery.
