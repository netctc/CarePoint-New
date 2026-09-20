# Release 1 Functional Expansion Reconciliation (F1–F17)

## Purpose

This document reconciles the functional-expansion line with the current protected Release 1 candidate without re-merging source that is already present.

Authoritative refs for this review:

- Release 1 branch: `release/release-1-integration-go-live-readiness`
- Current Release 1 head: `604f522412c8da6668ee2df42ce58ec3994798c5`
- Functional-expansion branch: `feature/functional-expansion-care-journeys`
- Functional-expansion head: `2251cc4dac6afde735034c3e31962ad2041934f9`
- F1 validated head: `49ae51360776c38b9494a51d749bf789c62ad366`

Git ancestry is decisive for source reconciliation. The functional-expansion head is an ancestor of the current Release 1 head. The current Release 1 head is 329 commits ahead and 0 behind that source head. F1 is also already contained in the Release 1 ancestry. Therefore F1–F17 do not require a cherry-pick or re-merge.

Re-integrating those commits would create unnecessary conflict risk and could duplicate migrations or invalidate later fixes. Source inclusion is not release acceptance.

## Reconciliation rules

1. Do not re-integrate a slice when its source commit is already in Release 1 ancestry.
2. Close or advance a Release 1 requirement only from its own acceptance criteria and evidence, not ancestry alone.
3. Preserve server-side authorization, consent, PHI minimization, audit, idempotency and clinical-finalization semantics during follow-up work.
4. Keep `main` unchanged until formal Go/No-Go promotion.
5. Keep production deployment separate from source reconciliation.
6. Treat external-provider, physical-device, human, security-assessor and regulatory evidence as independent acceptance evidence.
7. Bind final acceptance evidence to the same exact frozen RC SHA and immutable artifacts; evidence from older RCs is historical/mechanical evidence only.

## Current exact-RC automated baseline

On current protected Release 1 SHA `604f522412c8da6668ee2df42ce58ec3994798c5`, all 29 triggered repository workflows completed successfully. The green matrix includes:

- CI, Security Analysis and PostgreSQL Recovery;
- Slice 10 FHIR, Availability Journeys PostgreSQL and Patient Profile PostgreSQL;
- Mobile Native Compatibility and Mobile Release Evidence Contract;
- Release Candidate Evidence, Container Compatibility and Immutable Containers;
- Production Infrastructure, External Integration, UAT, Market Readiness and Promotion Policy evidence contracts;
- Performance Harness, Resilience Rehearsal and Deployment Rehearsal contracts;
- GCP immutable-freeze, Artifact Registry, API/Admin Cloud Run, Cloud SQL PITR, Memorystore failover, Cloud Storage recovery, continuity-bundle and final-acceptance contract workflows.

The current immutable API/Admin publication is also complete from workflow run `35290318388`:

- release version: `release1-604f522412c8da6668ee2df42ce58ec3994798c5`;
- API digest: `sha256:e4574a786d21b251b3032c04cfc74e91fcc7f15385f9fdc6ac94e9163b9adc6f`;
- Admin digest: `sha256:f36e79f7a4d6e5a89c16d3dc11f4b441c0bff161b9cc4db0cbad56615c3f2820`;
- immutable evidence artifact: `10525773892`.

These facts prove repository-side compatibility and current API/Admin artifact identity. They do **not** prove real provider activation, signed-store mobile acceptance, physical-device acceptance, production-equivalent infrastructure, independent penetration testing, human clinical UAT, target-load capacity, KSA regulatory approval or final production deployment/rollback acceptance.

The recorded R3 launch architecture remains OCI/KSA primary (Riyadh primary with Jeddah DR). Google Cloud Dammam remains fallback/portability work unless a later formally approved architecture decision supersedes that baseline. Green GCP contract workflows therefore do not by themselves establish production acceptance.

## Controlled reconciliation matrix

