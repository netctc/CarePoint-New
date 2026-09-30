# Slice 9 - Production Security, Resilience and Observability

## Purpose

Slice 9 hardens the Release 1 platform around authentication, encryption-key management, abuse controls, operational readiness, request correlation and mobile credential persistence.

This slice does not change the CarePoint domain boundaries introduced by earlier slices. Patient, Doctor and Other Provider remain independent application and authorization domains, and Emergency Ambulance remains outside ordinary appointment booking.

## 1. Production envelope-key management

Sensitive envelope-encryption domains now share a reusable AWS KMS key provider while retaining a distinct AWS KMS `EncryptionContext` for each domain.

Covered domains:

- MFA secrets;
- clinical records;
- clinical orders;
- secure messaging;
- telehealth session E2EE key material;
- clinical document metadata/content envelopes.

Local static AES-KW KEKs remain available only for development/test. They are rejected when `NODE_ENV=production`.

Typical production configuration uses:

```text
MFA_KEY_PROVIDER=aws-kms
MFA_KMS_KEY_ID=<kms-key-id-or-arn>

CLINICAL_KEY_PROVIDER=aws-kms
CLINICAL_KMS_KEY_ID=<kms-key-id-or-arn>

ORDER_KEY_PROVIDER=aws-kms
ORDER_KMS_KEY_ID=<kms-key-id-or-arn>

MESSAGING_KEY_PROVIDER=aws-kms
MESSAGING_KMS_KEY_ID=<kms-key-id-or-arn>

TELEHEALTH_KEY_PROVIDER=aws-kms
TELEHEALTH_KMS_KEY_ID=<kms-key-id-or-arn>

DOCUMENT_KEY_PROVIDER=aws-kms
DOCUMENT_KMS_KEY_ID=<kms-key-id-or-arn>

AWS_REGION=<region>
```

`AWS_ENDPOINT_URL_KMS` remains available for compatible private/test KMS endpoints where required.

### Deployment boundary

CI validates the common envelope abstraction and all application flows with local test KEKs. CI does **not** possess production AWS credentials and therefore does not prove a live production KMS policy, IAM role, network path or key rotation configuration. Those must be validated in the deployment environment.

## 2. Authentication race and replay protection

### Refresh token rotation

Refresh tokens are single-use.

Rotation is performed with a conditional database mutation inside the same transaction that creates the replacement session. Concurrent requests using the same refresh token therefore cannot both succeed.

Expected behavior:

```text
refresh token R1
  -> exactly one request consumes R1
  -> replacement session issues R2
  -> concurrent/replayed use of R1 is denied
  -> replay attempt is audited
```

### MFA login challenges

MFA login challenges use the same single-consumer principle. A valid challenge can create at most one authenticated session even when two verification requests race concurrently.

Rejected replay attempts are audited without storing the presented token or MFA code.

## 3. Distributed abuse controls

Sensitive public IAM endpoints use a Redis-backed distributed limiter.

Protected surfaces include:

- patient registration;
- password login;
- MFA verification;
- session refresh.

Characteristics:

- atomic counter/expiry operation in Redis;
- distinct namespaces for IP and subject controls;
- account/challenge/refresh identities are hashed before becoming Redis keys;
- raw email addresses, refresh tokens and MFA challenge material are not stored in Redis keys;
- production requires Redis instead of silently falling back to a process-local limiter;
- development/test can use an explicit local fallback where appropriate.

Emergency Ambulance is intentionally not coupled to these IAM request-rate ceilings.

## 4. HTTP boundary hardening

The API bootstrap now applies a hardened HTTP boundary including:

- explicit CORS allow-list;
- security headers through Helmet;
- request-body size limits;
- configurable proxy trust rather than implicit forwarded-header trust;
- request correlation IDs.

The API never logs request bodies, authorization headers, query payloads or clinical content as part of the request telemetry introduced in this slice.

## 5. Liveness and readiness

