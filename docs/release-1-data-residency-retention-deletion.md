# Release 1 — Data Residency, Retention & Deletion Controls

## Purpose and source-of-truth note

This artifact records the Release 1 implementation boundary for blocker #77 and its dependencies on R3 #79 and the later regulatory/market gate.

The approved functional/technical specification requires configurable retention, privacy/data minimization and data residency according to the deployment country/jurisdiction. It also requires the cloud region to be selected accordingly and treats audit/security evidence as governance material.

There is an R2 tracker naming variance that must remain explicit: the approved source identifies `FR-DAT-001` as sensitive-field database encryption, `FR-DAT-002` as encrypted document storage, `FR-DAT-003` as audit/SIEM integrity and `FR-DAT-004` as policy-based retention (P1). Release 1 nevertheless treats the privacy NFR/data-residency requirement and the R2-promoted retention/deletion gate in #77 as Go-Live blockers. This implementation does not rewrite the source requirement codes or silently promote a different legal retention schedule.

## Release 1 residency contract

Production startup now runs a fail-closed data-governance preflight before serving traffic. Production must explicitly provide:

- `DATA_RESIDENCY_JURISDICTION` — the approved launch jurisdiction identifier;
- `DATA_RESIDENCY_REGION` — the approved data-bearing cloud region;
- `DATA_RESIDENCY_POLICY_VERSION` — the approved residency policy/version reference;
- `DATA_RESIDENCY_EVIDENCE_REFERENCE` — the R3 infrastructure evidence reference;
- `DATABASE_DEPLOYMENT_REGION` and `REDIS_DEPLOYMENT_REGION` — declared data-service regions;
- `AWS_REGION` matching `DATA_RESIDENCY_REGION`.

The existing production object-storage/KMS preflights validate the S3 bucket and application KMS resources against `AWS_REGION`; therefore the new region equality rule links those existing technical checks to the approved residency target. PostgreSQL and Redis region values are deployment declarations and do **not** prove the managed-service geography by themselves. R3 must still attach provider/control-plane evidence for the actual database, Redis, backup/PITR and failover locations.

No country, regulator, cloud region or legal geography is embedded in source code.

## Explicit retention policy

`DATA_RETENTION_POLICY_JSON` is mandatory in production and is versioned. Every Release 1 class must have an explicit rule:

- `AUTH_EPHEMERAL`;
- `IDENTITY_PROFILE`;
- `CLINICAL_RECORD`;
- `CLINICAL_DOCUMENT`;
- `DIAGNOSTIC_REPORT`;
- `CONSENT`;
- `FINANCIAL`;
- `COMMUNICATION`;
- `AUDIT_SECURITY`.

`PRESERVE` rules carry no retention period. A `DELETE`/`PURGE` rule must provide an explicitly approved positive `retentionDays`; the repository contains no production default period. Production refuses destructive policy execution unless `DATA_RETENTION_EXECUTION_ENABLED=true`, an approved `DATA_RETENTION_APPROVAL_REFERENCE` exists and `DATA_RETENTION_EXECUTION_MODE` is explicitly `manual` or `scheduled`.

Release 1 intentionally supports destructive actions only where a bounded lifecycle exists:

| Data class | Release 1 destructive action | Lifecycle |
| --- | --- | --- |
| AUTH_EPHEMERAL | DELETE | Expired/consumed MFA challenges and expired/revoked sessions past the approved cutoff |
| CLINICAL_RECORD | DELETE | Encrypted clinical record rows past cutoff when no applicable hold exists |
| CLINICAL_DOCUMENT | PURGE | Delete encrypted object where present, remove access metadata/keys and leave a pseudonymous tombstone |
| DIAGNOSTIC_REPORT | DELETE | Encrypted report rows past cutoff when no applicable hold exists |
| COMMUNICATION | DELETE | Closed encrypted care conversations past cutoff; relation cascades remove message/read-receipt rows |
| IDENTITY_PROFILE | — | PRESERVE only in Release 1 |
| CONSENT | — | PRESERVE only in Release 1 |
| FINANCIAL | — | PRESERVE only in Release 1 |
| AUDIT_SECURITY | — | PRESERVE only; generic retention cannot hard-delete audit/security evidence |

