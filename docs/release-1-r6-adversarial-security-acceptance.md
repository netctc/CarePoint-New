# Release 1 — R6 Adversarial Security Acceptance Plan

Status: **IN PROGRESS / PRODUCTION-EQUIVALENT ASSESSMENT PENDING**  
Owner workstream: R6 #82  
Security blocker: #85  
Threat model: `docs/release-1-r6-threat-model.md`

## 1. Purpose

This document turns the Release 1 threat model into an executable and reviewable adversarial-security acceptance plan. It distinguishes deterministic CI regression from the final production-equivalent penetration/adversarial assessment required by #85.

CI evidence is necessary but is not treated as a penetration-test result or compliance certification.

## 2. Automated release regression matrix

| Threat family | Deterministic Release 1 evidence | Current status |
| --- | --- | --- |
| Authentication/session replay | IAM persistence, R6 privileged MFA policy, Slice 9 refresh replay/rate-limit/cleanup | AUTOMATED |
| Vertical authorization | global permission guard, Admin acceptance, new R6 adversarial role-escalation checks | AUTOMATED |
| Patient BOLA/IDOR | clinical object checks + new two-patient adversarial encounter test | AUTOMATED |
| Provider BOLA/IDOR | Slice 3.1 + new two-provider adversarial timeline/write/finalize tests | AUTOMATED |
| Consent bypass/revocation | Slice 3.1 consent path + new wrong-version/valid/revoke sequence | AUTOMATED |
| Clinical encryption/integrity | Slice 3.1 encrypted record acceptance | AUTOMATED |
| Clinical document access/file boundaries | Slice 5/5.1 document acceptance, scanner/storage preflights | AUTOMATED; real scanner/PACS pending |
| Payment/hosted-action/replay boundaries | Slice 6 + C13/C14/C16 security gates | AUTOMATED; real PSP pending |
| Insurance/claims tamper/replay | Slice 6/6.2 + bounded egress/response gates | AUTOMATED; real payer route pending |
| Telemedicine token/session/webhook | Slice 3 + LiveKit endpoint/raw-body security gates | AUTOMATED; real LiveKit/device pending |
| Messaging/notification PHI minimization | Slice 7 + notification outbox/provider-boundary gates | AUTOMATED; real channels pending |
| Transport/emergency workflow | Slice 8 + R9 emergency launch gate | AUTOMATED; operational/regulatory acceptance pending |
| Request/response exhaustion boundaries | C14/C17 plus rate-limit regression | AUTOMATED static/deterministic; load/failure injection pending #89/#90 |
| Logs/audit/telemetry leakage | SIEM/OTLP gates + new denial-response/audit PHI-marker assertion | AUTOMATED; real exporter review pending |
| Supply chain/source security | lock verification, npm audit, repository scanner, CodeQL, immutable Action SHAs | AUTOMATED; promotion enforcement blocked #84 |
| Data residency/retention/holds | #77 data-governance preflight/lifecycle acceptance | CODE COMPLETE; actual geography/policy approval pending |

## 3. New R6 live adversarial CI scenario

The script `services/api/scripts/r6-adversarial-authorization-smoke.mjs` runs against the started API and a disposable CI PostgreSQL database. It creates unique test identities on every run.

The scenario must prove all of the following:

1. unauthenticated protected-resource access returns 401;
2. a forged bearer token returns 401;
3. a Patient cannot access Admin audit functionality or create privileged accounts;
4. a Doctor cannot access Admin audit functionality;
5. an Admin cannot use clinical-provider PHI routes merely because the account is privileged;
6. two distinct patients exist and Patient B cannot read Patient A's encounter by object ID;
7. two distinct providers exist and Provider B cannot read Patient A's provider timeline before an authorized basis exists;
8. Provider B cannot write/finalize Provider A's encounter;
9. a consent with the correct scope but an unapproved version does not grant access;
10. a valid versioned patient consent grants Provider B the intended read basis only;
11. revocation removes that consent basis again;
12. denied response bodies do not contain the synthetic PHI marker;
13. denied audit evidence does not contain the synthetic PHI marker;
14. expected authorization/clinical denial events are present in durable audit state.

The test intentionally uses a synthetic marker only. It must never use real PHI, credentials or production identifiers.

## 4. Model-contract gate

`services/api/scripts/r6-threat-model-contract-smoke.mjs` is a deterministic repository gate. It verifies that:

- all required Release 1 trust boundaries remain represented in the threat model;
- required threat families remain represented;
- the adversarial plan explicitly distinguishes CI from external penetration testing;
- the live R6 adversarial test remains wired into `.github/workflows/ci.yml`;
- the release documentation continues to state that production-equivalent penetration testing is pending until evidence is actually supplied.

This prevents accidental deletion of the security model/gate during release stabilization. It does not test a running system.

## 5. Existing high-value adversarial/regression coverage

The following existing gates are retained as part of the #85 evidence package:

- `r6-privileged-mfa-policy-smoke.mjs` — privileged password-only policy denial and enrollment policy;
- `slice9-smoke.mjs` — refresh single-use/replay, Redis rate limiting, stale-auth cleanup and security headers;
- `slice31-smoke.mjs` — encrypted clinical storage, cross-provider denial before consent, consent-authorized access and encounter immutability;
- `slice5-smoke.mjs` / Slice 5.1 — clinical documents/diagnostic reports and access/integrity paths;
- `slice6-smoke.mjs` — payment/insurance state and financial controls;
- `slice62-smoke.mjs` — claims/EOB/revenue-cycle state;
- `slice3-smoke.mjs` — telemedicine session/token behavior;
- `slice7-smoke.mjs` — secure messaging/notification behavior;
- `slice8-smoke.mjs` — transport/emergency paths;
- `admin-b7-smoke.mjs` — Admin security/audit UI/backend behavior;
- C10/C13/C14/C15/C16/C17/C18/C19 — source scanning, endpoint/redirect/response/body/raw-body/browser-origin controls;
- Security Analysis — repository scan plus CodeQL `security-extended`;
- PostgreSQL Recovery — database recovery regression;
- Slice 10 FHIR — retained interoperability regression when present in the candidate.

