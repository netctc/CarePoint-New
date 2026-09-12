# Release 1 — R6 Threat Model

Status: **DRAFT COMPLETE / APPROVAL AND PRODUCTION-EQUIVALENT PENETRATION TEST PENDING**  
Owner workstream: R6 #82  
Security blocker: #85  
Canonical branch: `release/release-1-integration-go-live-readiness`

## 1. Purpose and scope

This threat model defines the Release 1 security boundaries, assets, abuse cases, existing controls, residual risks and required evidence for the CarePoint launch candidate. It is a release-engineering/security artifact, not a legal, privacy, regulatory, clinical-safety or penetration-test certification.

The model covers the Release 1 application paths implemented in the canonical branch: Patient, Doctor, Other Provider and Admin clients; IAM and sessions; scheduling/booking; clinical records; clinical documents/diagnostics; telemedicine; billing/payments/insurance/claims; secure messaging and notifications; transport/emergency workflows; audit/SIEM/observability; PostgreSQL, Redis, object storage, KMS/secrets; external providers; CI and promotion controls.

FHIR/SMART/national interoperability paths remain subject to the release-scope decisions recorded by R2/R4. A disabled/deferred integration is not treated as an active production trust boundary until it is promoted into launch scope.

## 2. Security objectives

Release 1 must preserve all of the following:

- confidentiality of PHI, credentials, tokens, payment references and other sensitive data;
- integrity of clinical, consent, booking, financial, audit and release state;
- object-level authorization between different patients and providers;
- explicit treatment-relationship/consent boundaries for clinical access;
- replay-safe session, webhook and financial workflows;
- safe degradation when dependencies fail;
- traceability of security-relevant actions without copying PHI/secrets into logs, audit exports or public evidence;
- controlled data residency, retention, deletion and holds through #77/#79;
- controlled repository promotion through #84;
- external/adversarial validation on the exact release candidate through #85.

## 3. Protected assets

| Asset | Description | Primary security property |
| --- | --- | --- |
| A-01 Identity/session material | account credentials, access/refresh sessions, lockout/recovery state | Confidentiality + integrity |
| A-02 MFA material | TOTP secret envelopes, MFA challenges and policy state | Confidentiality + integrity |
| A-03 Clinical PHI | encounters, diagnoses, medications, vitals, orders, results, documents, diagnostic reports | Confidentiality + integrity + availability |
| A-04 Consent/access basis | patient consent, treatment relationships, provider status/credentials | Integrity + auditability |
| A-05 Financial/coverage state | invoices, payment intents/results, refunds, payouts, eligibility, prior auth, claims/EOB/remittance | Integrity + confidentiality |
| A-06 External-provider secrets | PSP, payer, claims, notification, LiveKit and SIEM credentials | Confidentiality + rotation/recovery |
| A-07 Audit/security evidence | AuditEvent, SIEM delivery state, security findings and release evidence | Integrity + availability |
| A-08 Release configuration/artifacts | source, dependency graph, workflows, environment contract, release SHA | Integrity + provenance |
| A-09 Location/emergency data | coordinates, callback details, dispatch/transport state | Confidentiality + integrity + availability |

## 4. Trust boundaries

### TB-01 — User clients to edge/API
Patient, Doctor, Other Provider and Admin requests cross an untrusted network boundary into the deployed edge/API. Authentication, authorization, bounded request parsing, CORS/origin controls, security headers and TLS are required here.

### TB-02 — API/workers to PostgreSQL
PostgreSQL is the durable source of truth for identity, booking, clinical, financial, notification, audit and governance state. Production requires authenticated TLS, HA/PITR evidence, bounded pooling and recovery acceptance under #79/#90.

### TB-03 — API/workers to Redis
Redis is used for rate limiting/coordination/compatibility paths. Production requires authenticated TLS, writable-primary validation, replicas/durability evidence and failure/reconnect acceptance. Current runtime explicitly does not support Redis Cluster; any difference from the approved reference architecture requires an explicit architecture decision rather than silent acceptance.

### TB-04 — API to clinical object storage
Encrypted clinical document blobs and enabled bulk artifacts cross into private object storage. Production local storage is forbidden. S3 access, public-access blocking, SSE-KMS, lifecycle and region must be proven under #77/#79.

