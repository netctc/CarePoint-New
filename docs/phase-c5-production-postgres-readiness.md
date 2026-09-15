# Phase C5 - Production PostgreSQL Readiness

## Purpose

Phase C5 closes the managed PostgreSQL production gap left explicit in Slice 9. PostgreSQL is the durable source of truth for CarePoint identity, clinical, financial, scheduling, audit and durable FHIR Bulk Data state. The API must therefore fail closed when production points to an unauthenticated/local/plaintext/read-only/unsupported database endpoint or when the declared HA/PITR strategy is inconsistent with signals that PostgreSQL itself can expose.

C5 starts from the fully accepted Phase C4 head `963cd4eb1c3b2028d183515d4367be9a3dd90f83`.

## Shared connection policy

`databaseRuntimeConfiguration()` is used by both:

- the C5 startup preflight before NestJS is created; and
- the long-lived `PrismaService` runtime client.

This mirrors the C4 Redis pattern and prevents production from being validated under one database URL policy while Prisma later connects under another.

## Production DATABASE_URL requirements

Production `DATABASE_URL` must:

- use `postgresql://` or `postgres://`;
- contain non-empty database credentials;
- target a non-loopback host;
- set `sslmode=require`, `verify-ca` or `verify-full`;
- not opt into invalid TLS certificate acceptance;
- set an explicit positive Prisma `connection_limit`.

`verify-full` is the recommended TLS mode whenever the deployment/provider certificate chain supports it. `sslmode=require` is accepted because some managed PostgreSQL/Prisma deployments expose this mode, but C5 independently requires the active server session to appear in `pg_stat_ssl` so encryption-in-transit is actually observed.

Credentials/tokens belong in the deployment secret manager. C5 sanitizes preflight errors so the full database URL, database password and user are redacted if an underlying client error includes them.

## Explicit pooling mode

Production requires `DATABASE_POOL_MODE`:

### `direct`

Prisma connects directly to the PostgreSQL endpoint. The explicit `connection_limit` is mandatory so application instances cannot silently derive an uncontrolled pool size from host CPU count.

### `pgbouncer`

The URL must additionally include `pgbouncer=true`, keeping Prisma behavior explicit for transaction-pooling deployments.

### `managed`

Use when a provider proxy/pool service handles the intermediate connection layer. C5 still validates the CarePoint-to-endpoint URL and the SQL session that reaches PostgreSQL, but it does not claim that provider proxy capacity/failover has been proven from SQL.

## SQL readiness inspection

The live preflight uses a short-lived Prisma client and one read-only metadata query. No persistent CarePoint row/table is written.

It verifies:

- PostgreSQL server version (`server_version_num`);
- TLS is active for the backend session via `pg_stat_ssl`;
- the endpoint is not in recovery (`pg_is_in_recovery() = false`);
- the active transaction/session is not read-only;
- `wal_level`;
- `archive_mode`;
- whether `archive_command` is configured;
- count of streaming replicas visible in `pg_stat_replication`.

The default minimum supported server major is PostgreSQL 16, configurable through `DATABASE_MIN_SERVER_MAJOR` only when the release architecture deliberately changes.

## HA modes

Production requires `DATABASE_HA_MODE`.

### `replicated`

CarePoint requires at least `DATABASE_MIN_STREAMING_REPLICAS` rows in `pg_stat_replication` with `state='streaming'` (default 1).

This mode is appropriate when the primary directly exposes its PostgreSQL streaming standby topology to the application role/session.

### `managed`

Use for provider HA implementations whose standby/multi-AZ topology is intentionally hidden from `pg_stat_replication`. C5 does not pretend to infer multi-AZ/failover state from missing SQL metadata; release acceptance must provide provider evidence for topology and failover behavior.

## PITR modes

Production requires `DATABASE_PITR_MODE`.

### `native`

C5 requires:

- `wal_level=replica` or `logical`;
- `archive_mode=on` or `always`;
- a configured non-disabled `archive_command`.

These are prerequisites for PostgreSQL-native WAL archival but do not alone prove archive storage health or restore success.

### `managed`

Use when PITR/backups are supplied by the database provider outside normal PostgreSQL archive settings. C5 remains transparent: SQL startup readiness passes without claiming provider backup retention or restore capability. Those controls require provider/release evidence.

## Startup sequence

Production now starts in this order:

```text
Phase C1 application KMS preflight
    |
    v
Phase C3 private object-storage preflight
    |
    v
Phase C5 PostgreSQL preflight
    |
    +--> validate production DATABASE_URL / pool / HA / PITR declarations
    +--> establish temporary Prisma connection
    +--> verify TLS + writable primary + supported version
    +--> validate SQL-visible HA/PITR mode when selected
    |
    +--> any failure: do not create NestJS / do not accept traffic
    |
    v
Phase C4 Redis preflight
    |
    v
NestFactory.create(...)
```

After bootstrap, the normal health readiness endpoint continues to query PostgreSQL through the long-lived Prisma service.

## Deterministic C5 acceptance

`services/api/scripts/c5-postgres-preflight-smoke.mjs` injects database inspection results and therefore requires no production database credentials. It covers:

- non-production bypass;
- missing/malformed/wrong-scheme database URLs;
- missing authentication;
- loopback target rejection;
- missing/unsafe TLS configuration;
- missing or invalid `connection_limit`;
- required pool/HA/PITR declarations;
- PgBouncer URL coupling;
- invalid server/replica thresholds;
- TLS-not-active rejection;
- recovery/read-only endpoint rejection;
- unsupported PostgreSQL major rejection;
- replicated HA success/failure;
- native WAL/PITR prerequisites;
- managed HA/PITR boundaries;
- connection failures with database URL/credential redaction.

The C5 smoke is chained into the existing API workspace test gate after C3 and C4. No new dependency and no Prisma schema migration are introduced.

## Production infrastructure evidence still required

Before KSA/GCC go-live, C5 still requires infrastructure/release evidence for controls that SQL cannot prove end-to-end:

- managed database service tier and regional availability;
- multi-AZ placement and automated failover tests;
- PITR retention window and backup schedule;
- an actual restore drill with measured RPO/RTO;
- encrypted storage/KMS configuration;
- private networking/security groups/firewalls/DNS;
- proxy/pooler sizing and saturation behavior;
- connection-count, CPU, memory, storage, WAL/replication-lag monitoring;
- parameter-group/change-management controls;
- patch/upgrade/maintenance policy;
- disaster-recovery region/account strategy;
- credential/token rotation.

These remain operational evidence rather than boolean environment confirmations.
