# GCP Release 1 — G6b Memorystore failover rehearsal runbook

## Purpose

This runbook closes the bounded G6b recovery/continuity slice for the accepted GCP/KSA Release 1 profile. It proves that the production-equivalent Memorystore for Redis Standard HA instance can undergo a manual zonal failover and that the exact frozen CarePoint release reconnects and returns to healthy service within the Release 1 recovery objective.

This is recovery evidence, not final production acceptance.

## Fixed Release 1 boundary

- provider: `gcp`
- jurisdiction: `SA`
- region: `me-central2`
- Memorystore tier: `STANDARD_HA`
- Redis transport: TLS / `rediss://`
- Redis AUTH: enabled
- network: private service access
- data protection mode for the rehearsal: `limited-data-loss`
- Redis role in CarePoint: ephemeral, non-authoritative security/cache state
- geographic DR claim: **false**
- production acceptance: **false**

Do not represent multi-zone Standard HA as geographic disaster recovery. No second approved GCP/KSA Release 1 region is established by this rehearsal.

## Why Redis is treated differently from Cloud SQL

CarePoint's production Redis integration backs transient security state and distributed rate limiting. It is not the authoritative system of record for clinical, identity, appointment, billing or audit data.

A Redis failover may drop active client connections and may lose some acknowledged Redis writes because replication is asynchronous. The application must therefore tolerate expiration/loss of ephemeral cache state and reconnect to the same managed endpoint. Final G6b evidence must never claim a database-style RPO for Redis data.

The accepted recovery objective measured here is application service recovery. The final `applicationRecoverySeconds` must be no greater than 7200 seconds (120 minutes), matching the Release 1 RTO ceiling. Operators should retain the actual measured value even when it is much lower.

## Safety requirements

Do not place any of the following in the repository, workflow inputs, GitHub summaries or uploaded evidence:

- `.env` files;
- service-account JSON or private keys;
- access tokens, API keys or passwords;
- Redis AUTH values;
- production connection strings;
- patient identifiers, PHI or clinical payloads;
- raw production Redis keys/values;
- sensitive project/network/service-account inventory.

The workflow stores only SHA-256 hashes of the logical Memorystore instance identity. Real resource names remain protected GitHub environment variables.

## Required protected configuration

Configure these as GitHub environment/repository variables for `gcp-production-equivalent`; do not commit their values:

- `GCP_PROJECT_ID`
- `GCP_WIF_PROVIDER`
- `GCP_RECOVERY_SERVICE_ACCOUNT`
- `CAREPOINT_GCP_REDIS_INSTANCE`
- `CAREPOINT_GCP_REDIS_NETWORK`

The recovery service account must use GitHub OIDC / Workload Identity Federation. Static Google credentials are not permitted.

Grant only the permissions required to inspect the accepted Memorystore instance and initiate the approved manual failover. Review the effective IAM grant before each production-equivalent rehearsal.

## Preconditions

1. Freeze the exact RC SHA/version under G5a.
2. Complete the G5 immutable deployment bundle and obtain the restricted G5e evidence reference.
3. Confirm the deployed API is the same RC represented by the G5e evidence.
4. Confirm the G3c Memorystore production preflight passes for the same environment.
5. Confirm the instance is `READY`, `STANDARD_HA`, has a replica, Redis AUTH, TLS server authentication, private service access and the approved VPC network.
6. Confirm no Memorystore scale/update/maintenance operation is already in progress.
7. Confirm monitoring and an approved synthetic application canary are active before failover.
8. Confirm operational ownership and rollback/incident contacts are present for the rehearsal window.

## Application canary requirements

Use only synthetic/non-patient test data. The canary must collect enough evidence to establish when the application loses and regains Redis-backed functionality.

At minimum, record:

- API health/readiness against the approved HTTPS route;
- successful Redis-backed ephemeral security state create/read/consume behavior using an approved synthetic path;
- successful distributed rate-limit behavior using an approved synthetic path;
- the first observed reconnect/recovery timestamp after the failover;
- the exact RC identity returned by the application health/release metadata where available.

Do not use real OTP codes, patient sessions, patient identifiers or clinical data as canary payloads.

The existing CarePoint Redis client is expected to reconnect through the same managed endpoint after the provider drops connections. A short period of transient errors during the failover is evidence to measure, not a reason to hide or rewrite timestamps.

## Execute the protected control-plane workflow

Run `.github/workflows/gcp-memorystore-failover-rehearsal.yml` manually from the exact approved source ref.

Inputs:

- `source_sha`: exact frozen 40-hex RC SHA;
- `release_version`: exact frozen RC version;
- `g5_bundle_evidence_ref`: restricted G5e evidence reference for that same RC.

The workflow must:

