# Release 1 — R10 Deployment, Migration & Rollback Rehearsal Contract

Status: **SOURCE-SIDE CONTRACT IMPLEMENTED / REAL REHEARSAL STILL BLOCKED**  
Tracker: #96  
Primary blocker: #98  
Canonical branch: `release/release-1-integration-go-live-readiness`

## 1. Purpose

This document defines the repository-side evidence contract for the Release 1 production-equivalent deployment, database migration, application rollback and PITR rehearsal required by #98.

It intentionally does **not** select or emulate a production deployment platform. The current CarePoint application repository still has no authoritative Terraform/CDK/CloudFormation, Kubernetes/Helm, Dockerfile or equivalent production deployment/IaC package, and #79 still requires the real infrastructure/control-plane evidence. The contract therefore makes the real rehearsal auditable without pretending that application CI is production acceptance.

## 2. Non-deployment boundary

`.github/workflows/deployment-rehearsal-contract.yml` is a contract-validation workflow only. It:

- binds itself to the exact Release branch head SHA under PR validation;
- self-tests the evidence validator and mandatory negative cases;
- inventories the exact Prisma migration set using the same aggregate algorithm as the R10 RC evidence bundle;
- emits static migration review flags for human/production-like review;
- uploads a checksum-verified immutable workflow artifact.

It does **not** deploy CarePoint, modify a database, contact production providers, trigger failover, execute rollback, execute PITR, choose a rollout strategy, approve a release or close #98.

## 3. Contract tooling

Validator:

`.ci/release-rehearsal-contract.mjs`

Supported modes:

- `--self-test` — validates a synthetic complete rehearsal record and proves mandatory invalid records are rejected;
- `--inventory <out.json>` — produces the exact migration inventory and static review flags for the current checkout;
- `--validate <evidence.json> --out <validation.json>` — validates a sanitized real rehearsal evidence record against the exact checkout and migration set.

The example input is:

`ops/release-1/deployment-rehearsal-evidence.example.json`

The example deliberately contains non-PASS placeholders/false values. It must be populated only from an actual authorized rehearsal; it is not reusable acceptance evidence.

## 4. Exact source and immutable artifact binding

A real evidence record must bind:

- the approved RC version;
- the exact full 40-hex source SHA, equal to the validator checkout;
- the exact migration-set SHA-256 computed from that checkout;
- immutable API and Admin `sha256:` artifact digests from #97;
- the previous approved version, full source SHA and immutable API/Admin artifact digests used for rollback.

The deployed runtime-observed source SHA must equal the candidate SHA. After rollback, the runtime-observed source SHA must equal the previous approved SHA. This prevents a rehearsal from reporting success while exercising different builds.

## 5. Migration inventory and static risk review

The migration inventory uses the same deterministic aggregate as the RC evidence generator. For every sorted migration directory it records:

`migration name + SQL SHA-256 + byte size`

and hashes the aggregate sequence. This value must equal `release.migrationSetSha256` in real rehearsal evidence.

The inventory also flags SQL patterns that require explicit human/production-like review, including destructive schema operations, `TRUNCATE`, data `UPDATE`/`DELETE`, `ALTER TABLE`, `ALTER TYPE`, constraints, not-null/type changes, trigger/function changes and indexes created without `CONCURRENTLY`.

These flags are **not compatibility verdicts**. An additive migration can still lock a large table; an enum or function change can still affect rollback; an operation that is safe on an empty CI database can still be unsafe at production volume. #98 still requires the actual migration review, compatibility decision and production-like execution evidence.

## 6. Pre-deployment evidence

The real record must prove, through sanitized references rather than sensitive values:

- the target is explicitly classified as `production-equivalent` or `production`;
- backup/PITR readiness is confirmed;
- runtime configuration/readiness is accepted;
- enabled launch-provider readiness is recorded;
- the exact migration set has an approved compatibility/lock/data-risk review.

The repository does not infer any of these from configuration declarations alone. #79 remains authoritative for real PostgreSQL/Redis/storage/KMS/edge/worker/observability topology and #80 for enabled external providers.

## 7. Deployment evidence

The contract accepts only an explicitly recorded platform-approved strategy:

- `rolling`;
- `canary`;
- `blue-green`;
- `platform-approved-other` with a supporting strategy reference.

