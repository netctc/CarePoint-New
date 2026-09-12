# Release 1 — R3 Production Configuration and Infrastructure Acceptance

Status: **IN PROGRESS / NO-GO**  
Workstream: R3 of #70  
Tracking issue: #79  
Canonical branch: `release/release-1-integration-go-live-readiness`  
R3 starting baseline: `16127d1c3e8ec9548129f51c64f630221d2d2942`

## 1. Purpose

R3 proves that Release 1 can run safely on the intended production or staging-equivalent infrastructure. It deliberately separates two kinds of evidence:

1. **Implementation evidence** — production fail-fast checks, adapters, workers, CI smokes and configuration contracts present in this repository.
2. **Deployment evidence** — actual cloud/database/cache/storage/KMS/security/observability resources, provider settings, recovery tests and operational ownership in the intended environment.

Implementation evidence is necessary but is not sufficient to close R3.

## 2. Current static assessment

The canonical branch contains substantial production-readiness logic. `services/api/src/main.ts` executes production readiness checks before listening, covering KMS, key rotation, external secrets, financial/non-financial external endpoints, provider response limits, notification egress, hosted-payment action origins, inbound body limits, LiveKit, SMART public endpoints, browser origins, object storage, PostgreSQL, Redis, OpenTelemetry and SIEM.

The API package also exposes focused C1/C3-C19 smoke commands. In particular, R3 can reuse the existing KMS, object-storage, Redis, PostgreSQL, OpenTelemetry, notification-outbox, KMS-rotation, SIEM, PostgreSQL-recovery and external-secret-rotation gates.

### 2.1 Static readiness matrix

| Area | Repository mechanism | Static disposition | Remaining R3 evidence |
| --- | --- | --- | --- |
| PostgreSQL | Production DB preflight + C5 + C11 recovery gate | READY FOR ENV VALIDATION | Real TLS/HA/PITR/pooling and restore evidence |
| Redis | Production Redis preflight + C4 | READY FOR ENV VALIDATION | Real TLS/auth/failover/durability evidence |
| KMS | Production KMS + rotation preflights + C1/C8 | READY FOR ENV VALIDATION | Real key/IAM/rotation/recovery evidence |
| Object storage | Private storage preflight + C3 | READY FOR ENV VALIDATION | Real bucket policy, KMS, region, lifecycle, recovery |
| External secrets | Production external-secret preflight + C12 | READY FOR ENV VALIDATION | Real mounted/managed secret delivery + rotation rehearsal |
| OpenTelemetry | Production OTLP preflight + C6 | READY FOR ENV VALIDATION | Real collector delivery, dashboards, alert ownership |
| SIEM | Durable SIEM outbox/worker + C9 | READY FOR ENV VALIDATION | End-to-end real sink delivery, backlog/retry visibility |
| Notifications | Durable notification outbox/worker + C7 | READY FOR ENV VALIDATION | Worker deployment and enabled provider end-to-end proof |
| ClamAV | Clinical file scanner integration/configuration | CONDITIONAL | Runtime service, signature freshness, fail-closed proof |
| DICOM/PACS | DICOMweb integration/configuration | CONDITIONAL | Real endpoint/security evidence if enabled for launch |
| Edge/TLS | Helmet/HSTS, trusted-proxy switch, CORS origin policy | CONDITIONAL | DNS, certificate chain, load balancer/proxy and deployed header proof |
| LiveKit | Production endpoint validation | CONDITIONAL | Real LiveKit endpoint/credentials/network/TURN evidence |
| Financial integrations | Gateway egress/action-origin hardening | CONDITIONAL | Real PSP/payer endpoints, TLS and sandbox/production acceptance |
| Workers/schedulers | Notification, SIEM, FHIR bulk workers + auth cleanup command | CONDITIONAL | Deployment topology, ownership, replicas/leases and monitoring |
| DR | PostgreSQL recovery CI/gate | CONDITIONAL | Production-equivalent recovery rehearsal and accepted RPO/RTO |

## 3. Repository deployment gap

The Release 1 application tree reviewed for R3 does not contain an obvious production Infrastructure-as-Code or deployment package such as Terraform/CDK/CloudFormation, Kubernetes/Helm manifests, or a Dockerfile.

