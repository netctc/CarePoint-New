# Release 1 — R3 Production Configuration and Infrastructure Acceptance

Status: **IN PROGRESS / NO-GO**  
Workstream: R3 of #70  
Tracking issue: #79  
Canonical branch: `release/release-1-integration-go-live-readiness`  
OCI engineering baseline after #183: `9d7795cfa1fa33a4c9843b36dd8bd511733aae4b`

> The SHA above records the completed OCI provider/startup engineering baseline. It is not automatically the final Release Candidate SHA; final R3 evidence must use the exact frozen RC selected by the release process.

## 1. Purpose

R3 proves that Release 1 can run safely on the intended production or production-equivalent infrastructure. It deliberately separates:

1. **implementation evidence** — fail-closed runtime contracts, OCI adapters, preflights, immutable container build controls, CI tests and evidence validators present in this repository; and
2. **deployment evidence** — actual OCI resources, network/topology settings, immutable deployed artifacts, recovery measurements and accountable approvals from the intended environment.

Implementation evidence is necessary but is not sufficient to close R3.

The operator procedure for live OCI evidence is `ops/release-1/oci-r3-live-acceptance-runbook.md`.

## 2. Release 1 production target

Release 1 requires KSA residency from the first public release. The accepted OCI topology contract is:

- provider: OCI;
- jurisdiction: `SA`;
- primary region: Riyadh `me-riyadh-1`;
- DR region: Jeddah `me-jeddah-1`;
- approved data-region set limited to those KSA regions.

Production startup requires explicit provider selection. Ambiguous, missing or non-compliant Release 1 production configuration fails closed.

AWS-compatible implementation paths remain in the repository for compatibility/regression protection, but AWS is not the accepted Release 1 KSA production target under the current contract.

## 3. Current repository readiness

The canonical branch contains provider-aware production startup and preflight logic. `services/api/src/main.ts` resolves the production cloud/residency contract before initializing provider-backed security and before serving traffic.

### 3.1 Static readiness matrix

| Area | Repository mechanism | Static disposition | Remaining R3 evidence |
| --- | --- | --- | --- |
| Cloud/residency | Explicit `CAREPOINT_CLOUD_PROVIDER` + OCI KSA contract + startup gate | READY FOR ENV VALIDATION | Real tenancy/compartment/region evidence and exact deployed runtime |
| PostgreSQL | Production DB preflight + C5 + C11 recovery gate | READY FOR ENV VALIDATION | Real TLS/HA/PITR/pooling, isolated restore and measured recovery |
| Cache/Redis-compatible runtime | Production Redis preflight + C4 | READY FOR ENV VALIDATION | Real private/TLS/auth/HA/persistence/failover evidence |
| Vault/KMS | OCI Vault/KMS contracts, runtime binding, C1/C8 | READY FOR ENV VALIDATION | Real Vault/key lifecycle, IAM/least privilege, rotation/recovery evidence |
| Object Storage | OCI Object Storage runtime + C3 provider-aware preflight | READY FOR ENV VALIDATION | Real private buckets, KMS, lifecycle/recovery and KSA location evidence |
| External secrets | OCI Vault Secrets runtime + C12 | READY FOR ENV VALIDATION | Real secret resources, instance-principal access and rotation rehearsal |
| OpenTelemetry | Production OTLP preflight + C6 + explicit destination region | READY FOR ENV VALIDATION | Real backend delivery, KSA processing location, dashboards/ownership |
| SIEM | Durable SIEM outbox/worker + C9 + explicit destination region | READY FOR ENV VALIDATION | Real sink delivery, KSA processing location, retry/backlog visibility |
| Notifications | Durable notification outbox/worker + C7 | READY FOR ENV VALIDATION | Worker deployment and enabled-provider end-to-end proof |
| ClamAV | Clinical file scanner integration/configuration | CONDITIONAL | Runtime service, signature freshness and fail-closed proof if launch scope enables uploads |
| DICOM/PACS | DICOMweb integration/configuration | CONDITIONAL | Real endpoint/security evidence if enabled for launch |
| Edge/TLS | Helmet/HSTS, trusted-proxy and browser-origin controls | CONDITIONAL | DNS, certificate, edge/proxy and deployed-header proof |
| Workers/schedulers | Notification, SIEM, FHIR bulk and maintenance jobs | CONDITIONAL | Production topology, replicas/leases/idempotency, monitoring and owners |
| DR | Base R3 continuity validator + C11 + rehearsal contracts | BLOCKED ON LIVE EVIDENCE | Measured production-equivalent restore/failover with RPO <= 15m / RTO <= 120m |

## 4. Application artifact and deployment-source status

The repository **does contain** a root `Dockerfile` with production targets for:

- API (`target: api`); and
- Admin (`target: admin`).

The Dockerfile uses a pinned Node base-image digest, embeds Release SHA/version labels and runs the production processes as a non-root user.

