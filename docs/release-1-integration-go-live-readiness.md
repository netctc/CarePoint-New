# Release 1 — Integration & Go-Live Readiness

## Purpose

This phase freezes net-new product features and converts the current CarePoint Next implementation into a single, traceable, deployable and release-governed Release 1 candidate.

The phase is intentionally focused on integration, production validation, operational readiness, clinical/regulatory acceptance and release control. It does not introduce new product modules unless a release-blocking defect or safety/compliance requirement requires a narrowly scoped change.

## Baseline

Initial baseline branch:

`feature/phase-c19-browser-origin-readiness`

Initial baseline commit:

`1e69631a435ad63fe93a902a389d034eb769dd1c`

Release integration branch:

`release/release-1-integration-go-live-readiness`

Known branch condition at phase start:

- `feature/phase-c20-admin-return-path-containment` is currently identical to the C19 baseline and does not yet contain a distinct C20 implementation.
- A parallel security-hardening line exists at `feature/phase-c18-eliminate-global-raw-body`.
- That parallel line contains controls that are not yet present in the C19 baseline, including hosted payment action origin trust, bounded inbound request bodies and global raw-body minimization.
- The two lines diverged after `feature/phase-c15-nonfinancial-http-egress-resilience`, so integration must be deliberate and regression-tested rather than treated as a simple fast-forward.

## Release principles

1. **Feature freeze.** No net-new feature development during Release 1 readiness unless classified as release-blocking.
2. **One canonical release branch.** All approved Release 1 changes converge on the release integration branch.
3. **No silent scope expansion.** Every change must map to an existing requirement, defect, security finding, compliance gate or operational readiness requirement.
4. **Default deny for go-live.** Missing production evidence is treated as not ready.
5. **Automated gates plus human acceptance.** Green CI is mandatory but does not replace clinical UAT, infrastructure validation, penetration testing or operational rehearsal.
6. **Traceability.** Requirements, implementation evidence, automated tests, UAT evidence and release decisions must be linked.
7. **Rollback first.** Every production-affecting integration must have a defined rollback point and data-recovery consideration.

## Workstreams

### R1. Repository and branch consolidation — P0

**Objective:** produce one authoritative Release 1 code line.

Tasks:

- Freeze the C19 baseline as the initial integration point.
- Review the divergent security-hardening line from `feature/phase-c18-eliminate-global-raw-body`.
- Integrate, with conflict review, the following controls where still applicable:
  - hosted payment action trust boundary;
  - bounded inbound JSON/form request bodies;
  - global raw-body minimization.
- Preserve the later C19-line controls:
  - Admin backend egress resilience;
  - LiveKit endpoint readiness;
  - SMART public endpoint readiness;
  - browser-origin readiness.
- Resolve overlapping changes in at least:
  - `services/api/src/main.ts`;
  - `services/api/package.json`;
  - `services/api/.env.example`.
- Ensure every retained focused smoke test is wired into the canonical test chain.
- Re-run the permanent CI, security, PostgreSQL recovery and FHIR/SMART gates on the exact integrated SHA.
- Audit open stacked PRs and classify each as superseded, integrated, retained for history or still actionable.
- Do not update `main` until the integrated candidate passes the release gate.

**Exit criteria:** one integrated SHA with no known missing hardening line and all mandatory automated workflows green.

### R2. Requirements-to-release traceability — P0

**Objective:** establish an auditable matrix from business requirement to release evidence.

Create and maintain a Release 1 traceability matrix with, at minimum:

- requirement/module;
- intended user role;
- implementation module/API/UI;
- database migration where applicable;
- automated acceptance test;
- UAT scenario;
- security/privacy considerations;
- production dependency;
- status: READY / CONDITIONAL / BLOCKED / DEFERRED;
- evidence reference.

The matrix must cover Patient, Doctor, Other Provider, Admin, booking, telemedicine, clinical record, clinical orders/laboratory, documents/diagnostics, finance/insurance/claims, communications, transport/emergency, FHIR/SMART, security, audit and operations.

**Exit criteria:** no P0 Release 1 requirement without implementation and acceptance evidence or an explicit approved deferment.

### R3. Production configuration and infrastructure acceptance — P0

**Objective:** validate the actual production topology, not only development/test adapters.

Validate with deployment evidence:

- PostgreSQL production topology, TLS, HA, backup, PITR and tested restore;
- Redis TLS/authentication, durability/failover and operational monitoring;
- private S3/object-storage policy, KMS encryption, lifecycle and recovery;
- KMS key ownership, IAM least privilege, rotation and recovery/deletion procedures;
- external secret storage and rotation;
- ClamAV availability/signature update/fail-closed behavior if clinical uploads are enabled;
- OpenTelemetry/export path and SIEM delivery;
- HTTPS/TLS certificates, trusted reverse proxy and exact browser origins;
- environment-variable and external-endpoint production preflight;
- scheduler/worker deployment for cleanup, notification outbox, SIEM delivery and other background workloads;
- disaster-recovery runbook and live recovery rehearsal.