## 6. Production-equivalent manual/adversarial test matrix

These tests must be performed against the exact final candidate in the approved staging/production-equivalent environment. `PASS` cannot be inferred from source review or CI fixtures.

| Test ID | Area | Scenario | Required result | Dependency |
| --- | --- | --- | --- | --- |
| ADV-AUTH-01 | Authentication | credential stuffing/rate-limit behavior from representative edge paths | bounded/observable denial | #79 |
| ADV-AUTH-02 | MFA | privileged login/recovery/reset/replay | no unrestricted password-only privileged session | #83 operational evidence |
| ADV-AUTHZ-01 | BOLA | cross-patient IDs across booking/clinical/docs/orders/billing/claims/messages | deny + no PHI leakage | #79/#85 |
| ADV-AUTHZ-02 | BOLA | cross-provider IDs/care relationship manipulation | deny unless exact authorized basis | #79/#85 |
| ADV-AUTHZ-03 | Role escalation | Patient/Provider/Support attempts Admin/finance/security actions | deny and audit | #79/#85 |
| ADV-CONSENT-01 | Consent | wrong scope/version, expired, revoked, provider-specific/global cases | only approved live consent grants intended access | #85/R7 |
| ADV-FILE-01 | Upload | malformed type, oversized body, EICAR, scanner outage/timeout | reject/fail closed | #80/#90 |
| ADV-DICOM-01 | DICOM | off-domain, embedded credential, invalid UID, direct-browser bypass | reject/no auth bypass | #80 if enabled |
| ADV-FIN-01 | Payment | timeout/5xx/duplicate callback/replay/cancel/refund race | no duplicate/ambiguous financial side effect | #80/#90 |
| ADV-CLAIM-01 | Claims | duplicate submit, inconsistent adjudication, replay | reject/normalize safely | #80/#90 if enabled |
| ADV-TELE-01 | LiveKit | wrong-room token, token replay, unauthorized participant | no cross-room/session access | #80/#81 |
| ADV-TELE-02 | Webhook | invalid signature and replay | reject without state corruption | #80/#85 |
| ADV-NOTIF-01 | Notifications | real push/SMS/email payload/log inspection | no unnecessary PHI | #80 |
| ADV-EDGE-01 | Browser/Admin | origin spoof, cookie/session/cache/header behavior | no cross-origin/session downgrade | #79 |
| ADV-OBS-01 | Error/telemetry | malformed IDs/bodies/upstream errors | no PHI/secrets in client/log/SIEM/trace | #79 |
| ADV-DOS-01 | Resource exhaustion | safe bounded load/rate-limit/body/response tests | thresholds hold; graceful degradation | #89/#90 |
| ADV-DR-01 | Dependency loss | Redis/DB/provider/OTLP/SIEM failure | no integrity loss/unsafe duplicate | #90 |
| ADV-SUPPLY-01 | Promotion | ordinary direct/unchecked promotion attempt | blocked by enforced rules | #84 |
| ADV-KEY-01 | Key/secret compromise | rotation/recovery rehearsal | old retained data remains usable; compromised material rotated | #79 |
| ADV-MOBILE-01 | Native privacy | app switcher, backup, Keychain/Keystore, deep links, permissions | no token/PHI exposure | #81 |

## 7. Finding lifecycle

Every finding must have a stable ID, severity, affected exact SHA/environment, owner, remediation reference, retest evidence and current treatment.

- Critical/High: Release 1 remains NO-GO until fixed and retested.
- Medium: owner + treatment + due date + explicit acceptance/remediation decision.
- Low/Informational: track where useful; no silent deletion of evidence.

Sensitive exploit payloads, provider secrets, tokens, MFA data and PHI must live only in an approved restricted evidence store. GitHub should contain sanitized status and references.

## 8. Evidence record template

| Field | Value |
| --- | --- |
| Evidence ID | `ADV-...` |
| Exact Release SHA |  |
| Environment |  |
| Date/time |  |
| Tester/team |  |
| Role/account classes used | synthetic/non-secret only |
| Test method | automated / manual / tool-assisted |
| Result | PASS / FAIL / CONDITIONAL |
| Finding ID/severity | if applicable |
| Remediation reference |  |
| Retest result |  |
| Restricted evidence location | reference only |
| Approver |  |

## 9. Exit criteria for #85

#85 can close only when:

- the threat model is reviewed and approved by the named security owner;
- the exact final candidate passes the deterministic R6 model/adversarial regressions;
- production-equivalent testing covers every enabled launch role and integration boundary;
- no unresolved Critical/High release-blocking finding remains;
- Medium/Low residual findings have explicit owners/treatment/dates;
- every remediated Critical/High finding is retested on the final candidate;
- sanitized final evidence is linked from #85 and R6 #82;
- #84 promotion protection is enforced before final promotion.

Current decision: **IN PROGRESS / NO-GO**. Automated security coverage is being strengthened, but the final production-equivalent penetration/adversarial assessment is still required.