### TB-05 — Runtime to KMS and external-secret custody
Clinical/MFA/order/document/messaging/telehealth envelopes and external integration secrets depend on customer-managed KMS aliases and workload identity. Key rotation, account/region, least privilege and old-key retention/recovery are release evidence requirements.

### TB-06 — Runtime to external providers
Enabled PSP, insurance, claims, notifications, LiveKit, DICOM/PACS and malware-scanning paths cross organizational/network trust boundaries. Production mocks are not acceptable for enabled integrations. Endpoint trust, bounded responses/timeouts, idempotency/replay, secret delivery and outage behavior are owned by #80/#90.

### TB-07 — Runtime/audit to SIEM and observability
Security/operational telemetry crosses into OTLP/SIEM systems. Exports must minimize PHI and secrets, remain bounded/retriable and be validated against real endpoints under #79.

### TB-08 — GitHub/CI to Release Candidate and `main`
Source, Actions workflows and promotion controls form a software-supply-chain boundary. Immutable action SHAs, dependency verification, scanning and CodeQL exist, but branch/ruleset enforcement remains blocked by #84.

### TB-09 — Mobile app to native OS/platform services
Token storage, app-switcher privacy, camera/microphone/location permissions, push, deep links and signed binaries depend on native Android/iOS runners. Production mobile evidence remains blocked by #81.

### TB-10 — Emergency/transport request to operational dispatch
Emergency/location requests cross from patient/device context into operational dispatch/provider workflows. Release behavior must not fabricate dispatch success, and launch authority/operating model is a clinical/regulatory/operations decision under R9.

## 5. Threat register

