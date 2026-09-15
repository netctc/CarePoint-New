# Phase B1 — Admin Authentication & Secure API Foundation

## Objective

Turn the existing Clinical Aurora Admin Web shell into an authenticated CarePoint administration surface without exposing CarePoint bearer tokens to browser JavaScript.

This phase is deliberately limited to the authentication/session boundary. Operational dashboard data, provider review actions and account governance are wired in later Phase B increments after this security prerequisite is merged.

## Architecture

```text
Browser
  |
  | same-origin credentials / MFA code only
  v
Next.js Admin Web BFF (port 3000)
  |  HttpOnly + SameSite=Strict cookies
  |  server-side bearer handling only
  v
CarePoint API /api/v1/iam (port 4000)
  |
  +--> PostgreSQL AuthSession / User / MFA state
  +--> Redis distributed rate limits
  +--> AuditEvent
```

### Trust boundary

The browser never receives `accessToken` or `refreshToken` in JSON and the Admin Web does not use `localStorage`, `sessionStorage`, URL parameters or client-readable cookies for bearer material.

CarePoint API session tokens are stored by the Next.js BFF in three HttpOnly cookies:

- `carepoint_admin_access` — short-lived API access token.
- `carepoint_admin_refresh` — rotating refresh token.
- `carepoint_admin_session` — current CarePoint session identifier used for explicit logout revocation.

All three cookies use `SameSite=Strict`, `Path=/`, and `Secure` in production.

## Authentication flows

### Password sign-in

1. Browser posts email/password to `POST /api/admin/auth/login` on the Admin origin.
2. The BFF calls `POST /api/v1/iam/login` server-side.
3. If CarePoint requires MFA, the browser receives only the MFA challenge identifier and expiry.
4. If CarePoint issues tokens, the BFF immediately calls `GET /api/v1/iam/accounts/me` with the access token.
5. Access is accepted only when the account is `role=ADMIN` and `status=ACTIVE`.
6. A token set issued to any other role is revoked before the BFF returns HTTP 403.
7. Valid ADMIN token material is written only to hardened HttpOnly cookies; the JSON response contains sanitized account identity only.

### MFA verification

1. Browser posts the six-digit code plus challenge ID to `POST /api/admin/auth/mfa`.
2. The BFF completes `POST /api/v1/iam/mfa/verify` server-side.
3. The newly issued access token is re-validated through `/iam/accounts/me` and must still resolve to an active ADMIN.
4. Only then are Admin Web session cookies established.

### Route protection

Next.js `proxy.ts` protects the current privileged Admin routes:

- `/`
- `/providers/**`
- `/doctors/**`
- `/appointments/**`
- `/security/**`

Every protected navigation validates the short-lived access token against CarePoint. If it has expired and a refresh cookie exists, the proxy rotates the CarePoint session server-side and attaches the replacement cookies to the response. Invalid, expired, replayed, suspended or non-admin sessions are cleared and redirected to `/login`.

The login page and authentication BFF routes are intentionally outside the protected matcher.

### Explicit refresh

`POST /api/admin/auth/refresh` performs the same CarePoint refresh-token rotation and role validation for same-origin callers. `GET /api/admin/auth/session` transparently refreshes when needed and returns only the sanitized ADMIN account.

### Logout

`POST /api/admin/auth/logout` revokes the current CarePoint backend session when possible, including a refresh-and-revoke fallback for an expired access token, then clears every Admin Web authentication cookie. Browser logout is fail-closed even if the backend is temporarily unavailable.

## Security controls

- CarePoint IAM remains the source of truth for passwords, account status, lockout, MFA, refresh replay detection and authorization.
- Existing API login/MFA/refresh rate limits remain in force because all BFF flows call those endpoints.
- Same-origin checks are applied to state-changing Admin authentication routes when the browser sends an `Origin` header.
- `SameSite=Strict` cookies provide an additional CSRF boundary.
- Authentication responses use `Cache-Control: private, no-store` and `Pragma: no-cache`.
- Passwords and MFA codes are accepted only by same-origin BFF endpoints and are not persisted by the Admin Web.
- A Patient, Doctor, Other Provider or Support session is not accepted as an Admin Web session.
- Non-admin token sets accidentally issued during a portal login attempt are immediately revoked.
- The existing CarePoint database stores only token hashes; this phase adds no new plaintext token persistence.
- No database migration is required.

## UX

The Admin Web now includes a dedicated Clinical Aurora login surface with EN/AR/FR/ES language support and RTL behavior for Arabic. The existing shell displays the authenticated administrator email and provides an explicit sign-out action instead of a hard-coded operator identity.

## CI acceptance

The Phase B1 smoke test starts both the CarePoint API and the production-built Next.js Admin Web and verifies:

- anonymous protected routes redirect to login;
- the login page is public;
- a Patient account receives HTTP 403 and its newly issued portal-login session is revoked;
- active ADMIN login succeeds;
- bearer tokens are absent from browser JSON responses;
- Admin cookies are HttpOnly and `SameSite=Strict`;
- authenticated route access succeeds;
- forced access-token expiry triggers transparent refresh rotation;
- the prior backend session is revoked and linked to the replacement;
- MFA enrollment causes Admin login to return a challenge without cookies;
- the BFF MFA verification flow establishes a valid Admin session;
- logout revokes the backend session, clears cookies and restores the protected-route redirect.

The existing Node/API regression suite and all Flutter application analysis/tests continue to run in the same CI workflow.

## Out of scope for B1

- live dashboard KPIs and queues;
- provider/doctor credential review UI;
- account creation/suspension workflows;
- audit search/filter/export UI;
- scheduling or financial operations through Admin Web;
- new IAM roles or permission semantics;
- database schema changes.

These are intentionally deferred so later Admin Web slices build on a tested, revocable authentication boundary.