The `Release 1 Immutable Containers` workflow builds exact-source API/Admin candidates. On protected release-branch pushes it publishes them to GHCR, records immutable image digests and produces provenance/SBOM evidence. The workflow explicitly does **not** deploy the images.

The application repository does not currently contain Terraform, Helm or Kubernetes provisioning definitions for the intended OCI production environment. R3 therefore still requires an approved reference to the authoritative external infrastructure/deployment source of truth, such as a restricted infrastructure repository, managed-platform configuration or provider change record.

Do not duplicate infrastructure definitions merely to satisfy R3. Use the system that actually provisions and operates the environment.

## 5. R3 evidence contracts

The base final schema is:

```text
carepoint.release-infrastructure-evidence/v1
```

The base validator is:

```text
.ci/release-infrastructure-evidence-contract.mjs
```

The additive OCI/KSA validator is:

```text
.ci/release-infrastructure-oci-evidence-contract.mjs
```

The OCI overlay requires real references for the production domains covering PostgreSQL, cache, clinical/FHIR Object Storage, KMS and external secrets, and requires OTLP/SIEM data destinations to remain inside the approved KSA region set.

The CI workflow `Production Infrastructure Acceptance Contract` validates only the contract/templates and produces sanitized artifacts marked:

```text
productionAcceptance=false
workflowPurpose=contract-validation-only
```

A green contract workflow is supporting engineering evidence; it is never a substitute for live R3 acceptance.

## 6. Operator-ready OCI evidence draft

The repository maintains two source templates:

- `ops/release-1/production-infrastructure-evidence.example.json` — base R3 structure;
- `ops/release-1/production-infrastructure-oci-extension.example.json` — OCI provider/resource extension.

Generate a single local draft with:

```bash
node .ci/compose-release-infrastructure-oci-evidence-template.mjs \
  --compose \
  ops/release-1/production-infrastructure-evidence.example.json \
  ops/release-1/production-infrastructure-oci-extension.example.json \
  /restricted/or/local/path/oci-r3-live-evidence.json
```

The composer fixes only the non-secret contract facts already decided by Release 1: OCI, `SA`, Riyadh primary and Riyadh/Jeddah approved regions. It does not invent real resources, approvals, measurements or artifact digests and keeps the result `DRAFT` / `approved=false`.

Real live evidence can contain infrastructure identifiers that project policy keeps restricted. Do not commit the completed live file, credentials, PHI, database dumps, private keys or secret values to GitHub.

## 7. Exact Release Candidate identity

Before live environment validation, freeze and record:

- the final full RC Git SHA;
- Release version/reference;
- API immutable image digest;
- Admin immutable image digest;
- immutable-container evidence run/reference;
- current deployed artifact identity where applicable.

Deployment must use the exact immutable digest produced for the frozen source. Do not rebuild the RC for environment acceptance and do not deploy a mutable `latest` tag.

The evidence validator checks the recorded `release.sourceSha` against the exact Git checkout used during validation.

## 8. Production configuration acceptance

Do not add `.env` files. Configure non-secret values and secrets through the approved deployment/secret-management mechanism.

The OCI cloud/residency contract includes:

```text
CAREPOINT_CLOUD_PROVIDER
CAREPOINT_RESIDENCY_JURISDICTION
CAREPOINT_APPROVED_DATA_REGIONS
CAREPOINT_PRIMARY_REGION
CAREPOINT_DR_REGION
OCI_REGION
OCI_TENANCY_OCID
OCI_COMPARTMENT_OCID
CAREPOINT_OCI_AUTH_MODE
CAREPOINT_OTEL_DESTINATION_REGION
CAREPOINT_SIEM_DESTINATION_REGION
```

Release 1 expects OCI + KSA topology and instance-principal authentication. Additional database/cache/Object Storage/Vault/KMS/Secrets/integration variables remain governed by their existing production preflights.

Never store secret values in evidence records or GitHub comments.

## 9. Production startup and readiness

On the intended production-equivalent environment, start the exact API artifact with `NODE_ENV=production`.

Acceptance requires:

- explicit OCI cloud/residency contract PASS;
- instance-principal OCI security runtime initialization;
- required KMS/Secrets/Object Storage/database/cache/OTLP/SIEM and other configured preflights PASS;
- API binds only after fail-closed checks complete;
- health/readiness identify the expected release without leaking secrets or PHI.

Capture sanitized/restricted evidence references rather than raw sensitive provider output.

## 10. PostgreSQL acceptance

Required live evidence includes:

- approved KSA resource/location references;
- TLS;
- HA topology;
- connection pooling/limits;
- backup and PITR policy;
- isolated restore;
- post-restore schema/migration validation;
- application read/write/integrity smoke;
- measured recovery point and recovery time.

CI PostgreSQL/recovery workflows are regression evidence only; they do not replace the live rehearsal.

