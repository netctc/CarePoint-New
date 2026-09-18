# Release 1 — R10 Release Operations, Deployment & Rollback Readiness

Status: **BLOCKED / IN PROGRESS**  
Tracker: #96  
Starting baseline: `dda4eb6d938ec6a2e02c86b126420a695b64ed73`  
Canonical branch: `release/release-1-integration-go-live-readiness`

## 1. Purpose

R10 is the final Release 1 engineering/operations gate. It converts the validated source branch into an exact, immutable, observable and reversible Release Candidate (RC), then requires production-equivalent deployment and rollback evidence before any promotion to `main` or production Go-Live.

R10 does not replace the earlier gates. It consumes their evidence and refuses to treat a green source branch as equivalent to a production-ready deployment.

## 2. Approved baseline

The approved CarePoint technical specification calls for reproducible builds, SAST/dependency scanning/tests, controlled migrations, canary/blue-green for high-risk changes, isolated dev/staging/prod environments, observability, HA/PITR and expand/contract database changes.

The KSA/GCC launch plan adds a controlled release gate with protected branch governance, unit/integration/e2e, OpenAPI diff, SBOM, secret scan, reproducible artifacts, release notes, green CI and a tested rollback. It also requires Release CAB governance, launch war-room/hypercare and operational incident/payment/telehealth/DR runbooks.

## 3. Static repository review

### Existing strengths

- CI builds and tests the Node workspaces against PostgreSQL/Redis and executes the Admin/Provider/Slice acceptance families.
- The same CI analyzes Patient, Doctor and Other Provider Flutter source.
- Separate Security Analysis, PostgreSQL Recovery and Slice 10 FHIR workflows provide additional release evidence.
- `prisma migrate deploy` is exercised in CI.
- `/api/v1/health` and `/api/v1/health/ready` provide liveness/readiness and PostgreSQL/Redis dependency status.
- Earlier R3/R4/R6/R8/R9 work established production preflights, external-provider trust controls, security evidence and high-risk emergency activation gating.

### Gaps that remain external or operational