This does **not** prove that infrastructure is absent. It means the application repository does not currently provide the deployment source of truth. R3 therefore requires one of the following before closure:

- link the authoritative infrastructure/deployment repository; or
- attach an approved environment evidence package from the managed platform/provider; or
- add a deployment/IaC package to this repository if that is the chosen project model.

Do not duplicate production infrastructure definitions merely to satisfy this document; identify the real source of truth.

## 4. Production configuration acceptance

Before running environment acceptance, capture a redacted configuration inventory. Never store secret values in GitHub.

Required non-secret inventory:

- environment name and deployment country/jurisdiction;
- Release 1 SHA;
- API public origin(s) and Admin public origin;
- PostgreSQL provider/cluster identifier, region and HA mode;
- Redis provider/cluster identifier, region and durability/failover mode;
- object-storage bucket identifiers and regions;
- KMS account/region and key aliases/identifiers without key material;
- secret-management mechanism;
- OTLP/SIEM destination identifiers;
- enabled external integrations: PSP, payer/claims, notifications, LiveKit, ClamAV, DICOM/PACS, SMART/FHIR where applicable;
- worker/scheduler deployment units;
- backup/PITR policies and target RPO/RTO.

## 5. Environment acceptance procedure

### 5.1 Exact source identity

Record the exact commit before any test:

```bash
git rev-parse HEAD
git status --short
```

The working tree must be clean and the SHA must match the intended R3 candidate.

### 5.2 Build and static gates

Run the repository build/type checks and the permanent API hardening suite on the exact candidate:

```bash
npm ci
npm run build
npm --workspace services/api run typecheck
npm --workspace services/api test
```

Also execute the repository CI workflows applicable to the candidate. A green CI result is supporting evidence, not a substitute for environment acceptance.

### 5.3 Production-start fail-fast check

With redacted production-equivalent configuration and external dependencies reachable, start the API in `NODE_ENV=production`.

Expected result: the process must fail closed if a required production dependency or trust boundary is unsafe, and must bind only after all configured readiness checks pass.

Capture:

- exact SHA;
- redacted environment identifier;
- start timestamp;
- preflight result;
- health/readiness result;
- no-secret/no-PHI startup logs.

## 6. PostgreSQL acceptance

Required evidence:

- PostgreSQL 16+;
- verified TLS;
- configured HA topology with provider or technical proof;
- connection pooling mode/limits;
- backup and PITR policy;
- restore to an isolated recovery target;
- post-restore migration/schema validation;
- application read/write smoke after recovery;
- measured recovery point and recovery time.

Run the existing C5 and C11 mechanisms against the intended environment where safe. CI fixture recovery remains useful regression evidence but does not replace the live recovery rehearsal.

R3 disposition remains **BLOCKED** until the recovery test is documented and RPO/RTO are accepted.

## 7. Redis acceptance

Required evidence:

- TLS (`rediss://`) and authenticated connectivity;
- writable primary;
- failover/replica behavior appropriate to the selected topology;
- configured persistence/durability mode;
- reconnect behavior during controlled failover;
- alerting for availability, latency, memory pressure and replication/failover state.

Run the C4 production Redis preflight against the intended environment.

## 8. KMS and secret-management acceptance

Required evidence:

- customer-managed keys in the approved account/region;
- encryption and signing keys satisfy the expected key type/spec;
- runtime identity has least-privilege encrypt/decrypt/sign/verify permissions only where required;
- key rotation settings satisfy the configured policy;
- operational process prevents deleting keys still referenced by retained encrypted data;
- external integration secrets use the approved encrypted/managed-secret mechanism;
- production does not use plaintext compatibility secret variables;
- secret rotation rehearsal succeeds without data loss or prolonged outage.

Use C1, C8 and C12 as the code-side acceptance foundation.

## 9. Private object storage and clinical-file safety

Required evidence for every enabled bucket/data class:

- public access blocked;
- private object ACL/policy posture;
- encryption with the approved KMS key;
- bucket region consistent with the approved residency boundary;
- lifecycle rules aligned with approved retention policy;
- object recovery/versioning policy where required;
- presigned/download behavior remains authorized and time-limited.

