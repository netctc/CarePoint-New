# Phase C11 — PostgreSQL Disaster Recovery Verification

## 1. Objective

Phase C11 closes the gap between **database recovery configuration** and **proven recoverability**.

Phase C5 already validates that production PostgreSQL is reachable over TLS, writable, sufficiently current, and configured for the declared HA/PITR operating model. Those controls establish readiness, but they do not prove that a backup can actually be restored into a clean database and used by CarePoint.

C11 therefore adds an executable logical disaster-recovery drill that:

1. creates a source PostgreSQL 16 cluster;
2. applies the full CarePoint Prisma migration history;
3. writes a synthetic PHI-free integrity fixture;
4. creates a PostgreSQL custom-format logical backup;
5. restores that archive into a **second independent PostgreSQL 16 cluster**;
6. verifies data, relations, migration history and database constraints;
7. starts the CarePoint API against the restored cluster;
8. requires the restored API health endpoint to become healthy;
9. deletes the temporary dump, restore listing and API log before the CI job finishes.

The result is a reproducible proof that the current CarePoint schema and application can survive a logical backup/restore cycle.

## 2. Relationship to Phase C5

C5 and C11 solve different problems and both remain required.

| Control | Question answered |
| --- | --- |
| C5 PostgreSQL readiness | Is the live database configured safely for production, including TLS, writable-primary routing, HA declarations and PITR prerequisites? |
| C11 recovery drill | Can the current CarePoint database actually be backed up, restored into a clean PostgreSQL 16 cluster, pass integrity checks and boot the application? |

For `DATABASE_PITR_MODE=managed`, C5 intentionally cannot prove the cloud/provider restore operation from the PostgreSQL protocol alone. C11 supplies a repository-controlled logical recovery proof, while the production provider's native PITR/backup restore must still be exercised periodically in an isolated staging/DR environment.

## 3. CI topology

Permanent workflow:

```text
.github/workflows/postgres-recovery.yml
```

The workflow creates three isolated services:

```text
source-postgres:16        restore-postgres:16
127.0.0.1:55432           127.0.0.1:55433
DB: carepoint             DB: carepoint_restore
        |                         ^
        |                         |
        +-- pg_dump -Fc ----------+
                    pg_restore

redis:7-alpine
127.0.0.1:56379
```

Using separate PostgreSQL service containers avoids the weaker test of restoring into a second database on the same server process. Source and restore clusters have independent PostgreSQL data directories and lifecycle.

## 4. Backup format

C11 uses PostgreSQL's custom archive format:

```bash
pg_dump --format=custom --no-owner --no-privileges
```

The archive is restored with `pg_restore` rather than replayed as plain SQL.

The custom archive is appropriate for a deterministic recovery test because it preserves PostgreSQL object metadata in a structured archive and can be inspected with `pg_restore --list` before restoration.

C11 requires the archive list to contain at least:

- `AuditEvent`;
- `SiemAuditDelivery`;
- `_prisma_migrations`.

This ensures the dump contains both application schema/data and the migration ledger needed to establish application/schema compatibility.

## 5. Transactional restore

The restore command includes:

```text
--exit-on-error
--single-transaction
--no-owner
--no-privileges
```

Consequences:

- the drill does not silently continue after a restore error;
- object creation/data load is committed as one restore transaction where supported by PostgreSQL restore semantics;
- source ownership and privilege metadata do not make the archive dependent on the CI source cluster's role ownership;
- a failed restore is a failed C11 gate, not a warning.

The target database is created empty by the independent PostgreSQL service and is not pre-migrated before `pg_restore`.

## 6. Synthetic PHI-free recovery fixture

Fixture script:

```text
.ci/postgres-recovery-fixture.mjs
```

The fixture intentionally uses infrastructure/audit entities rather than patient, clinical-document or secure-message data.

It creates:

