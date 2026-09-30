# Release 1 R3 production infrastructure acceptance evidence contract

Status: repository-side acceptance mechanism only. This document and its validator do **not** claim that a production or production-equivalent CarePoint environment has been provisioned, tested, approved or shown to meet Release 1 recovery objectives.

Tracked by #116, parent #79 and master #70.

## Purpose

R3 already defines the production-infrastructure acceptance scope, while the application contains extensive production preflights for PostgreSQL, Redis, KMS, private object storage, telemetry/SIEM, workers and security boundaries. The remaining problem is that final environment evidence can otherwise be recorded in inconsistent formats and can drift away from the exact Release Candidate that was validated.

`.ci/release-infrastructure-evidence-contract.mjs` provides a strict versioned validator for a sanitized final evidence record. `ops/release-1/production-infrastructure-evidence.example.json` is intentionally `approved=false` / `overallStatus=DRAFT`; it is a collection template, not evidence of readiness.

## Final validation command

Check out the exact Release Candidate SHA, populate a sanitized evidence file from the approved infrastructure/control-plane records, then run:

```bash
node .ci/release-infrastructure-evidence-contract.mjs --validate /path/to/release-1-infrastructure-evidence.json --out /path/to/validated-summary.json
```

The validator resolves `git rev-parse HEAD` and fails if the evidence `release.sourceSha` differs from that exact checkout.

## Release identity and environment binding

Final evidence must identify the full 40-character Release Candidate SHA, release version, immutable API digest, immutable Admin digest and Release Candidate evidence reference. The environment must be explicitly classified as `production-equivalent` or `production` and carry non-secret topology/change evidence references.

Validation against production additionally requires an explicit production validation/change approval flag. This repository validator never executes infrastructure changes, faults, database operations or provider actions.

## Residency and data-location gate

The evidence must carry the approved launch jurisdiction, primary region, complete approved-region set, approval reference and independent managed-provider/control-plane location evidence reference. No country or cloud region is supplied by the repository.

All applicable destination records must contain one or more regions and every recorded region must be present in the approved-region set. The required destination records are:

- PostgreSQL primary, HA replicas and backup/PITR copies;
- Redis primary and HA replicas;
- clinical object storage;
- KMS/key-material location;
- OTLP processing destination;
- SIEM processing destination;
- exported artifacts when exports are enabled;
- FHIR Bulk artifacts when FHIR Bulk is enabled.

This is a consistency gate over supplied approved evidence. A declared region is not independent proof of a provider's real resource geography; #79 still requires control-plane/provider evidence.

## Infrastructure control families

The final evidence contains 28 required control records covering PostgreSQL TLS/version, HA/failover, PITR/restore and pooling; Redis TLS/auth, HA/persistence and reconnect monitoring; private encrypted object storage and lifecycle/recovery; customer-managed KMS, least privilege, key rotation/recovery and external-secret rotation; clinical upload malware protection and DICOM/PACS security where enabled; OTLP/SIEM safety and backlog alerting; DNS/TLS/proxy/CORS/security-header edge behavior; notification/SIEM/FHIR and scheduled worker execution; multi-replica lease/idempotency behavior; export lifecycle/residency; and DR/post-recovery integrity.

Mandatory controls must be `APPLICABLE` + `PASS`. Conditional controls may be `NOT_APPLICABLE` only when the approved scope disables that feature, and the record must carry both a rationale reference and an approval reference. UI or configuration assertions without environment evidence are not sufficient.

Every control also records an owner, check timestamp, evidence reference and revalidation date. Revalidation cannot precede the check date.

## Continuity measurements

R3 and R8 share the approved Release 1 continuity objectives. Final infrastructure evidence therefore includes measured PITR/restore/failover/integrity references and timestamps from which the validator recomputes:

- RPO: maximum 15 minutes;
- RTO: maximum 120 minutes.

The stated values must match the supplied timestamps and the validator rejects evidence above either ceiling. A CI restore or a synthetic contract self-test is not a production-equivalent recovery measurement.

## Approval boundary

Final evidence requires explicit `APPROVE` records from Operations, SRE, Database, Security, Privacy and Product, each with approver/evidence references and approval time. The repository does not invent these approvals and the example file intentionally leaves all decisions `PENDING`.

Legal/regulatory launch approval, provider contracts, market licensing and clinical-safety activation remain owned by the corresponding R9/R4 workstreams; this R3 contract must not be interpreted as substituting for them.

## Sensitive-data rules

The evidence is deliberately reference-oriented. The validator rejects common credential-bearing keys and values, bearer/JWT-like material, embedded URL credentials, private-key blocks and PHI-like patient identifiers. Keep credentials, private keys, database dumps, real PHI, detailed network secrets and restricted infrastructure/exploit evidence in the approved restricted systems. Public GitHub should contain only sanitized status and immutable references/digests where policy permits.

## CI contract gate

`.github/workflows/production-infrastructure-contract.yml` performs only repository-contract validation:

1. checks out the exact pull-request head SHA;
2. confirms checkout identity;
3. runs the validator self-test, including negative/fail-closed cases;
4. verifies that the example remains a non-approved DRAFT with all required control/destination/approval records;
5. generates a sanitized contract artifact containing the exact source SHA and SHA-256 fingerprints of the validator/template.

The workflow does **not** provision infrastructure, contact production services, inject faults, assert a launch jurisdiction, approve a region or set `productionAcceptance=true`.

## Closure rule

Completing #116 means the evidence format and machine-checking mechanism are validated. #79 must remain open until the actual intended production/staging-equivalent topology has been provisioned and independently evidenced, the exact final RC artifacts are deployed, real preflight/recovery/failover checks are performed, RPO/RTO are measured, and the required owners accept the resulting sanitized record.