| Slice | Tracker | Source status in Release 1 | Functional scope | Release 1 relationship | Remaining release acceptance |
| --- | --- | --- | --- | --- | --- |
| F1 | #140 | **Contained; tracker CLOSED / COMPLETED** | Structured discovery; clinic/home booking context; provider locations/coverage; buffers; vacations/exceptions; slot controls | Primary functional line for #75 | #75 remains **CODE COMPLETE / RELEASE ACCEPTANCE CONDITIONAL**. Production-equivalent/native UAT and the approved maps/geocoding/routing operating model remain external. |
| F2 | #142 | **Contained; tracker CLOSED / COMPLETED** | Patient rescheduling, earlier-appointment waitlist and change history | Booking lifecycle, notification/status continuity, R7 | Real-device/provider/launch acceptance remains outside source completion. |
| F3 | #143 | **Contained; tracker CLOSED / COMPLETED** | Unbooked-patient availability requests and in-app notice centre | Scheduling/notification continuity | Real external notification channels remain R4/R7 acceptance. |
| F4 | #144 | **Contained; tracker CLOSED / COMPLETED** | Automatic availability detection and consent-scoped in-app alerts | Worker/notification behavior, R7/R8 | Production worker cadence/capacity and external delivery remain environment acceptance. |
| F5 | #145 | **Contained; tracker CLOSED / COMPLETED** | Actionable availability alerts and focused navigation | Patient UX continuity | External push/deep-link entitlement remains R4/R5 work. |
| F6 | #146 | **Contained; tracker CLOSED / COMPLETED** | Patient secure messaging and appointment-context handoff | M14/R7 | Real provider/endpoints and final human UAT remain separate. |
| F7 | #147 | **Contained; tracker CLOSED / COMPLETED** | Patient profile self-service with optimistic concurrency | M02/R7 | Ownership/concurrency regression remains in retained automated gates; broader identity/KYC expansion is not inferred. |
| F8 | #148 | **Contained; tracker CLOSED / COMPLETED** | Unified Patient notification centre and safe entity-aware routing | M14/R7; complements #78 UX | #78 production scheduler/channel/timing/UAT acceptance remains independent. |
| F9 | #149 | **Contained; tracker CLOSED / COMPLETED** | Emergency continuity and safe notification routing | Emergency UAT / R9 | Emergency operations require jurisdiction, licensed-operator and market approval; code does not establish those facts. |
| F10 | #150 | **Contained; tracker CLOSED / COMPLETED** | Medical transport detail, status history and safe notification routing | M12/R7 | Real transport provider/dispatch operations remain R4/R9 dependent. |
| F11 | #151 | **Contained; tracker CLOSED / COMPLETED** | Released laboratory-result notification and safe clinical-order routing | M13/M14/R7 | External laboratory integration and final clinical UAT remain separate. |
| F12 | #152 | **Contained; tracker CLOSED / COMPLETED** | Released diagnostic-report notification and safe report re-authorization | M13/M14/R7 | PACS/DICOM launch scope and real provider acceptance remain R4 dependent. |
| F13 | — | **No canonical slice identified** | No authoritative F13 tracker was found | None can be asserted | Do not invent F13; add only if authoritative evidence is later identified. |
| F14 | #153 | **Contained; tracker CLOSED / COMPLETED** | Patient clinical document centre and one-time secure downloads | M13/R6/R7 | Storage residency, malware scanning and external PACS evidence remain R3/R4/R9 dependent. |
| F15 | #154 | **Contained; tracker CLOSED / COMPLETED** | Document inbox, personal uploads, opened/acknowledged lifecycle and document notifications | M13/M14/R7 | Retention/deletion and storage-residency acceptance remain governed by #77/R3/R9. |
| F16 | #155 | **Contained; tracker CLOSED / COMPLETED** | Patient consent lifecycle self-service and safe re-grant | Consent, R6/R7/R9 | Legal consent text/scope/version approval remains market-specific and independent from source completion. |
| F17 | #156 | **Contained; tracker CLOSED / COMPLETED** | Full Patient encounter detail and secure clinical attachment navigation | M13/R7 | Human clinical UAT and production acceptance remain required. |

## Release 1 P0 implications

### #75 — Discovery, scheduling and visit context

F1 is already integrated and #75 is **CODE COMPLETE / RELEASE ACCEPTANCE CONDITIONAL**. Code covers structured discovery, buffers/exceptions, clinic/home context, coverage behavior, concurrency/idempotency and Patient/provider mobile adoption. Final closure still depends on production-equivalent/native UAT and the launch decision/evidence for maps/geocoding/routing, or a formally approved manual coordinate/address/navigation operating model.

### #76 — WEB-05 Patient Clinical Workspace

#76 is **CODE COMPLETE / RELEASE UAT CONDITIONAL**. The clinical workspace, authorization boundaries, Patient-scoped reads, secure documents and F17 encounter-detail/attachment re-authorization are present. Final production-equivalent human clinical/operational UAT remains required.

### #77 — Data residency and retention/deletion

#77 is **CODE COMPLETE / INFRASTRUCTURE + KSA REGULATORY ACCEPTANCE CONDITIONAL-BLOCKED**. Repository controls implement fail-closed residency declarations, versioned retention rules, preserve-only safeguards, bounded purge/legal-hold paths and PHI-minimized audit evidence. Final closure requires actual launch geography, infrastructure/control-plane residency, approved retention periods, hold governance and Privacy/Legal/Clinical/Operations approval. Engineering must not invent jurisdiction-specific retention periods.

