# Release 1 — R5 Signed Mobile Release and Real-Device Evidence Contract

Status: **REPOSITORY CONTROL / FINAL ACCEPTANCE REQUIRES REAL EVIDENCE**  
Parent workstream: #81  
Supporting task: #120  
Canonical branch: `release/release-1-integration-go-live-readiness`

## Purpose

This control turns the remaining R5 mobile release evidence into a machine-checkable, fail-closed contract without inventing production application identities, signing credentials, store ownership, API domains, push configuration, deep-link domains, supported OS policy or physical-device results.

The existing `Mobile Native Compatibility` workflow remains useful compatibility evidence: it generates temporary Android/iOS runners and compiles all three Flutter applications with the validation-only `io.carepoint.validation` namespace. Those builds are intentionally non-production and must never be promoted as Release 1 artifacts.

The new final evidence schema is:

`carepoint.release-mobile-evidence/v1`

The validator is:

`.ci/release-mobile-evidence-contract.mjs`

The deliberately non-approved collection template is:

`ops/release-1/mobile-release-evidence.example.json`

## What final PASS evidence must prove

### Exact Release Candidate binding

Final evidence must bind to the exact checked-out 40-character Release Candidate SHA and include immutable API/Admin artifact digests plus references to the accepted RC, R3 infrastructure and R4 external-integration evidence. A record for a different checkout fails validation.

### Approved production app profiles

The final record must provide approved profiles for:

- `patient-mobile`;
- `doctor-mobile`;
- `provider-mobile`.

Each profile must identify stable production Android and iOS application identities, display name, store/signing ownership, supported Android/iOS policy, production API endpoint and the approved decisions for deep links and push.

The contract rejects the compatibility namespace `io.carepoint.validation`, identities containing validation/debug/test markers, and local/validation API endpoints. The product/operations values themselves are not selected by this repository control.

### Signed immutable mobile artifacts

Exactly six launch artifacts are required:

- Patient Android AAB;
- Patient iOS IPA;
- Doctor Android AAB;
- Doctor iOS IPA;
- Other Provider Android AAB;
- Other Provider iOS IPA.

Every final artifact must be signed, non-debug, use the approved production identity, carry the exact source SHA in release metadata and include sanitized references for build evidence, signing evidence, binary inspection, immutable artifact storage and release metadata. Artifact SHA-256 digests must be unique and are reused by the physical-device evidence rows.

The evidence record never contains signing keys, keystore passwords, provisioning secrets or store credentials.

### Native security, privacy and release controls

The contract includes mandatory PASS controls for committed native runners, fail-closed production API configuration, Android Keystore and iOS Keychain secure storage, logout/session cleanup, app-switcher privacy, least-privilege Android permissions, iOS usage descriptions/privacy manifest, store privacy declarations, release artifact traceability, dependency/license/vulnerability review, English release smoke, Arabic RTL release smoke and accessibility/text-scaling acceptance.

Conditional controls become mandatory when their launch scope is enabled:

- telemedicine media permissions/lifecycle;
- Patient location/emergency permission and safe fallback;
- hosted-payment return/deep-link handling;
- push registration/rotation/logout.

When a conditional feature is genuinely out of launch scope its control must be `NOT_APPLICABLE` with explicit rationale and approval evidence. Silence is not accepted as a scope decision.

### Real physical-device matrix

Final evidence requires one PASS record for Android and one for iOS for each of the three applications. The record contains only a non-sensitive device family/OS description, the exact signed artifact digest, a sanitized evidence reference and tester-role reference.

Every device row proves login/session, the primary workflow, interruption/offline handling, accessibility basics and logout/session cleanup. High-risk scenarios are required dynamically according to the approved app profile:

- Patient/Doctor telemedicine when telemedicine is enabled;
- Patient emergency/location when enabled;
- Patient hosted-payment return when enabled;
- push notification handling for each app where push is enabled;
- Other Provider work-queue/route flow.

Simulator and unsigned compatibility builds do not satisfy this physical-device matrix.

### Localization and accessibility

Release 1 final mobile evidence must explicitly accept English and Arabic RTL behavior, text scaling and screen-reader labels for critical actions. The contract records an evidence reference rather than embedding screenshots or PHI-bearing test content in the public JSON.

### Final approvals

At minimum final evidence requires `APPROVE` records from:

- Mobile Engineering;
- Product;
- Release/Operations;
- Security;
- Privacy.

Clinical approval is additionally required when telemedicine or emergency/location clinical-risk workflows are enabled.

## Public evidence safety

The validator rejects common credential/signing-secret/device-token/PHI-like keys and common secret/token value patterns. Public evidence should contain sanitized references only. Restricted signing records, store credentials, device identifiers, real PHI and unredacted screenshots/logs belong in the approved private evidence system.

## DRAFT template policy

`ops/release-1/mobile-release-evidence.example.json` is intentionally not acceptable as final release evidence:

- `overallStatus` is `DRAFT`;
- `approved` is `false`;
- artifacts are explicitly unsigned/debug placeholders;
- device rows are `BLOCKED`;
- final approvals are pending.

The workflow verifies that this template remains visibly non-production so a repository example cannot be mistaken for Go-Live acceptance.

## GitHub Actions contract gate

`.github/workflows/mobile-release-evidence-contract.yml` performs only repository-side checks:

1. checks out the exact PR head SHA;
2. verifies checkout identity;
3. runs validator self-tests, including expected fail-closed cases;
4. verifies the example remains a non-approved DRAFT;
5. creates a sanitized fingerprint containing source SHA and hashes of the validator/template;
6. uploads that fingerprint as immutable workflow evidence.

It does **not** create a production runner, sign AAB/IPA files, use Apple/Google credentials, publish an app, contact APNs/FCM, execute telemedicine on a physical device or claim R5 completion.

## Release use

Once Product/Operations provide the approved app identities, signing ownership, supported OS policy, production API/deep-link/push decisions and the signed physical builds exist, copy the DRAFT template to the controlled final evidence location, replace placeholders with sanitized real evidence references, set only genuinely proven controls to PASS and execute:

```bash
node .ci/release-mobile-evidence-contract.mjs --validate <final-mobile-evidence.json>
```

Validation must run from the exact Release Candidate checkout named in `release.sourceSha`.

## R5 disposition

Completion of #120 means the repository-side final mobile evidence contract is implemented and tested. It does not close #81.

R5 remains **BLOCKED / REAL RELEASE EVIDENCE CONDITIONAL** until approved production Android/iOS identities and native projects exist, secure signing produces immutable AAB/IPA artifacts, platform privacy/deep-link/push configuration is finalized as applicable, and the required high-risk workflows pass on representative physical Android/iOS devices using those exact signed artifacts.