- R3 still needs the authoritative production deployment/IaC/registry source and real environment evidence (#79).
- Native signed Android/iOS artifacts remain blocked by #81.
- Release/main promotion protection remains #84.
- A production-equivalent deployment/rollback rehearsal has not yet been proven (#98).
- Immutable deployable artifact/SBOM/provenance evidence remains incomplete (#97).

## 4. R10 source-side release identity control

R10 adds an explicit runtime Release Candidate identity contract.

Production requires:

- `CAREPOINT_RELEASE_VERSION` — approved release/RC version, for example `1.0.0-rc.1` once that version is formally selected.
- `CAREPOINT_RELEASE_SHA` — exact full 40-hex validated Git commit SHA.

Optional sanitized correlation fields:

- `CAREPOINT_RELEASE_SOURCE_REF` — branch/tag/ref used to freeze the candidate.
- `CAREPOINT_RELEASE_BUILD_ID` — CI/build-system correlation identifier.
- `CAREPOINT_RELEASE_ARTIFACT_DIGEST` — immutable `sha256:<64-hex>` artifact/image digest when available.

Production startup fails closed if the required version/SHA is missing or malformed. The health and readiness responses expose the sanitized release identity so Operations can prove which exact candidate is serving traffic. These fields must never carry secrets, tokens, credentials, PHI, patient identifiers or sensitive infrastructure details.

Automated acceptance: `npm --workspace @carepoint/api run r10:release-identity`.

## 5. Release Candidate evidence package

The final RC package must bind one exact candidate to all relevant evidence:

| Evidence | Requirement |
| --- | --- |
| Source | full Git SHA and approved version/tag |
| API | immutable artifact/image digest |
| Admin | immutable artifact/image digest |
| Mobile | signed Android/iOS artifact references and checksums from #81 |
| Dependencies | package lock/mobile lock hashes and verification result |
| SBOM | deployable artifact SBOM using the approved build tooling |
| Database | exact migration set and pre/post schema state |
| Configuration | schema/version plus enabled/disabled launch features, no secret values |
| Validation | exact CI, Security, PostgreSQL Recovery and FHIR run IDs/results |
| Provenance | signing/attestation suitable for the selected registry/platform |
| Release notes | scope, schema/config/integration/operator changes, known risks/waivers |

The pipeline should build once and promote the same immutable artifact between approved environments where the target platform permits it. Production must not rebuild from a moving branch.

## 6. Pre-deployment Go/No-Go

Release CAB must verify before deployment:

1. all Release 1 P0 blockers are closed or formally accepted by authorized ownership;
2. #84 promotion protection is active;
3. exact RC SHA has green mandatory automated gates;
4. R6/R7/R8/R9 security, UAT, performance/resilience and market/clinical approvals are accepted;
5. immutable artifacts and manifest from #97 are frozen;
6. production/staging-equivalent environment from #79 is approved;
7. PITR/backup checkpoint is confirmed;
8. every new database migration is reviewed for compatibility and lock/data risk;
9. secrets/configuration/provider endpoints pass readiness without exposing values;
10. deployment owner, rollback authority, rollback triggers, change window and incident contacts are recorded.

## 7. Database migration rule

CarePoint Release 1 must not depend on blind down migrations.

Prefer expand/contract changes so the previous approved application artifact remains compatible with the post-migration schema during the rollback window. Before a release, classify every migration introduced since the currently deployed version as compatible, conditionally compatible or incompatible/destructive.

For destructive or incompatible schema/data changes, the Release CAB must approve a specific maintenance/forward-fix/PITR recovery plan and the data-loss/RPO implication before deployment. C11 recovery evidence is valuable but does not replace a production-equivalent migration/rollback rehearsal.

## 8. Controlled deployment sequence

1. Freeze RC SHA, artifact digests, manifest and release notes.
2. Record current deployed SHA/version/artifacts and schema state.
3. Verify backup/PITR and rollback authority.
4. Apply approved schema changes.
5. Deploy RC through the target platform's approved rolling, canary or blue-green strategy.
6. Verify `/health` and `/health/ready` return the expected release version/SHA and dependency state.
7. Execute P0 operational smoke journeys: IAM/MFA, provider access, discovery/booking, clinical isolation, payment if enabled, notifications, telehealth if enabled, and emergency only when explicitly approved/enabled.
8. Verify workers, queues/outboxes, OTLP, SIEM, external-provider health and error handling.
9. Increase traffic only under approved SLO/business/clinical-safety observations.
10. Record release outcome and open the launch war-room/hypercare window.

## 9. Application rollback

Application rollback must use a previous immutable approved artifact, never a fresh rebuild. During rehearsal:

- deploy the RC;
- trigger the approved rollback condition or controlled test;
- restore the previous artifact;
- prove runtime identity has returned to the previous version/SHA;
- verify schema compatibility and worker/idempotency behavior;
- rerun critical P0 smoke journeys;
- reconcile any payment/webhook/notification/provider side effects created during the attempt.

## 10. PITR/data recovery

If application rollback is insufficient and data/schema restoration is required, use the approved PostgreSQL PITR/restore process. Capture the actual recoverable point and elapsed recovery time and reconcile them with R8/#90 targets. Restore must be rehearsed in an isolated production-equivalent environment before production Go-Live.

## 11. Rollback trigger categories

Engineering must not invent final numeric thresholds. Release CAB/SRE/Product/Security/Clinical owners must approve thresholds for categories such as:

- sustained availability/error degradation;
- database/migration failure;
- authentication or privileged-access outage;
- cross-account authorization/privacy defect;
- double booking or booking-state integrity failure;
- payment duplication/reconciliation failure;
- broad telehealth failure;
- notification/provider side-effect corruption;
- emergency dispatch misbehavior when enabled;
- Critical/High security or clinical-safety signal.

Any confirmed patient-safety, clinical-data-isolation, financial-integrity or severe security/privacy defect is a release-stop condition regardless of rollout progress.

## 12. Hypercare / launch war-room

For the approved pilot/commercial window, record named Release, Operations, Support, SRE, Engineering, Security, Product and required Clinical/Privacy escalation ownership. Track service health, booking/payment/telehealth/notification behavior, provider/patient blockers, privacy/security events and rollback readiness.

No public GitHub issue should contain PHI, credentials, private keys, exploit details, restricted contracts or sensitive infrastructure evidence. Use sanitized immutable references to controlled evidence stores.

## 13. R10 blockers and dependencies

Dedicated blockers:

- #97 — immutable RC artifact/manifest/SBOM/provenance and exact deployed-build identity.
- #98 — production-equivalent deployment, migration and rollback rehearsal.

Material inherited dependencies include #79, #81, #84, #85, #87, #89, #90, #92, #93 and #94 plus any still-open product P0 blocker tracked by #70.

## 14. Exit criteria

R10 is READY only when the exact final Release Candidate has:

- complete immutable/reproducible artifact evidence;
- exact runtime source/build identity;
- all mandatory automated gates green on the final SHA;
- approved infrastructure, integrations and signed clients;
- accepted UAT/security/performance/resilience/regulatory/clinical gates;
- successful production-equivalent deployment and rollback rehearsal;
- verified database migration/recovery behavior;
- final release notes/runbooks/CAB decision;
- successful production deployment/post-deploy smoke/hypercare acceptance.

Until then, `main` remains unchanged and Release 1 remains NO-GO for production promotion.
