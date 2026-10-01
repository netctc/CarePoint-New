# Release Phase 31 — External Go-Live Evidence Readiness

Branch: quality/release-gate-readiness-phase31-20261001

## Baseline

The consolidated validation candidate PR #511 reached 25/25 successful canonical workflows at source SHA:

9974b72b76b45539e6513730c3b8fdbe0d1506f0

The V2 functional authority is reconciled to 230/230 canonical IDs with merged implementation PR evidence.

Those facts establish code/integration traceability quality. They do not establish production acceptance.

## Purpose

Phase 31 turns the remaining external Go-Live blockers into one machine-readable inventory without fabricating any live evidence.

Every gate is deliberately:

- externalEvidenceRequired=true
- automatedContractIsSufficient=false
- autoClosable=false

## Eight remaining external gates

1. Production infrastructure live evidence.
2. Real external-provider acceptance.
3. Signed Android/iOS production release evidence.
4. Independent security assessment / penetration testing.
5. Human UAT execution and sign-off.
6. Resilience, failure injection, RPO and RTO evidence.
7. KSA market, regulatory, privacy, clinical and operational approvals.
8. Final deployment plus rollback rehearsal.

## Independent security assessment gap

The repository already has automated Security Analysis / CodeQL evidence. That is valuable, but it is not equivalent to an independent manual security assessment.

Phase 31 therefore adds:

ops/release-1/independent-security-assessment-evidence.example.json

The template remains DRAFT/BLOCKED by construction. It requires assessor independence, approved scope/rules of engagement, manual testing, findings/remediation evidence, and explicit security/release approvals.

No pentest result is invented.

## Existing live-evidence templates

Phase 31 reuses and verifies the existing templates:

- production-infrastructure-evidence.example.json
- external-integration-evidence.example.json
- mobile-release-evidence.example.json
- uat-evidence.example.json
- resilience-exercise-plan.example.json
- market-readiness-evidence.example.json
- deployment-rehearsal-evidence.example.json

The example files intentionally contain placeholders and blocked/draft states until real restricted evidence exists.

## Security and privacy boundary

Repository artifacts may contain only sanitized references.

Do not commit:

- provider secrets;
- private keys;
- access tokens;
- patient data;
- raw pentest reports;
- restricted infrastructure topology;
- production credentials.

Restricted evidence must remain in the approved evidence system and be referenced by non-secret identifiers.

## Merge boundary

Phase 31 does not authorize main merge or production.

productionAcceptance remains false.
mainMergeAllowed remains false.

No external gate can be automatically closed by a GitHub workflow.

## Database

No database migration.

## Environment

No new production environment variables.

No .env file is added.

## Validation

npm run v2:release-phase31


## Resilience plan versus executed evidence

The resilience workflow keeps `ops/release-1/resilience-exercise-plan.example.json` as a disabled draft catalog used by the automated contract.

The external Go-Live gate LIVE-06 uses the separate executed-evidence template:

`ops/release-1/resilience-exercise-evidence.example.json`

A green resilience contract proves the schema/guardrails only. LIVE-06 remains blocked until real production-equivalent failure-injection evidence, measured RPO/RTO results and approvals satisfy the executed-evidence template.
