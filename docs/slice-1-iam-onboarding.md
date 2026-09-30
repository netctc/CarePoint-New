# Slice 1 - Identity, MFA, Provider Onboarding, Consent and Audit

This slice moves CarePoint Next from a static foundation into executable security and governance workflows.

## Identity and authentication

- English-only canonical domain/API identifiers.
- Passwords hashed with `scrypt` and random per-password salt.
- Minimum password length: 12 characters in the current baseline.
- Opaque access tokens and refresh tokens are stored only as SHA-256 hashes in persistence.
- Access token lifetime: 15 minutes.
- Refresh token lifetime: 30 days.
- Refresh rotates the session and revokes the previous session.
- Sessions can be individually revoked or revoked for an entire account.
- Five failed password attempts trigger a temporary 15-minute lockout.

## MFA

- TOTP (RFC 6238-compatible 6-digit / 30-second behavior) is implemented in the domain package.
- Enrollment exposes an `otpauth://` URI for authenticator applications.
- Login with MFA enabled returns a short-lived challenge instead of session tokens.
- Production persistence stores the MFA secret as an encrypted envelope, never plaintext.

## Provider onboarding

Doctor and Other Provider onboarding are intentionally separate entry points.

- Doctor onboarding requires a `DOCTOR` account and a medical specialty.
- Other Provider onboarding requires an `OTHER_PROVIDER` account and a non-doctor provider category.
- A Doctor account cannot be submitted through Other Provider onboarding.
- Credentials move through `PENDING`, `VERIFIED`, or `REJECTED`.
- Provider approval is blocked until every submitted credential is verified.
- Approval activates provider access; suspension revokes provider sessions.

## Consent and audit

- Patients can grant scoped, versioned consent for provider access.
- Consent can be revoked and becomes immediately distinguishable from granted consent.
- Security and governance mutations append structured audit records.

## API endpoints introduced

- `POST /api/v1/iam/accounts`
- `GET /api/v1/iam/accounts/:accountId`
- `POST /api/v1/iam/login`
- `POST /api/v1/iam/mfa/:accountId/enroll`
- `POST /api/v1/iam/mfa/:accountId/confirm`
- `POST /api/v1/iam/mfa/verify`
- `POST /api/v1/iam/sessions/refresh`
- `DELETE /api/v1/iam/sessions/:sessionId`
- `POST /api/v1/iam/accounts/:accountId/revoke-all-sessions`
- `GET /api/v1/onboarding`
- `POST /api/v1/onboarding/doctors`
- `POST /api/v1/onboarding/other-providers`
- `POST /api/v1/onboarding/:onboardingId/credentials`
- `POST /api/v1/onboarding/:onboardingId/submit`
- `POST /api/v1/onboarding/:onboardingId/credentials/:credentialId/review`
- `POST /api/v1/onboarding/:onboardingId/approve`
- `GET /api/v1/onboarding/provider-access/:accountId`
- `POST /api/v1/onboarding/provider-access/:accountId/suspend`
- `POST /api/v1/consents`
- `GET /api/v1/consents/patient/:patientId`
- `POST /api/v1/consents/:consentId/revoke`
- `GET /api/v1/audit`

## Persistence boundary

The domain core remains persistence-agnostic. Prisma now contains the target PostgreSQL models for sessions, MFA enrollment, provider onboarding, onboarding credential review and consent state. A repository adapter will replace the current in-memory runtime store before production deployment.

This separation is intentional: security/business rules are testable without NestJS or Prisma, while infrastructure adapters can evolve independently.

## Validation

The identity domain is covered by direct Node tests for:

1. Doctor vs Other Provider separation.
2. TOTP MFA challenge + revocable sessions.
3. Refresh-token rotation.
4. Credential verification before provider activation.
5. Consent grant/revoke audit trail.