`GET /api/v1/health` remains the lightweight process liveness endpoint.

`GET /api/v1/health/ready` is the dependency readiness endpoint and verifies that the API can reach:

- PostgreSQL;
- Redis.

This distinction allows orchestration platforms to keep a live process running while withholding traffic when required dependencies are unavailable.

## 6. PHI-safe operational request telemetry

Each HTTP request receives or propagates an `X-Request-Id`.

Structured request-completion telemetry includes only operational metadata such as:

- request ID;
- method;
- route/path;
- status code;
- duration.

Bodies, tokens and PHI are excluded.

This is a SIEM/trace-friendly baseline. Full OpenTelemetry trace/metric export remains a later deployment/observability integration and is not claimed as complete by Slice 9.

## 7. Session inventory and cleanup

Authenticated users can list their own session inventory without receiving access-token or refresh-token hashes.

Exposed metadata is limited to operational/session information such as session ID, creation/expiry state and available device/network metadata.

Existing session-revocation endpoints remain the authoritative way to close an individual session or all sessions.

A cleanup command removes expired/old authentication sessions and MFA challenges according to configurable retention rules. The command is idempotent and does not remove active sessions.

### Deployment boundary

The repository provides the cleanup command, but the production scheduler (CronJob, systemd timer, ECS scheduled task, Kubernetes CronJob or equivalent) must be configured by the deployment environment.

## 8. Mobile secure credential persistence

`packages/mobile_core` now uses `flutter_secure_storage` behind the `CarePointTokenStore` abstraction.

Behavior:

- successful password login persists access + refresh credentials;
- successful MFA login persists access + refresh credentials;
- refresh rotation persists the new single-use refresh token before the new access token, leaving a recoverable state if platform storage fails between writes;
- app startup attempts to restore the persisted session;
- an expired access token can be recovered through the normal refresh flow;
- invalid/replayed credentials are cleared;
- logout clears memory and secure platform storage;
- a restored session whose role does not match the current app is cleared instead of opening the wrong application domain.

Tests use `MemoryCarePointTokenStore`; production applications use `SecureCarePointTokenStore`.

### Native runner requirements

The current repository intentionally contains Flutter application source (`lib/` and `pubspec.yaml`) but does not yet version generated Android/iOS/macOS runner projects.

When native runners are generated for release builds:

- Android must target a minimum supported SDK compatible with `flutter_secure_storage` 10.x (API 23 or newer);
- iOS/macOS runners must configure the required Keychain Sharing entitlement;
- release signing, backup behavior, device-policy and platform secure-storage behavior must be verified on real release builds.

Therefore Slice 9 validates the Dart/mobile security boundary and widget/client behavior, but does not claim signed native-store production builds are already complete.

## 9. CI acceptance

The Slice 9 Node/PostgreSQL acceptance includes:

1. PostgreSQL and Redis readiness;
2. security/correlation headers;
3. concurrent refresh-token race with exactly one winner;
4. replay denial and audit evidence;
5. Redis-backed `429` enforcement;
6. authentication cleanup without deleting the active session;
7. regression execution of Slice 1 through Slice 8 smoke flows.

The Flutter gate includes:

- shared mobile package dependency resolution;
- analyzer;
- mobile client tests;
- secure token persistence/rotation/restore tests;
- login-gate role-boundary widget tests;
- Patient app analyzer;
- Doctor app analyzer;
- Other Provider app analyzer.

## 10. Remaining production work

Slice 9 deliberately does not claim completion of the following deployment-level work:

- live AWS KMS IAM/policy/key-rotation validation;
- production Redis topology, authentication, TLS, persistence and failover validation;
- full OpenTelemetry collector/export integration;
- load/chaos testing against the final production infrastructure;
- native Android/iOS/macOS runner generation, signing and secure-storage entitlement validation;
- end-user security notifications for newly observed/revoked sessions;
- infrastructure scheduling of the authentication cleanup command.

These boundaries should remain explicit in release-readiness reviews.
