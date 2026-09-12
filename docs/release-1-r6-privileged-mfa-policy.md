# Release 1 — R6 Privileged-Role MFA Enforcement

Status: **SOURCE CONTROL IMPLEMENTED — EXACT-SHA VALIDATION REQUIRED**  
Tracker: #83  
Canonical branch: `release/release-1-integration-go-live-readiness`

## 1. Requirement

The approved Release 1 identity requirement states that MFA must be supported for providers and administrators, while patient MFA is risk-configurable. Release 1 also treats MFA and minimum privilege as security baseline controls.

R6 previously identified a release-blocking gap: a valid account without an enabled MFA enrollment could receive a normal password-only session. This is unsafe for production privileged access because the existence of TOTP functionality does not by itself enforce use of MFA.

## 2. Production policy

CarePoint now enforces MFA in production for every currently defined privileged/provider role:

- `ADMIN`
- `SUPPORT`
- `DOCTOR`
- `OTHER_PROVIDER`

`PATIENT` remains outside this mandatory privileged-role policy; patients may still enroll MFA using the existing authenticated self-service flow and future risk policy can require it separately without weakening the provider/admin requirement.

The privileged role list is server-side and cannot be disabled by a production environment flag. `CAREPOINT_TEST_ENFORCE_PRIVILEGED_MFA=true` exists only to exercise the same production role policy in a non-production CI process.

## 3. Password login behavior

For a privileged production account:

1. password validation and lockout controls run normally;
2. if MFA is already enabled, login returns a short-lived one-time `mfa_...` challenge and no session tokens;
3. if MFA is not yet enabled, login returns a short-lived restricted `mfaenroll_...` challenge and no session tokens;
4. the restricted enrollment challenge can retrieve only the account's TOTP setup key/otpauth URI through `/iam/mfa/enrollment/start`;
5. after a valid TOTP code, the challenge is consumed atomically, the enrollment is enabled and an MFA-assured session is created;
6. replay or concurrent reuse of the challenge is denied.

No unrestricted access or refresh token exists before successful MFA verification.

## 4. Safe first-enrollment / bootstrap

This design avoids a first-admin lockout without creating a broad enrollment bypass. A bootstrap administrator may authenticate with the bootstrap password, but production returns only the restricted enrollment challenge until TOTP setup and verification succeed.

The Admin Web login flow detects this challenge, obtains the one-time setup secret server-to-server, displays it only on the no-store authentication page and accepts the generated six-digit code. Only after verification are the existing secure HttpOnly/SameSite admin cookies issued.

Doctor and Other Provider mobile login uses the same restricted challenge. The mobile login gate displays the setup key transiently and then completes the normal MFA verification endpoint. The secret is not persisted by the mobile client or sent to logs.

## 5. MFA-assured session marker and existing-session protection

CarePoint session IDs are opaque server-generated identifiers. New sessions created only after successful MFA verification use the internal `sesmfa_...` assurance prefix; password-only sessions use `ses_...`.

For a role covered by the production MFA policy, both access-token validation and refresh require:

- an MFA-assured server-created session ID; and
- a currently enabled MFA enrollment.

This means a password-only privileged session created before policy activation is denied and revoked after the policy becomes active. It also means resetting/disabling a privileged account's MFA enrollment invalidates its existing access and refresh paths. A new verified login is required.

The prefix is not an authorization credential by itself: the access/refresh token must still match the hashed server-side token for that stored session. Clients cannot change a stored session ID by altering a bearer token.

## 6. Audit and privacy

Release 1 audits:

- MFA policy enrollment requirement;
- enrollment challenge issuance/start;
- MFA enablement;
- MFA challenge verification;
- replay denial;
- privileged session denial after policy/enrollment mismatch.

TOTP setup secrets and verification codes are never written into audit metadata.

## 7. CI acceptance

CI launches a second API process using the same built candidate and database with `CAREPOINT_TEST_ENFORCE_PRIVILEGED_MFA=true`. `r6-privileged-mfa-policy-smoke.mjs` proves:

1. Patient password login remains outside the mandatory privileged role policy.
2. ADMIN, SUPPORT, DOCTOR and OTHER_PROVIDER cannot obtain password-only sessions.
3. Restricted first-enrollment creates no unrestricted session before TOTP verification.
4. Successful TOTP verification creates an MFA-assured session.
5. Concurrent challenge verification permits exactly one winner and denies replay.
6. Disabling/resetting enrollment revokes subsequent privileged access and refresh.
7. A legacy password-only privileged session created by the ordinary test API is rejected and revoked by the production-policy API.
8. Audit events contain policy/replay evidence without TOTP secret leakage.

The normal CI API remains in ordinary `NODE_ENV=test` mode so existing non-production smoke suites continue to exercise their established paths independently.

## 8. Remaining release evidence

Source implementation and CI acceptance can close the software defect in #83 only after the exact SHA passes CI, Security Analysis, PostgreSQL Recovery and Slice 10 FHIR. R6 itself remains blocked by the other release-gate dependencies, especially branch protection #84, threat model/pentest #85, native mobile evidence #81 and production environment evidence #79.