**Exit criteria:** production preflight succeeds against the intended infrastructure and recovery evidence meets agreed RPO/RTO targets.

### R4. External integration activation — P0

**Objective:** replace test/mock integration assumptions with contracted production services.

Validate each enabled integration independently:

- LiveKit/TURN for telemedicine;
- payment PSP/acquirer;
- insurer/payer/clearinghouse where insurance/claims are enabled;
- notification provider for push/email/SMS;
- PACS/VNA/DICOMweb where imaging integration is enabled;
- mapping/geocoding/routing for transport/emergency workflows;
- external KMS/HSM and approved clinical signing service where legally required.

For every external integration capture:

- owner;
- production endpoint;
- credential/secret source;
- allowed egress and callback boundaries;
- timeout/retry/idempotency rules;
- webhook/callback signature and replay controls where applicable;
- monitoring and alerting;
- outage/fallback procedure;
- reconciliation procedure where financial;
- data residency/privacy impact.

**Exit criteria:** no production-enabled external integration depends on a mock adapter or undocumented manual workaround.

### R5. Mobile native release readiness — P0

**Objective:** turn the Flutter source applications into signed, testable release applications.

Patient, Doctor and Other Provider apps must each complete:

- generated/versioned Android and iOS runner projects;
- camera/microphone/location permission declarations as applicable;
- secure storage entitlements and validation;
- release signing and package identifiers;
- production API configuration;
- network security configuration;
- push-notification configuration if enabled;
- deep-link/return-flow configuration where required;
- crash reporting/observability policy without PHI leakage;
- device testing on representative OS/device versions;
- degraded-network/offline/reconnection tests;
- accessibility and Arabic RTL release checks;
- store/release packaging readiness.

**Exit criteria:** reproducible signed release builds for all in-scope apps and successful real-device acceptance.

### R6. Security and privacy release gate — P0

**Objective:** independently validate production security boundaries.

Required evidence:

- current threat model;
- independent penetration test covering API, Admin Web and mobile surfaces;
- dependency and static analysis gate;
- authentication/MFA/session replay tests;
- authorization and cross-tenant/cross-patient isolation tests;
- PHI-at-rest and PHI-in-log verification;
- secrets and credential leakage review;
- SSRF/redirect/origin/egress boundary verification;
- rate-limit and abuse testing;
- upload/malware/content-size controls;
- audit integrity and SIEM delivery validation;
- backup/restore confidentiality validation;
- privacy/data-retention/deletion/legal-hold review;
- mobile secure-storage and lost/revoked-session behavior.

**Exit criteria:** no unresolved Critical or High release-blocking finding; Medium findings have documented acceptance or remediation plans.

### R7. Clinical and operational UAT — P0

**Objective:** prove end-to-end workflows with representative users and realistic scenarios.

Minimum UAT personas:

- Patient;
- Doctor;
- at least one non-doctor clinical provider;
- Admin/governance operator;
- Finance/revenue-cycle operator;
- emergency/transport operator if enabled;
- support/operations observer within the intended non-PHI boundary.

Minimum scenarios:

- registration, login, MFA and session management;
- provider credentialing and approval/suspension;
- service publication and availability;
- clinic booking, cancellation and rescheduling;
- telemedicine consent/readiness/join/end;
- home-visit booking if included in launch scope;
- clinical encounter documentation and finalization;
- prescription/laboratory order and result release;
- clinical document upload/release/download;
- patient secure messaging and notification preference flow;
- billing/payment/refund;
- insurance eligibility/prior authorization/claim where enabled;
- emergency ambulance and scheduled transport where enabled;
- FHIR/SMART integration scenarios where exposed to launch partners;
- Admin security, finance, appointment and telehealth operations.

**Exit criteria:** all P0 UAT scenarios passed or formally accepted with bounded workarounds and owners.

### R8. Performance, resilience and failure-mode validation — P0

**Objective:** validate behavior under expected concurrency and dependency failure.

Include:

- API load test against agreed peak and burst profiles;
- concurrent booking contention;
- login/MFA/rate-limit behavior;
- large clinical-document upload boundary;
- telehealth readiness/join burst behavior;
- notification outbox backlog recovery;
- database/Redis dependency degradation;
- external PSP/payer/notification timeout behavior;
- worker restart and lease recovery;
- disaster-recovery restore and application restart;
- mobile network-loss/reconnect tests.

**Exit criteria:** agreed SLOs met and no uncontrolled data corruption, duplicate financial settlement or authorization bypass under tested failures.

### R9. Regulatory, clinical safety and market-readiness gate — P0/P1

**Objective:** ensure Release 1 claims match the target jurisdiction and actual certification state.

Before go-live, document the deployment jurisdiction and decide which features are enabled there. Complete appropriate review for:

- healthcare privacy and sensitive-health-data handling;
- data residency;
- telemedicine consent and retention;
- e-prescription legality and signing requirements;
- medical/laboratory provider authorization;
- emergency/ambulance legal and operational constraints;
- payment/PCI responsibility;
- insurer/claims transaction rules;
- FHIR/national implementation-guide/NPHIES claims;
- patient-facing language and disclaimers;
- clinical safety hazards and mitigations.

No interface or sales material may claim a certification, qualified signature, emergency-service equivalence or national interoperability conformance that has not been validated.

**Exit criteria:** signed market-readiness decision for each enabled regulated capability.

### R10. Release operations, deployment and rollback — P0

**Objective:** make deployment reproducible and reversible.

Prepare:

- release version and immutable tag convention;
- exact commit/SHA inventory;
- database migration plan;
- environment configuration checklist;
- secrets/KMS readiness checklist;
- deployment steps;
- smoke tests after deployment;
- rollback triggers and rollback steps;
- database rollback/data-recovery strategy;
- production monitoring dashboard and alert ownership;
- incident escalation path;
- hypercare plan;
- release notes and known limitations.

**Exit criteria:** successful staging release rehearsal using the same runbook intended for production.

## Feature-freeze exception policy

A new change may enter this phase only if it is one of:

- Severity 1 / Severity 2 defect remediation;
- patient-safety remediation;
- security/privacy remediation;
- regulatory/compliance release blocker;
- data-integrity or financial-integrity remediation;
- integration defect required for an already approved Release 1 capability;
- deployment/observability/recovery requirement.

Every exception must state:

- reason;
- affected requirement;
- regression scope;
- acceptance evidence;
- rollback impact.

## Recommended phase sequence

### Gate 0 — Freeze and baseline

- create release integration branch;
- freeze feature work;
- snapshot known branches/SHAs;
- create master readiness tracker.

### Gate 1 — Code-line consolidation

- integrate divergent hardening;
- resolve conflicts;
- run complete automated regression.

### Gate 2 — Staging production-equivalent environment

- deploy with real production-class dependencies;
- validate migrations, secrets, KMS, Redis, PostgreSQL, S3 and workers.

### Gate 3 — External integrations and mobile builds

- activate production-like provider integrations;
- produce signed mobile release candidates;
- execute device/network testing.

### Gate 4 — Security, performance and DR

- penetration test;
- load/resilience testing;
- restore and failover rehearsal;
- remediate release blockers.

### Gate 5 — UAT and market/compliance sign-off

- execute clinical and operational UAT;
- complete jurisdictional review;
- approve known limitations.

### Gate 6 — Release candidate

- freeze exact SHA;
- tag RC;
- repeat mandatory CI/security/recovery/FHIR gates;
- staging deployment rehearsal;
- final Go/No-Go review.

### Gate 7 — Production Go-Live

- production deployment;
- smoke validation;
- hypercare;
- monitored stabilization;
- final Release 1 tag after acceptance policy is satisfied.

## Release 1 Go/No-Go checklist

Release 1 is **GO** only when all mandatory conditions are satisfied:

- [ ] One canonical integrated release SHA exists.
- [ ] Divergent C16/C17/C18 security controls are reconciled with the C19 line.
- [ ] Mandatory Node/API/Admin/Flutter/FHIR/security/recovery workflows are green on the exact candidate SHA.
- [ ] No open Critical/High release-blocking security finding.
- [ ] Production PostgreSQL, Redis, object storage, KMS, secrets, workers and observability are validated.
- [ ] All enabled third-party integrations use approved production adapters/configuration.
- [ ] Signed mobile release builds exist for all launch apps.
- [ ] P0 UAT scenarios pass.
- [ ] Load/resilience/DR evidence is accepted.
- [ ] Regulatory/clinical-safety review is complete for the launch jurisdiction.
- [ ] Deployment and rollback rehearsal has passed.
- [ ] Monitoring, incident response and hypercare owners are assigned.
- [ ] Known limitations and deferred items are documented.

## Deferred feature candidates

These are valuable but should remain outside the Release 1 integration phase unless a release gate proves them mandatory:

- advanced family/dependent accounts;
- advanced care plans/chronic disease management;
- new AI-assisted clinical capabilities;
- additional FHIR resource breadth solely for feature expansion;
- waitlist/auto-fill optimization;
- advanced provider quality/ranking;
- non-essential analytics expansion;
- advanced fleet optimization beyond launch-operational requirements.

## Definition of Done

Release 1 Integration & Go-Live Readiness is complete when CarePoint has:

1. one approved integrated code line;
2. full release traceability;
3. green mandatory automated gates on the exact candidate;
4. production-class infrastructure and third-party integration evidence;
5. signed and validated mobile release builds;
6. accepted security, privacy, clinical, operational, performance and recovery evidence;
7. a rehearsed deployment/rollback runbook;
8. formal Go/No-Go approval for the intended launch scope and jurisdiction.