- one `AuditEvent` with action `C11_RECOVERY_DRILL`;
- one related `SiemAuditDelivery`;
- fixed synthetic UUIDs;
- a fixed test timestamp;
- PHI-free metadata identifying the logical recovery drill.

No real patient information, production credential or externally sourced payload is introduced into the dump.

### Source validation

Before backup, the fixture verifies that the number of successfully applied `_prisma_migrations` equals the number of migration directories committed in the repository.

This prevents the drill from backing up a source database that is already behind the codebase.

## 7. Post-restore integrity verification

After `pg_restore`, the fixture runs in `verify` mode against the restored database.

It checks:

- the synthetic `AuditEvent` exists;
- semantic fields and timestamp are unchanged;
- JSON metadata is unchanged;
- the `AuditEvent -> SiemAuditDelivery` relation is intact;
- delivery lifecycle fields are unchanged;
- restored `_prisma_migrations` count equals repository migration count;
- the unique constraint on `SiemAuditDelivery.auditEventId` still produces Prisma `P2002` when violated;
- the foreign key from `SiemAuditDelivery` to `AuditEvent` still produces Prisma `P2003` when violated.

This tests more than row counts: it proves critical relational semantics survived the backup/restore cycle.

Expected integrity marker:

```text
Phase C11 restored database integrity verified: <N> migrations
```

## 8. Prisma migration-state verification

After fixture integrity checks, C11 runs:

```bash
npx prisma migrate status --schema services/api/prisma
```

with `DATABASE_URL` pointing to the restored cluster.

The restored database must therefore be recognized by the current Prisma migration history as an application-compatible database, not merely a database containing selected tables.

## 9. Application boot on the restored database

C11 switches the application connection string from the source cluster to the restored cluster before starting the API:

```text
DATABASE_URL = C11_RESTORE_DATABASE_URL
```

It then starts the built CarePoint API on an isolated CI port and polls:

```text
/api/v1/health
```

The drill succeeds only when the application becomes healthy using the restored PostgreSQL database.

Expected final marker:

```text
Phase C11 PostgreSQL disaster recovery acceptance passed
```

This closes an important class of false confidence where `pg_restore` completes but the restored schema cannot actually support the current application binary.

## 10. Backup artifact handling

The C11 archive is a temporary CI test artifact, even though it contains only synthetic CI data.

Controls:

- `umask 077` is applied before artifact creation;
- the dump is explicitly set to mode `0600`;
- dump, archive listing and restored-API log live only under `/tmp`;
- an `EXIT` trap removes all three files;
- the workflow has no `upload-artifact` step;
- the workflow explicitly verifies the files no longer exist after the drill.

Production backup archives must follow stronger environment-specific controls for encryption, access, retention, immutability and geographic placement. Those controls belong to the production backup platform/IaC and are not inferred from this CI drill.

## 11. Security and encryption dependencies

A successful database restore does not by itself guarantee that historical encrypted application data can be decrypted.

CarePoint envelope-encrypted records and HMAC attestations retain the concrete KMS key identifiers that created them. Therefore the C8 retention rule also applies to disaster recovery:

> Do not disable or schedule deletion of an old KMS key while any retained backup or restored CarePoint data may reference that key.

A production DR exercise containing encrypted historical data must verify both:

1. PostgreSQL recovery; and
2. continued access to every required historical KMS key under the DR workload identity/key policy.

## 12. What C11 proves

The automated C11 workflow proves, on every validation PR and `main` change:

- the current migration chain can create the source database;
- PostgreSQL 16 can create a custom-format logical backup of that database;
- the archive contains required application/migration objects;
- an independent clean PostgreSQL 16 cluster can restore it transactionally;
- representative data, JSON, relation, unique and foreign-key semantics survive;
- Prisma recognizes the restored migration history;
- the current CarePoint API can start and report healthy against the restored database;
- the CI backup artifact is removed rather than retained.

## 13. What C11 does not prove

C11 must not be interpreted as evidence for all production DR requirements.

