# Release 1 — R9 Market / Regulatory / Clinical-Safety Evidence Contract

## 1. Purpose

This contract makes the R9 Go/No-Go evidence boundary machine-checkable without pretending that CI can perform legal, privacy, regulatory, clinical-safety or market authorization.

Canonical branch:

`release/release-1-integration-go-live-readiness`

Parent workstream: #91

Dedicated R9 P0 blockers:

- #92 — KSA regulatory/privacy/compliance acceptance pack;
- #93 — provider licensing, credential verification and scope-of-practice policy;
- #94 — telemedicine and emergency-ambulance clinical-safety / launch activation.

The contract validates the shape, completeness, exact-Release-Candidate binding and fail-closed disposition of sanitized acceptance evidence. The real approvals remain human governance decisions made by authorized owners and stored in the approved controlled evidence repository.

## 2. Repository artifacts

- `.ci/release-market-readiness-evidence-contract.mjs` — fail-closed validator, self-test and sanitized contract-evidence generator.
- `ops/release-1/market-readiness-evidence.example.json` — deliberately BLOCKED, non-approved example template.
- `.github/workflows/market-readiness-evidence-contract.yml` — exact-SHA contract validation workflow.
- `docs/release-1-r9-market-readiness-evidence-contract.md` — this operating contract.

The workflow output is contract evidence only. It explicitly records:

- `productionAcceptance=false`;
- `legalApprovalExecuted=false`;
- `clinicalSafetyApprovalExecuted=false`;
- `workflowPurpose=contract-validation-only`.

A green workflow therefore means the evidence contract itself is deterministic and fail-closed. It is not a KSA launch authorization.

## 3. Exact Release Candidate binding

Accepted R9 evidence must identify:

- exact 40-hex Release Candidate source SHA, matching the checked-out candidate;
- release version;
- immutable RC evidence digest;
- restricted evidence reference;
- production-equivalent or production environment;
- KSA or other explicitly selected launch jurisdiction.

Evidence from another SHA or a generic test environment is rejected.

## 4. Inherited release dependencies

Final R9 acceptance requires accepted evidence references for:

- R3 — production infrastructure / residency / recovery dependencies;
- R4 — enabled external integrations and vendor/provider boundaries;
- R5 — native mobile release/device evidence;
- R6 — security and privacy release gate;
- R7 — clinical and operational UAT;
- R8 — performance, resilience and failure-mode acceptance.

Each dependency must be recorded as `PASS`. A technical R9 control cannot bypass an unresolved inherited release gate.

## 5. Launch-scope declaration

The final evidence must explicitly identify the launch entity/scope and whether the following are enabled:

- telemedicine;
- emergency ambulance;
- payments;
- insurance/claims;
- FHIR/SMART;
- operational communications/notifications.

It must also reference:

- the market-specific interoperability/NPHIES/FHIR obligation decision;
- the approved provider-policy version;
- the approved privacy-policy version.

The validator does not decide whether NPHIES/FHIR is legally mandatory. It only requires the authorized launch decision to exist and be referenced.

## 6. R9 control inventory

The 33 controls are taken directly from the R9 Release 1 acceptance matrix.

### Privacy and data governance

- R9-PRI-01 through R9-PRI-07.

These cover legal/commercial entity and controller/processor roles, data inventory/ROPA, DPIA/high-risk assessment, residency and lifecycle policy, data-location/transfer boundaries, notices/consent/rights, and vendor DPA/sub-processor/exit evidence.

### Provider and clinical governance

- R9-CLN-01 through R9-CLN-06.

These cover Doctor licence/registration verification, specialty/service privilege policy, Other Provider scope-of-practice configuration, expiry/revocation/reverification behavior, Admin/Support least privilege, and clinical responsibility/patient-safety escalation ownership.

### Telemedicine

- R9-TEL-01 through R9-TEL-06.

These controls are applicable when telemedicine is enabled. If telemedicine is deliberately disabled for the launch, every telemedicine control must be recorded as `NOT_APPLICABLE` with both a rationale reference and an authorized approval reference.

### Emergency ambulance

- R9-EMS-01 through R9-EMS-08.

