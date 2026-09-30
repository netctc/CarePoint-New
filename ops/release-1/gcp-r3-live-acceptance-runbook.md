# Release 1 GCP KSA R3 live acceptance runbook

Status: **operator procedure / does not itself grant production acceptance**  
Tracking: #185, #98  
Production target: Google Cloud Platform, Saudi Arabia  
Primary region: `me-central2` (Dammam)  
Geographic DR: **not yet proven or approved**

## 1. Purpose and acceptance boundary

Use this runbook to collect and validate the real environment evidence required by the Release 1 GCP R3 infrastructure gate.

The repository already contains:

- provider-neutral and GCP/KSA production contracts;
- keyless GCP runtime identity support;
- Cloud KMS encryption/signing and Secret Manager runtimes;
- Cloud Storage runtime and production preflight;
- Cloud SQL HA/PITR production preflight;
- Memorystore HA/TLS production preflight;
- OTLP/SIEM destination-residency checks;
- a documented Release 1 worker/scheduler deployment model;
- Cloud Run edge/runtime production preflight;
- the base `carepoint.release-infrastructure-evidence/v1` validator;
- the additive GCP/KSA infrastructure evidence validator;
- the non-approved GCP live-evidence draft composer.

This repository does **not** provision the target GCP project, VPC, Cloud Run service, external Application Load Balancer, Cloud Armor, Cloud SQL, Memorystore, buckets, keys, secrets, certificates or DNS. Provisioning remains an external controlled responsibility unless an authoritative infrastructure source is added later.

CI contract artifacts are synthetic and explicitly `productionAcceptance=false`, `geographicDrProven=false` and `rpoRtoProven=false`. They must never be used as proof that live GCP resources exist or that #185 is complete.

## 2. Safety rules

Do not commit or paste into GitHub:

- service-account JSON keys or private keys;
- OAuth access tokens, API keys, passwords or secret values;
- `.env` files;
- PHI, patient identifiers, database dumps or raw clinical payloads;
- production connection strings;
- sensitive live resource inventory when project policy requires those identifiers to remain restricted.

The final live evidence JSON requires real GCP-shaped resource references for validation. Keep that file in the approved restricted evidence location and execute final validation from a controlled operator workstation or approved CI environment.

Use attached runtime service accounts / Workload Identity style keyless authentication. Do not introduce a static service-account credential path to make acceptance pass.

## 3. Freeze the exact Release Candidate

Before live acceptance begins, identify the exact Release Candidate source and immutable artifacts.

Required evidence:

- full 40-hex RC source SHA;
- Release 1 version/reference;
- immutable API image digest;
- immutable Admin image digest;
- immutable-container build/provenance/SBOM reference;
- rollback artifact identity.

Deploy digest references, not mutable tags and not rebuilt images. The image source label must match the frozen RC SHA.

G4 engineering and green CI alone do not freeze an RC. RC freeze/deployment belongs to the subsequent G5 phase.

## 4. Create a local non-approved GCP evidence draft

From the exact candidate checkout:

```bash
mkdir -p .local-r3-evidence
node .ci/compose-release-infrastructure-gcp-evidence-template.mjs \
  --compose \
  ops/release-1/production-infrastructure-evidence.example.json \
  ops/release-1/production-infrastructure-gcp-extension.example.json \
  .local-r3-evidence/gcp-r3-live-evidence.json
```

The composer always keeps the result non-approved and binds it to:

- `approved=false`;
- `overallStatus=DRAFT`;
- `sensitiveDataIncluded=false`;
- jurisdiction `SA`;
- primary/approved region `me-central2`;
- provider `gcp`.

Validate template shape before replacing placeholders:

```bash
node .ci/release-infrastructure-evidence-contract.mjs \
  --validate-template .local-r3-evidence/gcp-r3-live-evidence.json
node .ci/release-infrastructure-gcp-evidence-contract.mjs \
  --validate-template .local-r3-evidence/gcp-r3-live-evidence.json
```

Placeholder values are not live evidence and cannot grant production acceptance.

## 5. Establish the external GCP deployment source of truth

Record an approved reference to the controlled source that actually creates and manages the environment.

At minimum establish evidence for:

- GCP project identity and billing/organization ownership;
- Dammam `me-central2` service availability and quotas;
- VPC, private service access / approved private connectivity and Cloud Run VPC egress;
- Cloud Run service and attached runtime service account;
- external Application Load Balancer / serverless NEG topology;
- managed TLS certificate, DNS and Cloud Armor policy;
- Cloud SQL PostgreSQL regional HA, backups and PITR;
- Memorystore private HA/TLS/auth topology;
- clinical/FHIR Cloud Storage buckets and lifecycle policies;
- Cloud KMS encryption and document-signing keys;
- regional Secret Manager resources;
- OTLP and SIEM destinations and their processing-region evidence;
- worker/scheduler topology matching `ops/release-1/gcp-worker-scheduler-deployment-model.md`.

