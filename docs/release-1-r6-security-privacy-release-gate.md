# Release 1 — R6 Security and Privacy Release Gate

## 1. Purpose

R6 is the Release 1 security/privacy Go/No-Go workstream. It evaluates the canonical Release 1 candidate as a complete system rather than treating secure source code as equivalent to production security.

Canonical branch:

`release/release-1-integration-go-live-readiness`

R6 starting baseline:

`876c23a7badb997139b0f46af1fbcd4ca665a5fd`

R6 tracker: #82

Dedicated P0 blockers created by this review:

- #83 — privileged-role MFA enforcement;
- #84 — Release 1/main promotion-path protection and mandatory checks;
- #85 — formal threat model plus penetration/adversarial acceptance.

R6 also depends on existing Release 1 blockers #77 (residency/retention/deletion), #79 (production infrastructure/security evidence) and #81 (mobile native privacy/security evidence).

## 2. Status summary

| Security area | Source-level status | Release status |
| --- | --- | --- |
| Password/authentication primitives | Strong | CONDITIONAL |
| Sessions/refresh replay controls | Strong | CONDITIONAL |
| MFA implementation | Implemented | BLOCKED — privileged policy not enforced (#83) |
| Route authorization | Strong deny-by-default foundation | CONDITIONAL |
| Clinical/document object access | Strong sampled ownership/relationship/consent checks | CONDITIONAL — adversarial BOLA/IDOR test required |
| Clinical/document encryption | Strong envelope-encryption foundation | CONDITIONAL on real KMS/storage evidence (#79) |
| Admin browser session handling | Strong source controls | CONDITIONAL on deployment evidence (#79) |
| Audit/SIEM minimization | Strong source controls | CONDITIONAL on real SIEM delivery (#79) |
| Static security / secret scanning | Implemented | CONDITIONAL — rerun on exact RC SHA |
| Dependency security | Implemented in CI | CONDITIONAL — rerun on exact RC SHA |
| Mobile token storage | Implemented in shared Flutter code | BLOCKED on native evidence (#81) |
| Repository promotion controls | Not enforced on current branches | BLOCKED (#84) |
| Threat model / penetration evidence | Not identified in Release 1 tree | BLOCKED (#85) |

Overall R6 status: **BLOCKED / IN PROGRESS**.

No source-review statement in this document is a security certification or penetration-test result.

## 3. Authentication and session review

Primary evidence reviewed:

- `packages/identity/src/crypto.ts`
- `services/api/src/security/persistent-auth.service.ts`
- `services/api/src/modules/iam/iam.module.ts`
- `apps/admin/lib/admin-auth.ts`

### Existing controls

The current persistent authentication path provides:

- minimum 12-character passwords;
- salted `scrypt` password hashing;
- timing-safe password verification;
- random opaque access and refresh tokens;
- server-side token hashes rather than raw persisted tokens;
- 15-minute access-token lifetime;
- 30-day refresh lifetime;
- transactional single-use refresh-token rotation;
- replay/concurrent-replay denial and audit;
- account status checking;
- failed-login counting and temporary account lockout;
- distributed IP/account/challenge/token rate limiting through the IAM controller;
- TOTP MFA;
- encrypted persistent MFA secrets;
- expiring MFA login challenges;
- atomic one-time MFA challenge consumption;
- session enumeration/revocation and revoke-all controls.

### Release blocker: privileged MFA policy

The implementation only challenges for MFA when the account already has an enabled MFA enrollment. A valid account without enabled MFA receives a normal session after password validation.

The IAM endpoints allow an authenticated user to inspect/enroll/confirm MFA, but this does not create a server-side production requirement by role.

R6 therefore created #83. Release 1 must establish and enforce a privileged-role MFA policy. ADMIN must not retain unrestricted password-only production access; SUPPORT follows the same requirement if enabled. DOCTOR/OTHER_PROVIDER policy must be explicitly approved and implemented rather than assumed.

The enrollment/bootstrap/recovery design must not solve this by issuing a reusable unrestricted privileged session before MFA is established.

## 4. Authorization and BOLA/IDOR review

Primary evidence reviewed:

- `packages/identity/src/authorization.ts`
- `services/api/src/security/api-security.module.ts`
- `services/api/src/modules/clinical/clinical.service.ts`
- `services/api/src/modules/documents/documents.service.ts`

### Existing controls

The API uses a global guard. Routes require a bearer token unless explicitly marked public. Permissions are centralized by identity role. SMART tokens are separately constrained and are rejected on non-FHIR routes unless the route carries the required SMART metadata.

The sampled clinical record flow performs object-level checks in addition to route permission checks. Clinical access can be based on:

- patient self-access;
- own authorship;
- a bounded treatment relationship;
- explicit compatible patient consent.

Clinical write/finalize operations check the provider relationship to the appointment. Denied clinical reads are audited.

The sampled document flow likewise checks patient ownership, authoring provider, treatment/consent basis and encounter/provider consistency. Document release/finalization/removal operations contain object ownership checks rather than trusting only the document ID supplied by the caller.

These are positive security indicators, but reviewing representative source paths cannot establish that every endpoint is free from BOLA/IDOR. R6 requires systematic cross-account/cross-patient/cross-provider negative testing and final penetration/adversarial testing under #85.

## 5. Clinical data protection and integrity

Primary evidence reviewed includes clinical/document services plus the existing Phase C production-hardening controls.

The current clinical path stores encrypted envelopes and rejects unsupported clinical-record encryption algorithms; the expected envelope algorithm is AES-256-GCM. Clinical documents use encrypted metadata/blob envelopes, private-storage controls and SHA-256 content-integrity verification before decrypted content is returned.

This is a strong source-level foundation. R6 does not mark encryption READY until R3 #79 proves the production key provider, KMS IAM, rotation, private object-storage policy, region/residency and runtime secret delivery in the actual production/staging-equivalent environment.

Data lifecycle controls remain separately blocked by #77.

## 6. Admin browser/session security

Primary evidence:

`apps/admin/lib/admin-auth.ts`

Current source controls include:

- revalidation that an issued admin session belongs to an ACTIVE ADMIN account;
- HttpOnly cookies;
- `SameSite=Strict` cookies;
- `Secure` cookies in production;
- safe relative return-path handling;
- no-store authentication responses;
- same-origin helper logic;
- bounded backend response handling;
- the retained R1 browser-origin and backend-egress policies.

R6 still requires production proxy/TLS/origin evidence through #79. Source logic cannot prove that external TLS termination, forwarded headers, DNS, reverse proxy and browser origins are configured correctly at deployment time.

## 7. Audit, SIEM and PHI minimization

Primary evidence:

- `services/api/src/infrastructure/audit/audit.service.ts`
- `services/api/src/infrastructure/siem/siem-event-presenter.service.ts`

The audit service transactionally stores audit events and enqueues SIEM delivery when enabled; production forces SIEM export on.

The SIEM presenter does not forward arbitrary audit metadata. It creates pseudonymous event/account/session references and emits an allowlisted set of indicators such as role, HTTP method, MFA state and replay/lockout flags. Unknown object identifiers are not automatically exported as target identifiers.

This reduces PHI exposure at the SIEM boundary. Real delivery, alerting, retention and failure handling remain production-environment evidence under #79, while lifecycle/residency policy remains #77.

## 8. Source, dependency and supply-chain security

Primary evidence:

- `docs/phase-c10-static-security-gate.md`
- `.ci/repository-security-scan.mjs`
- `.github/workflows/security-analysis.yml`
- `.github/workflows/ci.yml`

The repository has two source-security layers:

1. a deterministic repository scanner for high-confidence secret leaks, tracked secret environment files and selected prohibited runtime constructs;
2. GitHub CodeQL JavaScript/TypeScript SAST using `security-extended` queries.

The Security Analysis workflow also uses immutable action SHAs and least-privilege workflow permissions. Existing CI performs dependency lock verification and `npm audit --audit-level=high`.

The R6 starting SHA had no GitHub Actions runs recorded because the current workflows execute on pull requests and selected branch events rather than every release-branch documentation push. R6 cannot close until the exact final candidate SHA is exercised by the required CI/security/recovery gates.

## 9. Repository promotion security

At R6 review time GitHub branch metadata reports both:

- `release/release-1-integration-go-live-readiness`;
- `main`;

as unprotected, with required-status-check enforcement off.

This is a Release 1 P0 governance/security gap because successful CI is not a promotion control if an ordinary update can bypass it.

Issue #84 owns the required branch/ruleset policy. Exact required check names must be derived from the validated Release Candidate workflows rather than guessed before RC validation.

Do not merge to stale `main` in order to test branch protection.

## 10. Mobile privacy/security dependency

Primary evidence:

`packages/mobile_core/lib/carepoint_token_store.dart`

Shared Flutter code stores access/refresh tokens through `flutter_secure_storage` and clears both values on logout/session cleanup.

However, R5 #81 established that the application roots do not yet contain native Android/iOS runners. R6 therefore cannot prove Android Keystore/iOS Keychain behavior, backup exclusions, native permission privacy descriptions, application-switcher obscuring, universal/app links, push-token lifecycle or signed release binary configuration.

Mobile production privacy/security remains BLOCKED on #81.

## 11. Threat model and penetration/adversarial acceptance

The Release 1 tree review did not identify a dedicated threat-model or penetration-test evidence artifact. Issue #85 owns this P0 evidence requirement.

The threat model must reflect the actual Release 1 launch architecture and enabled providers, including trust boundaries across clients, API, PostgreSQL, Redis, object storage, KMS/secrets, SIEM/OTLP and external integrations.

Adversarial testing must cover at minimum:

- authentication/MFA/session abuse;
- privilege escalation;
- BOLA/IDOR;
- patient-consent/treatment-relationship bypass;
- clinical/document access;
- payment/claims tampering and replay;
- webhook replay and authenticity;
- telehealth token/room abuse;
- DICOM/PACS reference boundaries;
- SSRF/open redirect/provider-response abuse;
- file-upload malware/type/size/integrity cases;
- PHI/secrets leakage in errors/logs/traces/notifications/browser/mobile lifecycle;
- rate-limit and resource-exhaustion scenarios;
- repository/supply-chain/promotion abuse.

Every Critical/High release-blocking finding must be fixed and retested on the final candidate.

## 12. R6 acceptance gates

R6 is READY only when all of the following are true:

1. #83 privileged MFA policy is approved, implemented and negatively tested.
2. #84 promotion-path protection is enforced before RC promotion.
3. #85 threat model and final penetration/adversarial acceptance are complete.
4. #77 data residency/retention/deletion privacy controls are accepted.
5. #79 production KMS/storage/TLS/SIEM/secret infrastructure evidence is accepted.
6. #81 mobile native privacy/security evidence is accepted for every launch mobile application.
7. Exact-candidate dependency audit, repository scanner, CodeQL, normal CI and mandatory recovery/release workflows are green.
8. Cross-account/cross-patient/cross-provider object authorization negative tests are green.
9. No unresolved Critical/High release-blocking security finding remains.
10. Medium/Low residual findings have explicit owners, accepted treatment decisions and dates.

## 13. Security evidence handling

Do not store secrets, MFA seeds/codes, tokens, private keys, production credentials, PHI, card data or sensitive exploit payloads in GitHub issues or documents.

Sanitized GitHub evidence should contain only the environment class, exact SHA, date/time, test/control, result, owner and restricted evidence location/reference when required.

## 14. Release decision

Current R6 decision: **NO-GO / BLOCKED**.

The current codebase has a strong security foundation, but Release 1 cannot be declared security-ready while privileged MFA policy, branch/promotion controls, threat-model/penetration evidence and R3/R5/#77 production privacy dependencies remain open.

`main` remains intentionally unchanged until the Release Candidate passes the complete Go/No-Go process.