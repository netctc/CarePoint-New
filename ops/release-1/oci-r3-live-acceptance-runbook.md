# Release 1 OCI KSA R3 live acceptance runbook

Status: **operator procedure / does not itself grant production acceptance**  
Tracking: #79, #98  
Production target: OCI Saudi Arabia  
Primary region: `me-riyadh-1`  
DR region: `me-jeddah-1`

## 1. Purpose and acceptance boundary

Use this runbook to collect and validate the real environment evidence required by the Release 1 R3 infrastructure gate.

The repository already contains:

- a root `Dockerfile` with API and Admin production targets;
- the `Release 1 Immutable Containers` workflow, which builds exact-source candidates and, on protected release-branch pushes, publishes API/Admin images to GHCR by immutable digest with provenance/SBOM evidence;
- OCI production startup binding, Object Storage, Vault/KMS and Vault Secrets runtimes;
- fail-closed production preflights;
- the base `carepoint.release-infrastructure-evidence/v1` validator;
- the additive OCI/KSA evidence validator.

The repository does **not** contain Terraform, Helm or Kubernetes provisioning definitions for the intended OCI production environment. Provisioning/orchestration therefore remains external to this application repository unless an authoritative infrastructure source is added later.

CI contract artifacts are synthetic and explicitly `productionAcceptance=false`. They must never be used as proof that OCI resources exist or that R3 is complete.

## 2. Safety rules

Do not commit or paste into GitHub:

- credentials, API keys, secret values or private keys;
- PHI, patient identifiers, database dumps or raw request/response payloads;
- production connection strings;
- real OCI OCIDs or other sensitive infrastructure inventory when project policy requires those identifiers to stay restricted.

The final live evidence JSON requires real OCI-shaped resource references for validation. Keep that file in the approved restricted evidence location and run the validator from a controlled operator workstation or CI environment. GitHub should contain only approved sanitized references or summaries.

Do not add `.env` files. Configure deployment/runtime values through the approved secret/environment mechanism.

## 3. Freeze the exact Release Candidate

Before environment work begins, identify the exact RC source SHA and immutable container manifest produced for that source.

Required evidence:

- full 40-hex RC SHA;
- Release 1 version/reference;
- API immutable digest;
- Admin immutable digest;
- immutable-container workflow run/reference;
- current deployed artifact identity, if replacing an existing environment.

For production-equivalent deployment, use digest references, not mutable tags and not a rebuilt image. The expected form is:

```text
ghcr.io/netctc/carepoint-new-api@sha256:<64-hex>
ghcr.io/netctc/carepoint-new-admin@sha256:<64-hex>
```

The source SHA embedded in the image label must match the frozen RC SHA.

## 4. Create a local OCI evidence draft

From the exact candidate checkout, compose the base R3 template and OCI extension into a single non-approved draft:

```bash
mkdir -p .local-r3-evidence
node .ci/compose-release-infrastructure-oci-evidence-template.mjs \
  --compose \
  ops/release-1/production-infrastructure-evidence.example.json \
  ops/release-1/production-infrastructure-oci-extension.example.json \
  .local-r3-evidence/oci-r3-live-evidence.json
```

The composer always keeps:

- `approved=false`;
- `overallStatus=DRAFT`;
- `sensitiveDataIncluded=false`;
- jurisdiction `SA`;
- primary region `me-riyadh-1`;
- approved region set `me-riyadh-1, me-jeddah-1`;
- OCI provider selection.

The generated file remains a template. Placeholder values are not evidence and cannot pass final acceptance validation.

Validate the draft shape before collecting live evidence:

```bash
node .ci/release-infrastructure-evidence-contract.mjs \
  --validate-template .local-r3-evidence/oci-r3-live-evidence.json
node .ci/release-infrastructure-oci-evidence-contract.mjs \
  --validate-template .local-r3-evidence/oci-r3-live-evidence.json
```

## 5. Establish the external OCI deployment source of truth

Record an approved reference to the system that actually creates/manages the OCI environment. This may be a restricted infrastructure repository, managed-platform configuration, provider change record or equivalent controlled source.

At minimum, establish evidence for:

- OCI tenancy and production compartment;
- Riyadh/Jeddah region availability and required service limits;
- private VCN/subnet/security topology;
- PostgreSQL primary/HA/backups/PITR topology;
- cache primary/HA/DR topology;
- Object Storage buckets for clinical documents and FHIR bulk artifacts;
- Vault/KMS keys;
- Vault Secrets resources;
- edge/DNS/TLS topology;
- OTLP and SIEM processing destinations;
- worker/scheduler deployment topology.

The application repository must not invent substitute infrastructure definitions just to satisfy R3.

## 6. Configure the OCI production runtime

The production API startup path requires explicit cloud/residency selection before provider-backed security initialization.

The non-secret contract includes these names:

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

For Release 1 OCI:

- `CAREPOINT_CLOUD_PROVIDER=oci`;
- jurisdiction is `SA`;
- primary is `me-riyadh-1`;
- DR is `me-jeddah-1`;
- active `OCI_REGION` matches the primary runtime region;
- `CAREPOINT_OCI_AUTH_MODE=instance-principal`;
- data-bearing OTLP/SIEM destinations must be in the approved KSA region set.