Engineering does not choose the launch strategy in this source contract. The platform/Release CAB owners must select it based on the real production architecture.

Deployment evidence must include timestamps, runtime release identity, health/readiness evidence, P0 smoke evidence and an explicit safety-signal PASS. Numerical rollback/SLO thresholds other than the already approved Release 1 RPO/RTO objectives are deliberately not invented here; Release CAB/SRE/Product/Security/Clinical owners must approve them.

## 8. Application rollback evidence

The rehearsal must actually execute a controlled rollback to the previous immutable approved artifacts. The record must prove:

- an approved rollback trigger/test reference;
- start/completion timestamps;
- previous source SHA observed from runtime after rollback;
- post-rollback health/readiness and P0 smoke evidence;
- reconciliation of durable/external side effects.

Payment callbacks/webhooks, notification outboxes, SIEM work, other durable workers and enabled provider operations must be considered when relevant so rollback does not create duplicate, lost or orphaned side effects.

## 9. PITR and continuity evidence

A real accepted record must state that PITR/recovery was rehearsed and include measured values satisfying the approved Release 1 objectives:

- RPO <= 15 minutes;
- RTO <= 120 minutes.

The validator rejects larger values. This is only a consistency gate over recorded evidence; it does not measure recovery itself. Actual production-equivalent measurement remains jointly owned by #90 and #98.

## 10. Required acceptance ownership

The contract requires affirmative Release, Operations, SRE, Security, Database and Product acceptance. If clinical approval is required for the exercised launch scope, Clinical acceptance must also be affirmative. A final rehearsal-accepted decision and restricted approval reference are mandatory.

This does not replace the wider Release 1 dependencies. R6/R7/R8/R9, market/privacy/clinical approval, mobile acceptance and promotion protection remain separate gates.

## 11. Sanitized evidence policy

Public repository evidence must contain references and hashes only. The validator rejects common credential-bearing key names, private-key blocks, bearer/JWT-like values, URL basic-auth patterns and obvious token/secret query parameters. It also rejects common direct patient-identification key names.

Do not put PHI, credentials, private keys, provider secrets, production database dumps, exploit details or restricted infrastructure internals in GitHub. Store authoritative evidence in the approved restricted system and use sanitized immutable references here.

## 12. Self-test negative cases

The contract self-test proves rejection of at least:

- a candidate source SHA different from the checkout;
- a deployed runtime SHA different from the candidate;
- a rollback runtime SHA different from the previous approved release;
- a migration-set digest different from the checkout;
- RPO > 15 minutes;
- RTO > 120 minutes;
- a credential-like key in the evidence payload;
- missing/false PITR readiness;
- missing/false Security approval.

A green self-test means the contract enforces these invariants. It does not mean an actual rehearsal occurred.

## 13. #98 execution sequence once external prerequisites exist

When #79/#97 and the final operational inputs are available:

1. freeze the final RC source SHA/version and immutable API/Admin artifacts;
2. generate the migration inventory from that exact SHA and complete the migration compatibility review;
3. record the previous deployed immutable artifacts/schema baseline;
4. confirm backup/PITR, runtime/provider readiness, owners, rollback authority and approved trigger thresholds;
5. deploy using the selected platform-approved strategy;
6. verify exact runtime identity, readiness, P0 smokes and safety signals;
7. execute the controlled application rollback and reconcile side effects;
8. execute/measure the approved isolated PITR/recovery rehearsal;
9. populate a sanitized `carepoint.release-rehearsal/v1` record;
10. validate it against the exact RC checkout and retain the validation output plus restricted evidence references for Release CAB.

## 14. Exit boundary

This repository-side contract materially advances #98 by making future deployment/rollback evidence deterministic, exact-SHA-bound and machine-checkable. It does **not** close #98 or R10.

#98 remains BLOCKED until the actual production-equivalent environment, previous/current immutable artifacts, migration/schema baseline, real backup/PITR checkpoint, approved deployment/rollback authority, enabled-provider topology and real rehearsal results exist. #97 remains open until its final deployable artifacts/provenance are complete. #84 remains open until promotion paths are protected. #81 remains open until native signed mobile artifacts/device acceptance exist.

`main` must remain unchanged until the final Release 1 Go/No-Go authorizes promotion.
