# Release 1 — R7 UAT Evidence Contract

## 1. Purpose

This document defines the machine-checkable evidence contract for Release 1 clinical and operational User Acceptance Testing (UAT).

Canonical branch:

`release/release-1-integration-go-live-readiness`

The contract converts the R7 acceptance matrix into a fail-closed, exact-SHA release artifact. It prevents a Release Candidate from being represented as UAT-approved when required cases, environment evidence, defect closure or human sign-off are missing.

This contract is **not** UAT execution and is **not** a clinical, security, privacy or regulatory approval.

## 2. Contract components

- Validator: `.ci/release-uat-evidence-contract.mjs`
- Non-approved template: `ops/release-1/uat-evidence.example.json`
- Workflow: `.github/workflows/uat-evidence-contract.yml`
- Source UAT plan: `docs/release-1-r7-clinical-operational-uat.md`
- WEB-05 scenario: `docs/release-1-web05-patient-clinical-workspace.md`

The repository workflow validates the contract implementation and the deliberately BLOCKED example template. Its uploaded artifact states:

- `productionAcceptance=false`;
- `workflowPurpose=contract-validation-only`;
- `humanUatExecuted=false`;
- `syntheticDataOnly=true`.

A green contract workflow therefore proves only that the evidence schema and fail-closed checks behave as intended.

## 3. Required UAT coverage

The final evidence record requires the complete Release 1 R7 case inventory:

| Group | Required cases |
| --- | ---: |
| Patient | 18 |
| Doctor | 14 |
| Other Provider | 9 |
| Administrator | 11 |
| Cross-cutting | 12 |
| WEB-05 Clinical Patient Workspace | 1 |
| **Total** | **65** |

Every case that is applicable to the approved launch scope must be `PASS` and must contain:

- execution timestamp;
- tester reference;
- sanitized evidence reference.

A missing case, `FAIL`, `BLOCKED`, or unjustified `NOT_APPLICABLE` result rejects final UAT acceptance.

## 4. Launch-scope conditional cases

Some cases may be `NOT_APPLICABLE` only when the corresponding Release 1 capability is explicitly disabled in the launch-scope decision:

- payments: `UAT-PAT-010`, `UAT-ADM-009`;
- telemedicine: `UAT-PAT-012`, `UAT-DOC-009`, `UAT-ADM-008`, `UAT-X-008`;
- home visit: `UAT-PAT-013`, `UAT-OTH-006`;
- scheduled medical transport: `UAT-PAT-014`, `UAT-OTH-007`;
- emergency ambulance: `UAT-PAT-015`;
- secure messaging: `UAT-PAT-017`, `UAT-DOC-013`.

When a capability is disabled, every corresponding case must be recorded as:

- `applicability=NOT_APPLICABLE`;
- `status=NOT_APPLICABLE`;
- a sanitized rationale reference;
- an approval reference tied to the launch-scope decision.

The example KSA template keeps emergency ambulance disabled, consistent with the R9 rule that production ambulance activation requires separately approved jurisdiction, licensed operator, local approval and 24x7 support evidence.

## 5. Exact Release Candidate identity

Accepted UAT evidence must identify the exact Release Candidate:

- full 40-character Git SHA;
- release version;
- immutable RC evidence digest;
- RC evidence reference.

The validator rejects evidence when `release.sourceSha` differs from the checked-out candidate SHA. UAT results from an earlier implementation cannot be silently reused for a later candidate.

## 6. Environment prerequisites

Final R7 acceptance is allowed only for an environment classified as:

- `production-equivalent`; or
- `production` when explicitly approved for the relevant validation activity.

The evidence must reference accepted results for:

- R3 production infrastructure;
- R4 external integrations;
- R5 mobile/native release readiness.

These are references to controlled evidence, not substitutes for those workstreams.

## 7. Defect gate

The final UAT record contains the defects identified during acceptance.

Release-blocking rule:

- P0 defects must be `CLOSED`;
- P1 defects must be `CLOSED`;
- residual P2/P3 findings may remain only with explicit disposition, owner and target date.

This prevents a human sign-off from overriding an unresolved patient-safety, privacy, authentication/authorization, financial-integrity, data-integrity or major P1 workflow defect without formal release governance.

## 8. Required sign-offs

Four journey-specific sign-offs are mandatory:

- Patient;
- Doctor;
- Other Provider;
- Admin.

Final R7 approval additionally requires the following release roles:

- UAT Lead;
- Product;
- Clinical;
- Operations;
- Security/Privacy.

Every final sign-off must record an approver reference, evidence reference and approval timestamp. `acceptedAt` must not precede either the latest applicable UAT execution or the required approvals.

## 9. Sensitive-data boundary

The public/sanitized evidence record must contain no real PHI, credentials or restricted security material.

The validator rejects common secret/PHI-like keys and credential patterns, including tokens, passwords, private keys, patient identifiers, MRNs, national IDs, card data and professional credential numbers.

Screenshots, detailed test records, penetration evidence, contracts, credentials, production infrastructure details and any sensitive clinical data must remain in the approved restricted evidence repository. GitHub stores only sanitized immutable references.

## 10. Validation commands

Contract self-test:

```bash
node .ci/release-uat-evidence-contract.mjs --self-test
```

Validate the deliberately non-approved template:

```bash
node .ci/release-uat-evidence-contract.mjs \
  --validate-template ops/release-1/uat-evidence.example.json
```

Validate a completed sanitized evidence file against the current exact checkout:

```bash
node .ci/release-uat-evidence-contract.mjs \
  --validate path/to/uat-evidence.json \
  --out path/to/uat-validation-result.json
```

A successful `--validate` result may be used as one R7 release-evidence input only after the underlying human UAT and referenced R3/R4/R5 dependencies have actually been accepted.

## 11. Fail-closed examples

The contract self-test proves rejection for at least:

- evidence from the wrong source SHA;
- a non-production-equivalent environment;
- a missing required UAT case;
- a mandatory case left `BLOCKED`;
- a mandatory case incorrectly marked `NOT_APPLICABLE`;
- an unresolved P0 defect;
- missing journey sign-off;
- missing release approval;
- `approved=false` final evidence;
- credential-like content in a public evidence reference.

It also proves that the emergency-ambulance UAT case can be safely `NOT_APPLICABLE` when the launch scope explicitly disables that capability and provides decision references.

## 12. R7 release boundary

R7 remains **BLOCKED / IN PROGRESS** until real UAT is executed and approved on the exact final Release Candidate in the accepted production-equivalent environment.

The new contract closes an evidence-governance gap; it does not close R7, #87, R6, R9 or the overall Release 1 Go/No-Go gate.

`main` must remain unchanged until the complete Release Candidate decision is GO.