A policy demanding a destructive lifecycle for a preserve-only class fails validation instead of silently deleting data.

## Legal, clinical and regulatory holds

Release 1 adds persistent retention holds with three scopes:

- `DATA_CLASS` — holds an entire class;
- `PATIENT` — holds all or one specified class for an opaque patient identifier;
- `OBJECT` — holds an explicitly typed opaque object identifier for one class.

Allowed reason codes are deliberately bounded to `LEGAL`, `CLINICAL`, `REGULATORY` and `INVESTIGATION`. Holds use opaque approval references, optional expiry and explicit release. There is no free-text hold reason field, reducing the chance that PHI is copied into governance/audit metadata.

Only the new `DATA_GOVERNANCE_MANAGE` permission can inspect/govern holds or trigger a retention run; Release 1 grants that permission only to `ADMIN`.

## Controlled execution and evidence

The API exposes an administrative governance surface:

- `GET /api/v1/data-governance/status`;
- `GET /api/v1/data-governance/holds`;
- `POST /api/v1/data-governance/holds`;
- `POST /api/v1/data-governance/holds/:holdId/release`;
- `POST /api/v1/data-governance/retention/run` with `DRY_RUN` or `EXECUTE`.

`EXECUTE` additionally requires the request approval reference to match the deployment-approved `DATA_RETENTION_APPROVAL_REFERENCE`. The request cannot supply a different cutoff, retention period, arbitrary table or arbitrary SQL; it can only apply the pre-approved versioned policy.

Retention audit events contain policy version, mode, class/count summaries, hold identifiers/reason codes and hashed approval references. They do not place patient names, emails, clinical contents, document contents or retention target IDs into retention-run metadata. Existing generic audit remains immutable to this engine.

## Object storage and database behavior

Clinical-document purge deletes the encrypted object through the existing `DocumentStorageService`, which maps to private local storage in test/development and `DeleteObject` against the production S3 bucket. The database row is then converted to a non-readable tombstone: object key and content/cryptographic material are cleared, metadata ciphertext is replaced by a retention tombstone marker, provider/encounter/order/account linkage is removed and patient linkage is replaced with a one-way pseudonym.

This gives Release 1 an explicit DB + object-storage lifecycle without claiming that S3 lifecycle rules alone satisfy patient/document retention. Bulk FHIR export artifacts continue to use their separate pre-existing S3 lifecycle preflight.

## Automated acceptance

`release1-data-governance-preflight-smoke.mjs` runs in the API test chain and proves:

- non-production startup does not invent production residency configuration;
- production fails closed when any residency declaration/evidence reference is absent;
- database, Redis and AWS data regions must match the approved residency region;
- all retention classes are mandatory;
- destructive rules require an approved execution gate/reference/mode;
- preserve-only classes reject unsupported destructive actions;
- generic audit deletion is forbidden.

`release1-data-governance-lifecycle-smoke.mjs` runs inside the existing Slice 5 acceptance after migrations are deployed. With synthetic data only, it proves:

- policy/status parsing;
- dry-run does not mutate data;
- wrong execution approval is denied;
- patient-scoped legal hold prevents clinical-record deletion;
- unheld expired clinical record is deleted;
- clinical-document encrypted object is deleted and its row is pseudonymized/tombstoned;
- diagnostic report and closed care conversation are removed under their configured policy;
- immutable audit/security sentinel survives;
- releasing a hold allows the approved policy on the next run;
- retention audit evidence contains no fixture email, patient identifier, name or encrypted clinical payload.

## Release acceptance status

Repository implementation can move #77 to **CODE COMPLETE / R3 + REGULATORY ACCEPTANCE CONDITIONAL** only after the exact candidate SHA passes CI/Security/PostgreSQL Recovery/FHIR validation.

It must **not** be marked production-compliant from code alone. Final Go-Live still requires named owners to supply and approve the actual launch jurisdiction, exact cloud regions, legal/clinical retention periods, destructive-vs-preserve decisions, hold governance, infrastructure evidence and any regulator/clinical-record obligations. R3 #79 must verify actual hosting/backup/failover geography. The regulatory/market gate must approve the legal retention/deletion schedule and evidence reference before production execution is enabled.