R9-EMS-01 always requires an explicit production ENABLED/DISABLED launch decision. If ambulance is disabled, R9-EMS-02 requires evidence that routes are absent/disabled and the enable-only controls are `NOT_APPLICABLE` with approved rationale. If ambulance is enabled, the validator requires sanitized references to licensed operator approval, local approval, 24x7 support, approved service area and fallback/safety policy; the enable-only R9-EMS-03..07 controls must PASS.

R9-EMS-08 remains mandatory in both states so advanced CAD/public-network/tracking scope cannot silently enter Release 1.

### Market/commercial operations

- R9-MKT-01 through R9-MKT-06.

PSP/acquirer acceptance is conditional on payments being enabled. Communications-market review is conditional on launch communications being enabled. The interoperability/NPHIES/FHIR obligation decision, Arabic/RTL/accessibility acceptance, support/on-call readiness and incident/escalation rehearsal remain explicit release controls.

## 7. Telemedicine recording boundary

Recording is independently declared.

When `recordingEnabled=false`, the evidence must reference proof/configuration that recording is disabled.

When `recordingEnabled=true`, the contract requires separate approval references for:

- purpose;
- consent;
- retention;
- processing/storage location;
- access policy.

CI does not judge those policies. It prevents a recording-enabled launch record from passing without them.

## 8. R9 blockers and formal acceptance

The final evidence must contain #92, #93 and #94.

Each must be either:

- `CLOSED`; or
- `FORMALLY_ACCEPTED` by the authorized Go/No-Go authority.

A formally accepted blocker additionally requires:

- acceptance-authority reference;
- residual-risk reference;
- review/expiry date.

`OPEN` or `BLOCKED` cannot produce accepted R9 evidence.

This mechanism is not intended to normalize unresolved P0 risk. It exists only for an explicitly governed decision by the authorized Release body.

## 9. Exceptions and waivers

Every waiver must include:

- immutable/sanitized reference;
- accepted status;
- authority reference;
- owner reference;
- residual-risk reference;
- review/expiry date.

No waiver can omit its risk owner or become indefinite by leaving the review date blank.

## 10. Required approval authorities

Final R9 evidence requires APPROVE decisions from:

1. Legal/Regulatory;
2. Privacy/Compliance;
3. Clinical Safety;
4. Operations;
5. Provider Governance;
6. Product/Market;
7. Release Authority.

This reflects the ownership boundaries in #92, #93 and #94. Security is an inherited R6 gate and remains mandatory through the R6 dependency rather than being re-certified inside R9.

## 11. Public evidence safety

The contract rejects common secret/credential/PHI-like keys and credential-like values. Public GitHub evidence must not contain:

- patient identifiers or clinical data;
- passwords, access/refresh tokens, MFA secrets or private keys;
- raw request bodies;
- payment-card data;
- provider licence/credential numbers or restricted credential documents;
- contracts, privileged legal advice or restricted penetration details.

Only sanitized statuses, dates, owner/authority references, policy versions and immutable restricted-evidence references belong in the repository-facing record.

## 12. Final acceptance behavior

A final evidence record can validate as PASS only when:

- `approved=true` and `overallStatus=PASS`;
- exact RC SHA matches the checkout;
- R3–R8 dependencies are PASS;
- all 33 controls are present;
- every applicable control is PASS;
- disabled capabilities use explicit NOT_APPLICABLE rationale/approval rather than disappearing;
- emergency and telemedicine high-risk activation boundaries are satisfied;
- #92/#93/#94 are closed or formally accepted;
- every waiver is bounded and owned;
- all seven approval authorities approve;
- final acceptance occurs after the latest applicable control and approval timestamp.

The deliberately blocked template cannot be mistaken for production acceptance.

## 13. Validation commands

Contract self-test:

```bash
node .ci/release-market-readiness-evidence-contract.mjs --self-test
```

Validate the blocked example template:

```bash
node .ci/release-market-readiness-evidence-contract.mjs --validate-template ops/release-1/market-readiness-evidence.example.json
```

Validate a completed restricted/sanitized final evidence file against the exact checkout:

```bash
node .ci/release-market-readiness-evidence-contract.mjs --validate <completed-evidence.json> --out <validation-result.json>
```

## 14. Release decision boundary

This contract closes an evidence-governance gap; it does not close R9 by itself.

R9 remains NO-GO until authorized KSA legal/privacy/compliance, clinical/provider and high-risk operating decisions exist for the exact candidate and the inherited release gates are accepted. `main` remains unchanged until the complete Release Candidate Go/No-Go process passes.
