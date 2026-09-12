# Phase C4 - Production Redis Readiness

## Purpose

Phase C4 closes the Redis production gap left explicit in Slice 9. Redis participates in CarePoint security and interoperability paths including distributed rate limiting, SMART/OAuth ephemeral artifacts, authentication/security state, health readiness and FHIR Bulk Data compatibility coordination. The API therefore must not accept production traffic while Redis is configured as an unauthenticated/plaintext/local endpoint or while the configured endpoint is not a writable, production-ready primary.

C4 starts from the fully accepted Phase C3 head `e43b942c67b77f4735ab8a9a0b1853293f55185c`.

## Centralized runtime policy

`RedisSecurityService` remains the single Redis runtime abstraction consumed by health, IAM/security, SMART/FHIR and distributed rate limiting. Phase C4 introduces `redisRuntimeConnection()` as the shared connection-policy parser used by both:

- the startup preflight before NestJS is created; and
- the long-lived Redis client created by `RedisSecurityService`.

This prevents a configuration from passing one production policy while the runtime silently connects under another.

Non-production environments retain the existing development behavior: `redis://localhost:6379` is allowed and, where no Redis URL is configured, selected ephemeral/rate-limit operations can use their existing in-memory fallback. Production continues to require Redis.

## Production transport and authentication boundary

When `NODE_ENV=production`, `REDIS_URL` must:

- be a valid Redis URL;
- use `rediss://` (TLS);
- include a non-empty Redis password/token;
- target a non-loopback host;
- use normal TLS certificate verification.

`REDIS_TLS_REJECT_UNAUTHORIZED=false` is explicitly forbidden in production.

Redis credentials must come from the deployment secret-management mechanism. They must never be committed to source control or emitted in logs. C4 sanitizes preflight connection failures so the configured URL/password are redacted if an underlying error includes them.

## Startup readiness sequence

Production startup now follows:

```text
Phase C1 application KMS preflight
    |
    v
Phase C3 private object-storage preflight
    |
    v
Phase C4 Redis preflight
    |
    +--> validate secure/authenticated REDIS_URL
    +--> connect with offline queue disabled and bounded timeout
    +--> PING
    +--> ROLE must be master
    +--> write/read/delete short-lived probe key
    +--> inspect replication / cluster / persistence INFO
    +--> enforce replica and persistence policy
    |
    +--> any failure: do not create NestJS / do not accept traffic
    |
    v
NestFactory.create(...)
```

The probe key is under the `carepoint:preflight:` namespace, has a 30-second TTL and is deleted immediately after verification. Cleanup is best-effort if the connection fails mid-probe.

## Writable endpoint and topology

The configured Redis endpoint must return a writable `master` role. Read-only replica endpoints are rejected.

CarePoint currently uses a standard ioredis client rather than the ioredis Cluster client. A Redis endpoint reporting `cluster_enabled=1` is therefore rejected instead of pretending that MOVED/cluster routing is supported safely.

`REDIS_MIN_REPLICAS` defaults to `1`. The preflight requires at least that many connected replicas as reported by Redis replication INFO.

Setting `REDIS_MIN_REPLICAS=0` is allowed only as an explicit architecture exception for a managed/serverless product whose failover topology is not visible through this Redis protocol signal. That exception requires separate infrastructure evidence for multi-AZ/HA/failover before production approval.

## Persistence policy

Production requires an explicit `REDIS_PERSISTENCE_MODE`:

### `aof`

CarePoint verifies:

- `aof_enabled=1`;
- when reported, `aof_last_write_status=ok`.

### `rdb`

CarePoint verifies:

- a valid positive `rdb_last_save_time`;
- `rdb_last_bgsave_status=ok`.

### `managed`

Use this only when persistence/backups are supplied outside the Redis protocol by the managed platform. CarePoint still verifies TLS, authentication, writable role, live read/write/delete behavior, cluster compatibility and replica count, but it does **not** claim that provider-managed backups or persistence have been proven from code.

For `managed`, release acceptance must separately record the provider configuration for durability, backups/retention, restore testing, multi-AZ/failover and maintenance behavior.

## Runtime client behavior

The long-lived `RedisSecurityService` uses the same parsed production connection policy and retains conservative failure behavior:

- `lazyConnect=true`;
- offline queue disabled;
- `maxRetriesPerRequest=1`;
- bounded `REDIS_CONNECT_TIMEOUT_MS` (default 3000 ms);
- Redis ready-check enabled;
- a non-sensitive connection name (`carepoint-api`).

The existing `/api/v1/health/ready` endpoint continues to PING through this same service, so readiness turns non-ready when the active Redis dependency becomes unavailable after startup.

## Deterministic C4 acceptance

`services/api/scripts/c4-redis-preflight-smoke.mjs` uses an injected Redis inspector and requires no production Redis credentials. The API workspace test chain executes it after C3.

Coverage includes:

- non-production bypass;
- missing/malformed Redis URL;
- plaintext `redis://` rejection in production;
- missing authentication;
- loopback endpoint rejection;
- disabled TLS certificate validation rejection;
- invalid timeout/replica/persistence configuration;
- failed PING;
- replica/read-only endpoint rejection;
- failed write/read/delete probe;
- unsupported Redis Cluster mode;
- replica minimum enforcement and explicit zero-replica exception;
- AOF success/failure states;
- RDB success/failure states;
- managed persistence mode;
- connection-error propagation with credential/URL redaction.

No dependency or database schema change is introduced by C4.

## Production infrastructure acceptance still required

C4 can prove only what is observable through the configured Redis protocol endpoint. Before KSA/GCC production go-live, infrastructure evidence must additionally cover:

- managed Redis service/SLA and supported engine version;
- private network placement, security groups/firewall rules and DNS;
- multi-AZ topology and automatic failover behavior;
- backup/snapshot schedule and retention where applicable;
- restore testing and recovery objectives;
- maintenance/upgrade policy;
- monitoring and alerting for memory pressure, evictions, replication lag, connection saturation and failover events;
- provider-side encryption-at-rest configuration;
- secret/token rotation procedure;
- disaster-recovery design.

These are deliberately not represented as boolean environment confirmations: they require deployment/provider evidence.