If clinical file uploads are enabled, ClamAV must be reachable, signature updates must be operational, and malware scanning must fail closed.

If DICOM/PACS is enabled for Release 1 launch, validate the real DICOMweb endpoint, authentication, TLS, response limits and PHI handling.

## 10. Observability and SIEM acceptance

Required evidence:

- OTLP export reaches the intended backend over the approved TLS mode;
- service/trace correlation is visible;
- no PHI or secret values are emitted in logs/traces during representative flows;
- SIEM durable outbox delivers to the real sink;
- retry/backlog/dead-letter states are observable;
- alert rules and operational owners exist for critical conditions;
- alert delivery is rehearsed.

Use C6 and C9 as the code-side foundation.

## 11. Edge, DNS, TLS and origin acceptance

Validate from outside the deployment boundary:

- production DNS resolves to the intended edge;
- certificate chain and hostname are valid;
- HTTPS is mandatory;
- HSTS and security headers are present;
- reverse-proxy/load-balancer topology and trusted-proxy handling are documented;
- exact browser origins are configured;
- wildcard production origins are rejected;
- disallowed browser origins fail as expected;
- request body and provider-response limits are enforced through the deployed edge, not only in unit/smoke tests.

## 12. Worker and scheduler acceptance

Document how these jobs run in production:

- notification outbox;
- SIEM outbox;
- FHIR Bulk worker/cleanup if enabled;
- authentication-artifact cleanup;
- future appointment reminder scheduler required by #78 once implemented;
- any retention/deletion scheduler required by #77 once implemented.

For each worker capture replicas, lease/idempotency strategy, restart policy, metrics, alerting and owner.

## 13. Disaster-recovery rehearsal

The R3 recovery rehearsal must be operational, not purely theoretical.

Minimum sequence:

1. Record candidate SHA and recovery test start time.
2. Create or identify the approved recovery point.
3. Restore PostgreSQL to an isolated recovery target.
4. Restore/reconnect dependent storage where the DR design requires it.
5. Start the application against the recovered environment.
6. Run data-integrity and critical-flow smoke tests.
7. Measure actual RPO and RTO.
8. Record defects and repeat until the agreed targets are met.
9. Obtain operational/product acceptance of the measured values.

Do not expose PHI or production secrets in test evidence.

## 14. R3 evidence record template

Use one row per evidence item.

| Field | Value |
| --- | --- |
| Evidence ID | `R3-...` |
| Environment |  |
| Date/time |  |
| Release SHA |  |
| Area | DB / Redis / KMS / Storage / OTEL / SIEM / Edge / Worker / DR / Other |
| Resource reference | Non-secret provider/resource identifier |
| Test/preflight |  |
| Result | PASS / FAIL / CONDITIONAL |
| Evidence location | Log/artifact/runbook/ticket link |
| Owner |  |
| Exception/waiver |  |
| Revalidation date |  |

## 15. Exit decision

R3 may move to **READY** only when:

- the exact candidate has passed required automated gates;
- production/staging-equivalent startup preflight passes;
- PostgreSQL, Redis, storage, KMS/secrets and enabled external infrastructure have real evidence;
- OTLP/SIEM and required workers are demonstrably operating;
- DNS/TLS/edge/origin posture has been tested from the deployed environment;
- a recovery rehearsal has been completed successfully;
- measured RPO/RTO are accepted;
- all Critical/High infrastructure defects are closed or explicitly handled under the Release 1 Go/No-Go policy.

Until then R3 remains **IN PROGRESS / NO-GO**.

## 16. Relationship to other workstreams

- #75–#78 remain independent Release 1 P0 functional/compliance closure blockers discovered by R2.
- R4 will activate and validate real external service workflows; R3 verifies the production infrastructure/trust prerequisites on which those integrations depend.
- R6 owns the complete security/privacy release gate; R3 supplies environment-security evidence into R6.
- R8 owns broader performance/resilience/failure-mode validation; R3 supplies infrastructure and recovery baselines into R8.
- R10 owns deployment/rollback rehearsal and final promotion to `main`.

`main` remains unchanged until the Release Candidate satisfies the later Go/No-Go gates.