Do not create substitute application-repository configuration just to satisfy evidence fields.

## 6. Configure the GCP production runtime

Non-secret production contract values include, among others:

```text
CAREPOINT_CLOUD_PROVIDER=gcp
CAREPOINT_RESIDENCY_JURISDICTION=SA
CAREPOINT_PRIMARY_REGION=me-central2
GCP_REGION=me-central2
GCP_PROJECT_ID=<approved-project-id>
CAREPOINT_GCP_AUTH_MODE=metadata-service
CAREPOINT_GCP_SERVICE_ACCOUNT_EMAIL=<attached-runtime-service-account>
CAREPOINT_GCP_CLOUD_RUN_SERVICE=<cloud-run-service-id>
CAREPOINT_GCP_EDGE_MODE=external-application-load-balancer
CAREPOINT_PUBLIC_API_ORIGIN=https://<approved-api-host>
TRUST_PROXY=true
CAREPOINT_OTEL_DESTINATION_REGION=me-central2
CAREPOINT_SIEM_DESTINATION_REGION=me-central2
```

`CAREPOINT_DR_REGION` must not be populated merely to imply a second KSA GCP region. The currently accepted Release 1 GCP evidence region set is only `me-central2`.

Configure database, Redis, storage, KMS, Secret Manager and integration values through approved runtime configuration and secret-delivery mechanisms. Keep secret values outside source control.

## 7. Prove keyless runtime identity

Before accepting application-level preflights, prove that the Cloud Run revision uses the approved attached service account and can obtain short-lived metadata-service credentials without a JSON key.

Evidence must show:

- configured project and runtime service-account identity;
- no `GOOGLE_APPLICATION_CREDENTIALS` production key-file path;
- no static GCP access token/API-key path;
- least-privilege IAM sufficient for required runtime calls;
- sanitized logs that do not expose token values.

A deployment that requires a service-account private key is a blocker.

## 8. Deploy exact immutable artifacts

Deploy the frozen API/Admin digests through the approved GCP deployment/change process.

Capture references for:

- exact deployed digests;
- Cloud Run revision identity;
- source/version identity;
- deployment timestamp/operator/change record;
- database migration state;
- rollback revision/digest;
- worker/scheduler deployed configuration.

Do not treat the immutable-container build workflow as deployment evidence; it proves artifact construction/identity, not live deployment.

## 9. Prove Cloud Run and edge acceptance

The API Cloud Run service must satisfy the runtime preflight and live edge topology.

Prove at minimum:

- service is in `me-central2` and fully reconciled/succeeded;
- attached runtime service account matches the approved identity;
- ingress is compatible with the external Application Load Balancer path;
- the default `run.app` public route is disabled as required by the accepted profile;
- public API traffic uses the approved HTTPS hostname;
- DNS resolves to the approved external load balancer;
- managed certificate is valid for the hostname;
- Cloud Armor policy is attached and approved;
- `TRUST_PROXY=true` and origin/CORS/header behavior matches the deployed edge;
- VPC egress permits the required private database/cache data plane;
- service-level minimum instance and CPU allocation match the API-colocated background-worker model while those workers remain required.

Direct internet access that bypasses the approved edge is a blocker.

## 10. Prove Cloud SQL acceptance

For the configured Cloud SQL PostgreSQL instance prove:

- exact project/instance identity;
- region `me-central2`;
- PostgreSQL supported version meeting the application minimum;
- `REGIONAL` high availability;
- automated backups enabled;
- PITR enabled;
- public IPv4 disabled;
- approved private networking / PSC topology;
- TLS-enforced database access;
- successful application SQL-level production preflight;
- writable primary and expected migration state.

Capture only sanitized references; do not store database passwords or connection strings in evidence committed to GitHub.

## 11. Prove Memorystore acceptance

For the configured Redis instance prove:

- exact project/instance identity and `me-central2` residency;
- ready `STANDARD_HA` topology;
- replica/multi-zone HA evidence where provider metadata supports it;
- Redis AUTH enabled;
- in-transit TLS/server authentication enabled;
- approved private service access / VPC network;
- application data-plane PING/read/write/delete preflight;
- master/replica and reconnect/failure monitoring evidence.

HA evidence is service availability evidence; it is **not** proof of geographic DR.

## 12. Prove Cloud Storage acceptance

For clinical documents and FHIR bulk artifacts prove:

- exact bucket identity;
- region `me-central2`;
- public access prevention;
- uniform bucket-level access;
- configured customer-managed Cloud KMS encryption;
- required lifecycle/retention cleanup behavior;
- authorized read/write behavior through the application runtime;
- recovery/versioning behavior required by the approved policy.

## 13. Prove Cloud KMS and Secret Manager acceptance