1. check out exactly `source_sha`;
2. authenticate keylessly through WIF;
3. inspect the configured Memorystore instance;
4. reject any source profile that is not the accepted G3c production profile;
5. capture the current primary zone transiently;
6. invoke `gcloud redis instances failover` with `--data-protection-mode=limited-data-loss`;
7. wait for the provider operation to complete;
8. inspect the same logical instance again;
9. require `READY` state and a changed `currentLocationId`;
10. require the same managed host/port endpoint;
11. require Standard HA, replica, private networking, TLS and AUTH controls to remain intact;
12. publish only sanitized control-plane evidence.

The workflow intentionally leaves these final controls false:

- `applicationReconnectValidated`;
- `healthReadinessRecovered`;
- `redisBackedSecurityCanaryValidated`;
- `rateLimitPathValidated`;
- `productionRecoveryEvidence`;
- `productionAcceptance`.

A GitHub-hosted control-plane runner does not independently prove private application behavior.

## Private application recovery validation

Continue the synthetic canary throughout the failover and after the control-plane workflow reports `READY`.

Record the earliest UTC timestamp at which all of the following are simultaneously true:

1. API health/readiness has recovered through the approved route;
2. the exact expected RC identity is still running;
3. Redis-backed synthetic ephemeral security state can be written, read and atomically consumed;
4. the distributed rate-limit path operates against the recovered Redis service;
5. no compatibility bypass or in-memory production substitute was enabled;
6. authoritative PostgreSQL/application data remains consistent because Redis is not the system of record.

Set that timestamp as `applicationRecoveryValidatedAtUtc`.

Compute:

`applicationRecoverySeconds = applicationRecoveryValidatedAtUtc - failoverStartedAtUtc`

The result must be <= 7200 seconds.

Do not alter the timestamp to make the objective pass. A breach remains a failed rehearsal requiring remediation and a new controlled run.

## Cache-state expectations

The final evidence must retain:

- `cacheRole = ephemeral-non-authoritative`;
- `authoritativeDataStored = false`;
- `cacheStateMayBeLost = true`;
- `dataProtectionMode = limited-data-loss`.

Do not assert that every Redis key survives the failover. Loss or expiry of transient keys is acceptable only if CarePoint safely reconstructs/restarts the affected ephemeral flow and authoritative records remain outside Redis.

## Assemble final G6b evidence

Start from `ops/release-1/gcp-memorystore-failover-rehearsal.example.json`.

Populate it from restricted evidence sources:

- exact RC SHA/version and G5e reference;
- pre/post logical-instance SHA-256 hashes from the protected workflow artifact;
- `failoverStartedAtUtc` and `controlPlaneReadyAtUtc` from the workflow artifact;
- private `applicationRecoveryValidatedAtUtc`;
- computed recovery durations;
- restricted synthetic application validation evidence reference;
- restricted monitoring evidence reference.

For a successful final rehearsal, the true controls must be backed by real evidence, including:

- keyless authentication;
- source preflight verified;
- manual failover invoked;
- limited-data-loss mode;
- instance `READY` after failover;
- same logical instance and same KSA region;
- primary zone changed;
- private/TLS/AUTH controls preserved;
- application reconnect validated;
- health/readiness recovered;
- Redis-backed synthetic security canary validated;
- distributed rate-limit path validated.

These must remain false:

- `forceDataLossUsed`;
- `geographicDrClaimed`;
- `productionAcceptance`.

Only after all required evidence is complete may `productionRecoveryEvidence` be set to `true`.

## Validate final evidence

From the exact frozen RC checkout:

```bash
node .ci/release-gcp-memorystore-failover-rehearsal-contract.mjs \
  --validate-final /restricted/path/gcp-memorystore-failover-rehearsal.json
```

Do not commit the completed restricted evidence if it contains sensitive operational references. Store it in the approved release evidence system and retain only sanitized hashes/references where repository policy permits.

## Failure conditions

G6b is not complete if any of the following occurs:

- failover requires a more destructive data-protection mode;
- instance does not return to `READY`;
- logical instance identity changes unexpectedly;
- primary zone does not change after the manual failover;
- endpoint/private/TLS/AUTH/HA controls are lost;
- the application does not reconnect;
- Redis-backed security or rate-limit canaries do not recover;
- application recovery exceeds 120 minutes;
- a production in-memory fallback or compatibility bypass is enabled;
- evidence claims Redis is authoritative storage;
- evidence claims geographic DR;
- evidence grants production acceptance.

Record the failure, remediate the cause and perform a new controlled rehearsal. Do not edit evidence to turn a failed run into a pass.

## G6b completion boundary

A passing final G6b evidence file proves only the bounded Memorystore failover/recovery slice for the exact RC in `me-central2`. It does not prove Cloud SQL PITR, object-storage recovery, geographic DR, G7 human approvals or production acceptance by itself.