It does **not** prove:

- provider-native PITR restore correctness;
- production backup encryption/immutability settings;
- cross-region failover;
- DNS/load-balancer cutover;
- production-scale restore duration;
- the organization's required RPO or RTO;
- restoration of object-storage documents or other external provider state;
- KMS access from a real DR account/region;
- business continuity staffing/escalation procedures.

These require periodic environment-level DR exercises.

## 14. Production DR runbook

A production or pre-production DR exercise should use an isolated recovery environment and never restore over the live production primary.

Recommended sequence:

1. record the recovery objective and recovery point being tested;
2. provision an isolated target network/database with production-equivalent PostgreSQL major version and security controls;
3. obtain the selected provider backup/PITR recovery point through the approved backup system;
4. restore into the isolated target;
5. verify migration state against the intended CarePoint release;
6. verify historical KMS keys required by restored ciphertext/attestations are accessible to the DR workload identity;
7. start the intended CarePoint release against the restored database;
8. run health and selected business-integrity checks using controlled test identities;
9. verify audit/SIEM/observability behavior without leaking restored PHI;
10. measure actual recovery point and recovery duration against the organization's formally approved RPO/RTO;
11. document discrepancies and corrective actions;
12. securely destroy the isolated restored environment after the exercise according to data-retention/security policy.

C11 deliberately does not invent numeric RPO/RTO targets. Those values are business/compliance decisions that must be formally approved for the KSA/GCC production operating model.

## 15. Frequency

The permanent C11 workflow runs:

- on every pull request;
- on pushes to `main`;
- weekly on a scheduled run.

The weekly run detects recovery regressions even when no application change has recently touched database code.

Provider-native DR/PITR exercises should have a separately approved operational frequency based on CarePoint's production RPO/RTO, regulatory obligations and change cadence.

## 16. Deterministic C11 static acceptance

The normal API acceptance chain contains:

```bash
npm --workspace @carepoint/api run c11:postgres-recovery
```

This static gate does not perform the expensive second-cluster restore. Instead it protects the recovery workflow itself from silent weakening.

It verifies, among other controls:

- two distinct PostgreSQL services/ports exist;
- the restore cluster uses a clean database;
- `pg_dump --format=custom` remains required;
- `pg_restore --exit-on-error --single-transaction` remains required;
- source and restored fixture verification remain present;
- Prisma migration status is checked on the restored database;
- `DATABASE_URL` is switched to the restored cluster before API startup;
- the restored `/health` probe remains required;
- recovery artifacts are cleaned and never uploaded;
- the fixture remains synthetic/PHI-free;
- unique and foreign-key recovery checks remain present.

Expected marker:

```text
Phase C11 PostgreSQL recovery gate acceptance passed
```

## 17. CI acceptance criteria

C11 is complete only when the exact final branch head passes all four permanent validation workflows:

### Normal CI

- C2 canonical package count/hash unchanged;
- high-severity npm audit reports zero vulnerabilities;
- build succeeds;
- C1 and C3–C11 deterministic acceptance chain succeeds;
- all Prisma migrations/bootstrap succeed;
- IAM persistence succeeds;
- Admin B1–B9 succeeds;
- application Slice 2–9 succeeds;
- Flutter shared/mobile tests and analyses succeed.

### FHIR

- Slice 10.0–10.13 succeeds.

### Security Analysis

- Repository Security Gate succeeds;
- CodeQL JavaScript/TypeScript `security-extended` succeeds.

### PostgreSQL Recovery

- source fixture seed succeeds;
- custom-format backup succeeds;
- archive inspection succeeds;
- independent restore succeeds;
- restored integrity/migration checks succeed;
- CarePoint API boots against the restored cluster;
- final recovery marker is emitted;
- temporary recovery artifacts are absent at job completion.

As with previous stacked phases, the temporary validation PR must be closed **without merge** after the branch itself has been proven green.