For Cloud KMS prove:

- keys are in the approved project and `me-central2`;
- approved ownership/IAM and least privilege;
- encryption key purpose and active state;
- document-signing key/version purpose, algorithm and enabled state;
- required rotation policy/evidence;
- successful application encrypt/decrypt and sign/verify paths without static credentials.

For Secret Manager prove:

- resources are regional as required by the accepted profile;
- current secret versions are enabled and retrievable through the runtime identity;
- rotation/recovery procedure is exercised;
- plaintext secret values do not appear in evidence or logs.

## 14. Prove OTLP and SIEM residency/delivery

Prove real delivery to the approved telemetry/SIEM systems and confirm the declared processing destination remains `me-central2` for the Release 1 GCP acceptance profile.

Capture evidence for:

- TLS/authenticated delivery;
- expected application/resource metadata;
- PHI/secret-safe telemetry behavior;
- backlog/retry visibility;
- SIEM end-to-end receipt;
- destination-region approval/evidence.

Do not infer processing residency from endpoint naming alone; retain provider/vendor evidence supporting the declared processing region.

## 15. Prove worker and scheduler deployment model

Validate the live deployment against `ops/release-1/gcp-worker-scheduler-deployment-model.md` and its machine-readable contract.

For Release 1, prove:

- API-colocated durable/background workers have the required warm instance and CPU behavior;
- lease/idempotency/outbox semantics remain intact across multiple instances;
- there is no unauthenticated worker endpoint;
- explicit scheduled/batch jobs use the approved Cloud Run Jobs / Cloud Scheduler authenticated model where applicable;
- scheduler/runtime service accounts and regions are approved;
- worker failures/backlogs are observable and recoverable.

## 16. Execute recovery and continuity rehearsal

Live acceptance requires measured recovery evidence, not CI fixtures.

Minimum sequence:

1. Record exact RC SHA/digests and rehearsal start timestamp.
2. Identify the approved recovery point.
3. Restore Cloud SQL/PITR to an isolated production-equivalent target.
4. Reconnect dependent services according to the approved recovery procedure.
5. Validate object-storage recovery/versioning behavior required by policy.
6. Start the exact application artifacts against the recovered environment.
7. Run integrity and critical-flow smoke tests.
8. Record recovered-data-through and accepted-healthy timestamps.
9. Calculate actual RPO and RTO.
10. Repeat after defects until required targets are met.

The base evidence contract enforces:

- RPO <= 15 minutes;
- RTO <= 120 minutes.

Do not hand-edit RPO/RTO to values inconsistent with the supplied timestamps; the validator recomputes them.

### Geographic DR boundary

Multi-zone Cloud Run, Cloud SQL regional HA or Memorystore HA does not equal cross-region geographic DR.

Because the current Release 1 GCP evidence profile approves only `me-central2`, this runbook does not claim a second Saudi GCP region. Any geographic-DR design must be separately selected, reviewed, privacy-approved, rehearsed and reflected in a future accepted contract before `geographicDrProven=true` can be asserted.

## 17. Obtain required approvals

Final infrastructure evidence requires explicit approvals from:

- Operations;
- SRE;
- Database;
- Security;
- Privacy;
- Product.

Each approval requires a non-secret approver reference, evidence/reference and timestamp. `PENDING` is not final acceptance.

## 18. Validate final live evidence

Run validation from the **exact RC source checkout** because the base validator binds `release.sourceSha` to the current Git checkout.

```bash
git rev-parse HEAD
node .ci/release-infrastructure-gcp-evidence-contract.mjs \
  --validate /restricted/path/gcp-r3-live-evidence.json \
  --out /restricted/path/gcp-r3-validated-result.json
```

The GCP validator first executes the base R3 validator, then the GCP/KSA overlay.

A CI `--contract-evidence` artifact, generated draft, green PR or successful preflight unit test remains non-production evidence and cannot substitute for this live validation.

## 19. Link GCP R3 and R10 evidence without duplicating secrets

R3-GCP (#185) proves GCP production-equivalent infrastructure and recovery posture. R10 (#98) can consume the same frozen RC/environment evidence for deployment, migration compatibility and rollback.

Reuse controlled evidence references where the same fact satisfies both gates, especially:

- exact immutable digests;
- environment topology;
- database/PITR evidence;
- startup/readiness identity;
- recovery timings;
- operator/change approvals.

Do not duplicate secret values, raw provider responses or sensitive resource inventory across tickets.

## 20. Exit condition

#185 remains open until real GCP/KSA evidence passes the base + GCP validators on the exact RC checkout and all required approvals are present.

G1-G4 engineering, synthetic contract artifacts, documentation, green PR workflows and successful container builds are necessary supporting work, but they do not by themselves prove a production-ready GCP environment, geographic DR, RPO/RTO, or final Release 1 go-live acceptance.