| Threat ID | Threat / abuse case | Existing Release 1 controls | Residual release evidence/status |
| --- | --- | --- | --- |
| TM-AUTH-01 | Credential stuffing / brute-force login | password policy, salted scrypt, account lockout, distributed rate limits | Environment/adversarial retest #85 |
| TM-AUTH-02 | Privileged password-only access / MFA bypass | server-side privileged MFA production policy, encrypted TOTP, one-time challenges | #83 code-complete; operational bootstrap/recovery + final retest required |
| TM-AUTH-03 | Refresh replay/concurrent replay | opaque token hashes, transactional single-use refresh rotation, replay denial/audit | CI regression + final adversarial retest |
| TM-AUTH-04 | Stolen/revoked session remains usable | expiry, account status checks, session revoke/revoke-all | Production/mobile lifecycle evidence #81/#85 |
| TM-AUTHZ-01 | Horizontal BOLA/IDOR between patients | object-level patient ownership checks | New R6 two-patient adversarial CI regression + external test #85 |
| TM-AUTHZ-02 | Horizontal BOLA/IDOR between providers | provider ownership, appointment relationship, treatment/consent basis | New R6 two-provider adversarial CI regression + external test #85 |
| TM-AUTHZ-03 | Vertical privilege escalation into Admin/security routes | global deny-by-default guard and centralized role permissions | New R6 role-escalation CI regression + branch/admin review #85 |
| TM-CONSENT-01 | Wrong/revoked/expired consent grants clinical access | exact clinical scope/version, state/expiry checks, treatment/author basis | New R6 wrong-version + revoke regression; systematic test #85 |
| TM-PROVIDER-01 | Suspended/unapproved provider continues clinical action | ACTIVE provider checks; onboarding/credential review state | Credential-expiry operational governance remains R9/UAT evidence |
| TM-DATA-01 | Plaintext clinical PHI at rest | AES-256-GCM envelope encryption, private storage, KMS production contract | Real KMS/storage evidence #79; lifecycle #77 |
| TM-DATA-02 | PHI leaks through logs/audit/notifications/errors | allowlisted/minimized audit/SIEM, PHI-neutral notification templates, bounded errors | New denial-body/audit marker assertion + external/error-path review #85 |
| TM-DATA-03 | Data deleted despite legal/clinical/regulatory hold | #77 persistent holds, preserve-only classes, approval-gated execution | Launch policy/owners + real geography #77/#79/R9 |
| TM-FILE-01 | Malicious/oversized clinical upload | media/size bounds, malware scanner, fail-closed production scanner path, integrity digest | Real ClamAV throughput/outage evidence #80/#90 |
| TM-DICOM-01 | DICOM SSRF/off-domain/credential abuse | HTTPS production boundary, endpoint restriction, UID validation, proxy requirement | Real PACS/auth/network test if launch-enabled #80 |
| TM-FIN-01 | Duplicate charge/refund or callback replay | idempotency, normalized financial state, bounded gateway egress/response | Real PSP duplicate/retry/settlement acceptance #80/#90 |
| TM-FIN-02 | Hosted-payment open redirect / malicious action URL | exact HTTPS trusted action origins; redirects/embedded credentials rejected | Real provider callback/hosted checkout evidence #80 |
| TM-CLAIM-01 | Insurance/claim tampering or replay | external adapters, idempotency, bounded egress/response, normalized state | Real payer/clearinghouse evidence if launch-enabled #80 |
| TM-TELE-01 | Wrong LiveKit room/token participant access | scoped server-minted room tokens, real provider required in production | Real-device wrong-room/token tests #80/#81/#85 |
| TM-TELE-02 | Forged/replayed LiveKit webhook | signed scoped raw-body webhook path | Real webhook/replay acceptance #80/#85 |
| TM-TELE-03 | Unapproved recording of consultation | recording disabled by default | Launch policy/consent and provider configuration review R9/#80 |
| TM-NOTIF-01 | PHI exposed in push/SMS/email | PHI-neutral template keys and secure in-app detail retrieval | Real provider payload/log review #80 |
| TM-AVAIL-01 | Oversized inbound/outbound data exhausts service | production body limits; bounded external-provider responses | R8 load/resource exhaustion #89/#90 |
| TM-AVAIL-02 | Redis/DB/provider outage causes unsafe state or duplicate effects | durable PostgreSQL state, retries/leases/idempotency, readiness preflights | Production-equivalent failure injection #90 |
| TM-OBS-01 | Telemetry exporter leaks PHI/secrets or silently fails | structured/minimized audit/SIEM, bounded OTLP queue/timeout | Real collector/SIEM review and outage test #79/#90 |
| TM-SUPPLY-01 | Secret committed or dangerous source pattern introduced | repository security scanner, secret-pattern rules, CodeQL | Exact-RC security workflow + threat-driven review #85 |
| TM-SUPPLY-02 | Dependency/action supply-chain compromise | canonical npm lock verification, high-severity audit, pinned Actions SHAs | Exact-RC CI/security evidence |
| TM-SUPPLY-03 | Unchecked direct promotion bypasses green gates | CI/security/recovery gates exist | **BLOCKED #84**: branch/ruleset enforcement absent |
| TM-KEY-01 | Production key/secret compromise with no safe rotation | KMS alias/rotation preflight, encrypted external-secret files | Real IAM/rotation/recovery rehearsal #79 |
| TM-EMERG-01 | False/silent emergency dispatch or tampered location/status | bounded emergency status model and Release 1 emergency launch gate | Operational authority/workflow/UAT/regulatory sign-off R7/R9 |

## 6. High-risk abuse-case chains

### AC-01 — Stolen password → privileged account → clinical/financial access
Required defenses: lockout/rate limiting, privileged MFA, least-privilege role grants, session revocation, audit and final adversarial testing. ADMIN does not automatically receive clinical-record permissions.

### AC-02 — Provider account → guessed patient/appointment ID → PHI disclosure
Required defenses: route permission plus object-level relationship/consent/ownership checks. The R6 adversarial regression must use two providers and two patients and prove denial before valid consent as well as denial after consent revocation.

### AC-03 — Browser/API request → malicious upstream URL/redirect → credential or payment theft
Required defenses: endpoint validation, no embedded credentials, redirect rejection/trusted hosted-payment origins, bounded responses and production non-loopback constraints.

### AC-04 — Duplicate/replayed financial or webhook request → duplicate side effect
Required defenses: provider/webhook authenticity, idempotency keys, transactional/durable state and negative replay tests against real launch providers.

