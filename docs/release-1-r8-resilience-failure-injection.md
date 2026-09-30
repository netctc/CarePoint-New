# Release 1 R8 — Resilience, failure-injection and continuity evidence contract

Status: **repository contract implemented; production-equivalent execution remains required**.

Owners: R8 #88 / #90. Supporting engineering task: #110. Dependencies: #79, #80, #81 where native behavior is required, #89 for approved target-load context, #97 for the exact immutable RC artifact and #98 for deployment/rollback rehearsal.

## Purpose

Release 1 requires measured resilience evidence, not an inference from CI. The repository already contains deterministic recovery/security/functional controls, including the PostgreSQL logical backup/restore drill, but those controls do not prove Redis failover, managed PostgreSQL failover/PITR, real external-provider outages, worker lease recovery or end-to-end recovery objectives in the selected launch topology.

`.ci/release-resilience-contract.mjs` defines a machine-checkable **sanitized evidence contract** for the future production-equivalent rehearsal. It deliberately does not inject faults. The public repository must not contain destructive production commands, provider credentials, connection strings, real PHI, database dumps or restricted infrastructure details.

## Mandatory scenario catalog

The contract records every Release 1 failure family even when a conditionally scoped scenario is formally not applicable:

1. `notification-provider-outage` — unaffected reads, durable work retention, bounded retry, exactly-once-effective recovery and safe terminal-failure audit.
2. `notification-worker-lease-recovery` — worker termination/restart with lease recovery and no lost/duplicate durable jobs.
3. `psp-timeout-retry-webhook-replay` — timeout/error/retry plus event replay with no duplicate charge or financial transition and no false success.
4. `redis-loss-failover` — actual connection loss/failover, measured degradation/recovery, no retry storm and no unsafe duplicate side effects.
5. `postgres-primary-failover` — managed-primary failover with write integrity and no double booking.
6. `postgres-replica-lag` — required when the approved topology uses read replicas; otherwise a formally approved N/A record is required.
7. `postgres-pitr-restore` — isolated PITR/restore with schema and representative critical read/write verification.
8. `telehealth-provider-network-outage` — required when telehealth is enabled; must exercise the real provider room/join/media path rather than token minting alone.
9. `otlp-collector-outage` — telemetry outage must not create unsafe application failure, and exporter failure/recovery must remain observable.
10. `critical-workflow-failure-safety` — booking capacity, clinical-write atomicity/visible failure, unaffected reads, plus payment evidence and emergency-dispatch durability when those features are enabled.

The scope profile is evidence, not a code default. A scenario may be marked `NOT_APPLICABLE` only when the contract explicitly allows that decision from the approved feature/topology profile, and the N/A rationale and approval must be referenced.

## Continuity gates

The validator derives the measurements from supplied timestamps instead of trusting an isolated numeric claim:

- RPO is calculated from `recoveryPointReferenceAt - recoveredDataThroughAt` (floored at zero) and must be **<= 15 minutes**.
- RTO is calculated from `acceptedHealthyAt - incidentDeclaredAt` and must be **<= 120 minutes**.
- the stated `rpoMinutes` and `rtoMinutes` must match those timestamp-derived values within a small rounding tolerance;
- PITR evidence, restored-data/schema integrity, operations runbook, operator and handoff references are mandatory.

A CI restore remains supporting evidence only. #90 closes only after these measurements come from the approved production-equivalent Release Candidate exercise.

## Safety interlocks

Accepted evidence must identify the exact full source SHA and immutable `sha256:` RC artifact digest. The SHA must equal the checked-out candidate.

For a `production-equivalent` environment, the evidence must state that the environment is isolated and reference the isolation evidence. For `production`, explicit production fault-injection approval plus the approved change reference is mandatory. This contract does **not** grant that approval.

The sanitizer rejects common credential/PHI-like keys and credential-like values. Evidence fields are references to the approved evidence system rather than raw logs, requests, dumps, tokens or sensitive infrastructure material.

## Repository commands

Contract self-test:

```bash
node .ci/release-resilience-contract.mjs --self-test
```

Validate the disabled planning catalog:

```bash
node .ci/release-resilience-contract.mjs --validate-draft ops/release-1/resilience-exercise-plan.example.json
```

Generate immutable contract metadata for the checked-out SHA:

```bash
node .ci/release-resilience-contract.mjs \
  --contract-out ops/release-1/resilience-exercise-plan.example.json \
  resilience-contract.json
```

Validate a **completed, sanitized** rehearsal evidence document after controlled execution:

```bash
node .ci/release-resilience-contract.mjs \
  --validate /path/to/sanitized-resilience-evidence.json \
  --out resilience-validation.json
```

The final evidence document uses schema `carepoint.release-resilience-evidence/v1`. It must include release identity, environment/scope/topology, execution authorization, all scenario records, continuity timestamps/measurements, observability references and final approvals. The validator accepts only `PASS` for every applicable scenario.

## GitHub Actions contract gate

`.github/workflows/resilience-rehearsal-contract.yml` runs only safe repository checks:

- exact candidate checkout verification;
- validator self-test, including negative RPO/RTO, missing-scenario, required-assertion, secret/PHI-key and production-authorization cases;
- disabled draft-catalog validation;
- exact-SHA contract metadata generation;
- checksum verification and immutable artifact upload.

It does **not** contact the production-equivalent environment, invoke provider fault controls, stop Redis/PostgreSQL, trigger managed failover, execute PITR or run destructive commands. Therefore a green workflow is **not #90 closure evidence**.

## Existing supporting controls

The repository PostgreSQL Recovery workflow remains useful deterministic supporting evidence: it creates a source database and an isolated restore database, executes the C11 logical backup/restore drill, boots the API against the restored database and verifies temporary recovery artifacts are removed. It is not a measured managed-topology RPO/RTO rehearsal.

Likewise, the versioned #89 performance harness can supply approved traffic context for resilience scenarios, but a load-harness pass cannot substitute for the actual dependency failure or continuity exercise.

## Exit criteria retained from #90

#90 remains open until the exact immutable Release Candidate is exercised in the approved production-equivalent topology, every applicable failure scenario passes, RPO <= 15 minutes and RTO <= 120 minutes are measured, critical workflow integrity is verified, real provider behavior is covered where enabled, blocking defects are fixed/retested, and Operations/SRE/Database/Security/Product plus Clinical when required accept the sanitized evidence.

`main` remains unchanged until final Go/No-Go and controlled promotion.