Configure all additional database, cache, Object Storage, Vault/KMS, Secrets and integration settings required by their existing production preflights. Keep secret values in the approved secret mechanism, not in source control.

## 7. Deploy exact immutable artifacts

Deploy the frozen API/Admin digests using the approved OCI deployment source of truth and change procedure.

Capture non-secret/restricted evidence references for:

- deployed immutable image digests;
- runtime source/version identity;
- deployment timestamp and operator/change record;
- target environment classification;
- database migration state;
- worker/scheduler versions;
- rollback artifact identity.

Do not treat the `Release 1 Immutable Containers` workflow as deployment evidence: that workflow builds/publishes/verifies artifacts but intentionally does not deploy them.

## 8. Prove production startup and readiness

Start the API with `NODE_ENV=production` on the intended production-equivalent topology.

Expected behavior:

- cloud provider/residency selection fails closed if missing or invalid;
- OCI uses instance-principal security runtime initialization;
- configured production preflights must pass before the API serves traffic;
- health/readiness endpoints must expose the expected release identity without leaking secrets or PHI.

Capture sanitized references to:

- production startup/preflight PASS;
- health/readiness result;
- exact RC SHA/image digest;
- no-secret/no-PHI logs;
- deployment/environment identifier.

A startup failure must be treated as a blocker, not bypassed with compatibility flags.

## 9. Collect mandatory infrastructure controls

Populate every mandatory `controls[]` and `dataDestinations[]` record in the evidence draft using real evidence references.

### PostgreSQL

Prove TLS, HA/failover, pooling limits, backup/PITR policy and an isolated restore. Record the actual primary/replica/backup regions and resource references.

### Cache / Redis-compatible runtime

Prove TLS/authentication, private connectivity, HA/persistence, controlled reconnect/failover behavior and monitoring.

### Object Storage

For both clinical-document and FHIR bulk-artifact storage, prove private access, approved KMS encryption, KSA residency, lifecycle/recovery behavior and authorized access semantics.

### Vault / KMS

Prove customer-managed key ownership, active lifecycle, least-privilege runtime permissions, expected encryption/signing usage and rotation/recovery controls.

### Vault Secrets

Prove approved managed-secret delivery, CURRENT secret retrieval and a rotation rehearsal without plaintext production compatibility secrets.

### OTLP / SIEM

Prove real delivery over the approved transport and confirm data-bearing processing remains in the declared approved KSA region set. Prove PHI/secret-safe telemetry and SIEM backlog/retry visibility.

### Edge and workers

Prove DNS/TLS/proxy/origin posture plus runtime ownership, restart policy, observability and idempotency/lease behavior for required workers and schedulers.

## 10. Perform recovery and failover rehearsal

R3 requires measured recovery evidence, not only CI fixtures.

Minimum sequence:

1. Record the exact RC SHA/digests and incident/rehearsal start timestamp.
2. Identify the approved recovery point.
3. Restore PostgreSQL/PITR to an isolated production-equivalent target.
4. Reconnect/restore dependent services according to the approved DR design.
5. Start the exact application artifacts against the recovered environment.
6. Run integrity and critical-flow smoke tests.
7. Exercise the approved failover path, including Jeddah where required by the final topology.
8. Record the recovered-data timestamp and accepted-healthy timestamp.
9. Calculate actual RPO and RTO from those timestamps.
10. Repeat after defects until the targets are met.

The evidence validator enforces:

- RPO <= 15 minutes;
- RTO <= 120 minutes.

Do not hand-edit the stated RPO/RTO to values that do not match the supplied timestamps; the validator recomputes them.

## 11. Obtain approvals

The final evidence record requires explicit approval evidence for all roles defined by the R3 contract:

- Operations;
- SRE;
- Database;
- Security;
- Privacy;
- Product.

Each approval needs a non-secret approver reference, approval evidence reference and timestamp. `PENDING` is not final acceptance.

## 12. Validate final live evidence

Run final validation from the **exact RC source checkout** because the validator compares `release.sourceSha` with the current Git checkout SHA.

```bash
git rev-parse HEAD
node .ci/release-infrastructure-oci-evidence-contract.mjs \
  --validate /restricted/path/oci-r3-live-evidence.json \
  --out /restricted/path/oci-r3-validated-result.json
```

The OCI validator first executes the base R3 validator, then the OCI/KSA overlay.

A valid final result must represent real evidence and can report production acceptance only when all base and OCI requirements pass. A CI `--contract-evidence` artifact is not equivalent and remains `productionAcceptance=false`.

## 13. Link R3 and R10 evidence without duplicating it

R3 (#79) proves the production-equivalent infrastructure and recovery posture. R10 (#98) consumes the same frozen RC/environment to prove deployment, migration compatibility and rollback.

Reuse controlled evidence references where the same fact satisfies both gates, especially:

- exact immutable digests;
- environment topology;
- database checkpoint/PITR evidence;
- startup/readiness identity;
- recovery timings;
- operator/change approvals.

Do not duplicate secrets or raw provider output between tickets.

## 14. Exit condition

R3 remains **NO-GO** until the live evidence record passes the base + OCI validators and the required owners approve the real environment.

Code, synthetic fixtures, templates, green PR workflows and successful container builds are necessary supporting evidence but cannot close #79 on their own.