### AC-05 — Clinical upload → malicious file → storage or downstream compromise
Required defenses: size/type validation, malware scanning, encrypted storage, integrity digest and fail-closed scanner behavior.

### AC-06 — Operational failure → retry storm → duplicate booking/payment/notification or stale reminder
Required defenses: durable source of truth, idempotency/deduplication, leases, stale-generation validation, bounded retries and R8 failure injection.

### AC-07 — Developer/repository access → direct unchecked promotion → production compromise
Required defenses: mandatory PR/ruleset checks, limited bypass, exact-RC validation and release identity. This remains open under #84.

## 7. Automated security evidence mapped to this model

Release 1 already runs deterministic security/recovery/functional gates covering authentication/session replay, production KMS/Redis/PostgreSQL/object-storage preflights, static security, external egress/response boundaries, browser origins, clinical encryption/access, documents, telemedicine, financial/claims workflows, messaging/notifications, transport/emergency and observability.

R6 adds two explicit model-driven gates:

1. `r6:threat-model-contract` — verifies that the versioned threat model and adversarial plan retain the required trust boundaries/threat families and that the live R6 adversarial CI test remains wired into CI.
2. `services/api/scripts/r6-adversarial-authorization-smoke.mjs` — live CI regression using two distinct patients and two distinct providers to exercise unauthenticated/forged-token access, vertical role escalation, cross-patient appointment BOLA, cross-provider clinical access, wrong consent version, valid consent, consent revocation and PHI leakage assertions in denial responses/audit evidence.

These deterministic gates are regression evidence only. They do **not** satisfy the #85 requirement for an independent/production-equivalent penetration and adversarial assessment.

## 8. Required production-equivalent penetration scope

The final #85 assessment must run against the exact candidate SHA in an approved production-equivalent environment and include:

- unauthenticated tests and authenticated testing for every enabled role;
- at least two patients and two providers for horizontal object authorization;
- privilege escalation and confused-deputy tests;
- session/MFA replay, revocation and recovery cases;
- consent/treatment-relationship bypass attempts;
- clinical/document/file/DICOM boundaries;
- enabled PSP/payer/claims/notification/LiveKit replay and failure paths;
- browser/admin/session/origin/cache/error leakage tests;
- safe resource-exhaustion/rate-limit tests;
- CI/repository/promotion review including #84;
- production secret/key compromise-and-recovery tabletop or technical rehearsal as appropriate.

Sensitive exploit details and evidence must be stored in a restricted location. Public GitHub evidence may include only sanitized finding identifiers, severity, owner, remediation reference and retest state.

## 9. Severity and release treatment

- **Critical / High:** release blocker until remediated and retested on the final candidate; no silent waiver.
- **Medium:** explicit owner, treatment decision, target date and approving security/product owner required.
- **Low / Informational:** tracked when useful; may be accepted with rationale.

Any accepted risk that changes clinical safety, privacy/legal basis, launch-country obligations or emergency authority requires the corresponding Clinical/Privacy/Legal/Operations approval; engineering cannot self-certify those decisions.

## 10. Approval record

| Approval | Required evidence | Status |
| --- | --- | --- |
| Security owner | threat model review + final adversarial/pentest result | PENDING |
| Privacy/Legal | data handling/residency/retention/external processors for launch jurisdiction | PENDING — #77/R9 |
| Clinical safety | clinical access, provider governance, telemedicine/emergency hazards | PENDING — R7/R9 |
| Operations/SRE | production topology, monitoring, DR/failure evidence | PENDING — #79/#90 |
| Release owner | exact RC gates + branch/promotion controls | PENDING — #84/R10 |

## 11. Current R6/#85 decision

Threat-model artifact: **IMPLEMENTED IN REPOSITORY**.  
Automated model-driven adversarial regression: **IMPLEMENTED IN CI CANDIDATE; exact-SHA validation required**.  
Independent/production-equivalent penetration/adversarial acceptance: **PENDING / RELEASE BLOCKER**.  
Overall #85 status: **IN PROGRESS / NO-GO** until the external/environment-specific assessment and approvals are complete.

Never place production credentials, tokens, MFA secrets, raw PHI, payment-card data, private keys or sensitive exploit payloads in this document or public GitHub evidence.