## 11. Cache acceptance

Required live evidence includes:

- private connectivity;
- TLS and authentication;
- writable primary and HA/replica behavior;
- persistence/durability mode;
- controlled reconnect/failover behavior;
- monitoring for availability, latency, memory pressure and replication/failover state.

## 12. OCI Vault/KMS and Secrets acceptance

Required live evidence includes:

- active customer-managed Vault/key resources in the approved region;
- expected encryption/signing key usage;
- instance-principal least-privilege access;
- rotation settings and recovery/retention process;
- approved Vault Secrets resources;
- CURRENT secret retrieval through the runtime path;
- secret rotation rehearsal without plaintext production compatibility secrets.

Use C1, C8 and C12 as code-side foundations, not as substitutes for real-provider evidence.

## 13. OCI Object Storage acceptance

For clinical-document and FHIR bulk-artifact buckets, prove:

- private/non-public posture;
- approved customer-managed encryption key;
- region inside the approved KSA boundary;
- lifecycle/recovery/versioning behavior required by policy;
- authorized upload/download/delete behavior;
- real resource and evidence references in the final OCI overlay.

If clinical uploads are enabled, also prove malware-scanning availability/signature freshness and fail-closed behavior.

## 14. Observability and SIEM acceptance

Prove that:

- OTLP reaches the intended backend over the approved transport;
- `CAREPOINT_OTEL_DESTINATION_REGION` represents an approved KSA processing destination;
- SIEM outbox/worker reaches the real sink;
- `CAREPOINT_SIEM_DESTINATION_REGION` represents an approved KSA processing destination;
- representative logs/traces do not expose PHI or secrets;
- retry/backlog/dead-letter conditions are observable;
- critical alert ownership and delivery have been rehearsed.

## 15. Edge, DNS and worker acceptance

Validate from the deployed environment and from outside the trust boundary where appropriate:

- production DNS and certificate chain;
- HTTPS/HSTS/security headers;
- reverse-proxy/load-balancer trust configuration;
- exact browser origin policy;
- request/response limits through the deployed edge;
- worker/scheduler deployment units, replicas, restart behavior, leases/idempotency, monitoring and owner.

## 16. Recovery and failover rehearsal

The R3 continuity gate is operational, not theoretical.

Minimum sequence:

1. Record exact RC SHA/digests and rehearsal start time.
2. Identify the approved recovery point.
3. Restore PostgreSQL/PITR to an isolated production-equivalent target.
4. Restore/reconnect dependent services according to the approved DR design.
5. Start the exact artifacts against the recovered environment.
6. Run integrity and critical-flow smoke tests.
7. Exercise the approved failover path, including Jeddah where the final design requires it.
8. Record recovered-data-through and accepted-healthy timestamps.
9. Calculate actual RPO/RTO.
10. Correct defects and repeat until acceptance targets are met.

The final validator recomputes the values from timestamps and enforces:

- RPO <= 15 minutes;
- RTO <= 120 minutes.

## 17. Required approvals

Final R3 evidence requires explicit `APPROVE` decisions with references/timestamps for:

- Operations;
- SRE;
- Database;
- Security;
- Privacy;
- Product.

Pending or missing approvals keep R3 blocked.

## 18. Final validation

From the exact frozen RC checkout, validate the completed evidence stored in the approved restricted location:

```bash
node .ci/release-infrastructure-oci-evidence-contract.mjs \
  --validate /restricted/path/oci-r3-live-evidence.json \
  --out /restricted/path/oci-r3-validated-result.json
```

This executes the base R3 validator first and then the OCI/KSA overlay.

Do not call R3 READY merely because template validation passes. Final acceptance requires the real live record to pass and the real environment approvals to exist.

## 19. Relationship to R10

R3 (#79) establishes the production-equivalent infrastructure and recovery posture. R10 (#98) uses the same frozen environment/artifacts for deployment, database migration compatibility and rollback rehearsal.

Reuse controlled evidence references between R3 and R10 where the facts are identical, especially immutable digests, topology, PITR checkpoint, startup/readiness identity and recovery measurements. Do not duplicate secret or raw provider data.

## 20. Exit decision

R3 may move to **READY** only when:

- the exact RC passes required automated gates;
- the exact immutable API/Admin artifacts are deployed to the intended OCI production-equivalent environment;
- startup/preflight is PASS;
- PostgreSQL, cache, Object Storage, Vault/KMS, Secrets, OTLP/SIEM and enabled infrastructure have real evidence;
- edge/workers required for launch are demonstrably operating;
- restore/PITR/failover rehearsal has completed successfully;
- measured RPO/RTO meet the contract;
- all required approvals are present;
- Critical/High infrastructure defects are closed or handled under the approved Release 1 Go/No-Go policy.

Until then R3 remains **IN PROGRESS / NO-GO** and public Release 1 remains blocked.