### #78 — Booking/status reminder orchestration

#78 is **CODE COMPLETE / PRODUCTION RUNTIME + CHANNEL + UAT CONDITIONAL**. Durable lifecycle signals, configurable reminder offsets, dedupe, reschedule/cancellation invalidation, preference enforcement and PHI-neutral templates are implemented. Final closure requires production scheduler/worker evidence, Product/Operations-approved launch timing, real enabled notification channels and recipient UAT.

## R3–R10 acceptance boundary on the current RC

### R3 — Production infrastructure and residency (#79)

Repository contracts and current immutable artifacts are green. Final R3 is still open because live OCI/KSA tenancy/resources, exact-RC deployment, independently proven residency/control-plane locations, PostgreSQL/Redis/object-storage/Vault/KMS/Secrets/OTLP/SIEM/worker topology, HA/failover/PITR execution and required approvals have not been established for `604f522...`. Older staging evidence remains historical until rebound to the current immutable artifacts.

### R4 — External integrations (#80)

The current External Integration Acceptance Contract is green, but real-provider E2E remains open. Final evidence must explicitly disposition launch scope and, where enabled, exercise actual PSP, insurance/claims, notification, telehealth, DICOM/PACS, malware-scan and maps/routing providers with success, negative/failure, idempotency and privacy evidence. Mock mode is not final provider acceptance.

### R5 — Native mobile release (#81)

Compatibility builds are green. Production app identities, signing ownership/credentials, signed Android/iOS artifacts, store/privacy/entitlement decisions and the physical-device matrix remain external/human release evidence. Validation-only bundle/application identifiers must not be promoted.

### R6 — Security/adversarial acceptance (#82/#85)

Repository threat-model, static/security analysis and adversarial authorization/PHI regression are green. Independent production-equivalent penetration/adversarial assessment, Security-owner disposition and required retest remain separate acceptance gates.

### R7 — Clinical/operational UAT (#87)

The machine-checkable UAT evidence contract is green. Human execution and sign-off on the exact production-equivalent RC remain required; automated acceptance is not a substitute for clinical/operational UAT.

### R8 — Performance and resilience (#88)

Performance/resilience contracts are green. Final acceptance requires an approved traffic model, target-load execution, controlled production-equivalent failure scenarios and measured recovery objectives on the accepted topology.

### R9 — KSA market/regulatory/clinical safety (#91 and dependencies)

Market-readiness contracts are green. Legal/privacy/regulatory, provider licensing/scope and telemedicine/emergency operating approvals remain human/authoritative external gates. Engineering evidence does not establish regulatory compliance by itself.

### R10 — Immutable RC, deployment and rollback (#96/#97/#98)

The current API/Admin immutable artifact portion of #97 is satisfied for `604f522...` by the published digests above. #97 remains open for signed native artifacts and proof that the accepted production promotion path consumes the exact frozen artifacts without rebuild-by-environment.

Historical isolated R10 exercises proved useful mechanics on prior RCs: exact-artifact PostgreSQL restore and isolated API/Admin boot, previous-filesystem rollback mechanics, and isolated PITR mechanics. Those results remain supporting evidence only. They are not final exact-RC acceptance for `604f522...`.

Final #98 requires production-equivalent execution on the approved launch topology with the current immutable artifacts: deployment identity, migration compatibility, controlled rollback, actual backup/WAL/PITR/failover path, measured RPO/RTO, side-effect reconciliation and required operational approvals.

## Next controlled sequence

1. Complete protected review/merge of this documentation-only reconciliation PR; do not bypass the required independent approval.
2. Treat F1–F17 as source-complete and do not reopen them for duplicate integration work.
3. Preserve current Release 1 head `604f522412c8da6668ee2df42ce58ec3994798c5` and its immutable API/Admin digests as the exact current candidate until a real source defect or an authorized change creates a later candidate.
4. Complete the remaining external gates on one exact frozen RC: R3 live infrastructure/residency, R4 real providers, R5 signed native/device acceptance, R6 external security assessment, R7 human UAT, R8 target-load/resilience/DR evidence, R9 KSA approvals, and R10 production-equivalent deployment/rollback/PITR.
5. If a remaining gate exposes a real source defect, fix only that defect on a focused branch and regenerate exact-RC evidence. Do not weaken authorization, consent, PHI, audit or security controls to satisfy a gate.
6. Promote to `main` only after final Go/No-Go/CAB authorization and all mandatory release gates are accepted.
