# Release 1 Phase B.2 — KSA Production Architecture Baseline

Status: **DECISION RECORDED / PROVISIONING NOT YET STARTED**

This document records the Phase B.2 architecture direction for Release 1 production-equivalent infrastructure after Phase B.1 inventory.

## Residency decision

Release 1 production is required to keep its production data plane in the Kingdom of Saudi Arabia from the first public release.

The target architecture must therefore keep applicable production PostgreSQL data, backups/PITR state, Redis/cache state where retained, clinical/document objects, cryptographic keys/secrets, telemetry/SIEM destinations containing application data, and disaster-recovery copies within approved KSA regions unless an explicit legal/privacy exception is separately approved.

This is a product/operational residency requirement. It is not itself a legal-compliance attestation.

## Preferred cloud baseline

Preferred baseline: **Oracle Cloud Infrastructure (OCI)**.

Primary region: **Saudi Arabia Central (Riyadh) — `me-riyadh-1`**.

Disaster-recovery region: **Saudi Arabia West (Jeddah) — `me-jeddah-1`**.

Rationale:

- both regions are live OCI commercial regions in KSA;
- OCI Database with PostgreSQL exposes regional service endpoints in both Riyadh and Jeddah;
- OCI Database with PostgreSQL supports multi-node high availability, point-in-time recovery, and warm-standby cross-region replication;
- OCI Cache is available in commercial regions and supports primary/replica topologies, authentication controls, and cross-region replication where the selected region pair is supported;
- OCI Object Storage, Vault/Key Management, Secrets, Logging/Monitoring and container/compute services can be kept inside the selected KSA regions;
- using two KSA regions provides a path to in-country regional disaster recovery rather than relying only on multi-zone resilience inside one KSA region.

Google Cloud Dammam (`me-central2`) remains the documented fallback architecture if OCI commercial/service availability, commercial terms, tenancy limits, or region-pair constraints block acceptance. The GCP fallback must keep all applicable services in Dammam and requires separate DR analysis because it currently provides one Google Cloud region in KSA.

## Target production topology

### Network and ingress

- Public traffic terminates only on the approved HTTPS edge/load-balancer/WAF path.
- Application services run in private subnets.
- PostgreSQL and OCI Cache endpoints remain private; no public database/cache ingress.
- Administration uses least-privilege IAM plus private/bastion access where required.
- Production DNS/TLS/origin configuration is exact and fail-closed.

### Application runtime

- Immutable Release 1 API/Admin artifacts are deployed from exact approved digests/SHAs.
- Runtime identities use OCI IAM/dynamic-group or equivalent workload identity where practical.
- Application and worker runtimes are horizontally replaceable; no production state is stored on local instance filesystems.

### PostgreSQL

Primary: OCI Database with PostgreSQL in Riyadh.

Required controls:

- PostgreSQL 16+;
- TLS with certificate verification;
- at least two database nodes for production HA;
- connection pooling sized and validated against application concurrency;
- PITR enabled with a retention window consistent with policy and RPO requirements;
- encrypted managed backups;
- warm-standby replication to Jeddah for regional DR;
- measured restore and failover rehearsal;
- target RPO <= 15 minutes and RTO <= 120 minutes.

### Redis / transient state

Primary: OCI Cache in Riyadh.

Required controls:

- Redis-compatible engine version supported by CarePoint;
- private endpoint only;
- authenticated access/ACLs;
- TLS or provider-supported encrypted private transport meeting the Release 1 Redis security contract;
- multi-node primary/replica topology;
- persistence/durability configuration consistent with the application's non-reconstructible Redis state;
- failover/reconnect test;
- Jeddah secondary through OCI Cache cross-region replication only if the Riyadh/Jeddah pair is officially supported and accepted; otherwise the Release 1 runtime must classify which Redis records are reconstructible vs durable and provide an approved alternate in-country recovery design.

### Clinical/document object storage

- Private OCI Object Storage bucket(s) in the approved KSA region.
- Public access disabled.
- Customer-managed encryption key where required by the application/security contract.
- Object versioning/lifecycle/retention configured from the approved policy.
- Recovery test against representative synthetic objects.
- Any Jeddah DR copy/replication must remain in KSA.

### KMS and secrets

- OCI Vault/Key Management keys created in the approved KSA region(s).
- Separate key purposes for document encryption/signing and external-secret protection where the CarePoint contract requires them.
- Key rotation and deletion-protection/recovery procedure documented and rehearsed.
- Production integration secrets stored in OCI Secrets/Vault-backed mechanisms; no production plaintext compatibility secrets in repository files.

### Observability and SIEM

- Metrics/logs/traces use approved in-KSA destinations when they can contain application or security-event data.
- OTLP endpoints use TLS.
- SIEM export is enabled and tested end-to-end.
- PHI leakage checks remain part of acceptance.
- Alert ownership/escalation is documented.

### Workers and scheduled jobs

- Notification outbox, SIEM export, FHIR Bulk cleanup where enabled, auth cleanup, and other scheduled workloads use a production execution model with lease/idempotency validation.
- Worker failure/retry/backlog/dead-letter visibility is demonstrated.

## Application adaptation work

The current Release 1 environment contract contains AWS/S3/KMS-oriented production controls. OCI adoption must preserve fail-closed semantics rather than replacing those checks with permissive compatibility flags.

Required engineering tasks:

1. introduce or extend provider abstractions for object storage, key management, and secret retrieval;
2. add OCI implementations while preserving existing AWS-compatible implementations for non-OCI environments/tests;
3. add OCI-specific production preflight validation for region, resource identity, encryption, private access, key rotation and secret source;
4. update `.env.example` with provider-neutral variables plus OCI-specific non-secret identifiers only;
5. update the machine-checkable R3 infrastructure-evidence contract so OCI resource references can satisfy the same security/residency controls;
6. add deterministic CI tests proving AWS and OCI provider selection remain fail-closed and mutually explicit;
7. never commit credentials, private keys, tenancy secrets, database passwords or PHI.

## Provisioning gates

No production-equivalent resources should be claimed as accepted until all of the following are true:

- OCI tenancy/account and KSA region subscriptions confirmed;
- Riyadh and Jeddah service availability/limits confirmed for the selected SKUs;
- architecture and estimated recurring cost approved;
- non-secret resource naming/tagging convention approved;
- infrastructure is provisioned with private networking/IAM;
- exact Release Candidate is deployed;
- R3 production preflight passes;
- backup/PITR/failover/restore rehearsals produce sanitized evidence;
- RPO/RTO are measured and accepted;
- Operations/SRE/Database/Security/Privacy/Product approvals are recorded.

## Current status

- Phase B.1 inventory: COMPLETE.
- KSA residency requirement: DECIDED.
- Preferred provider/regions: OCI Riyadh primary + Jeddah DR.
- Cloud resources provisioned: NO.
- Production-equivalent R3 acceptance: OPEN.
- Public Release 1: NO-GO until all remaining release gates close.
