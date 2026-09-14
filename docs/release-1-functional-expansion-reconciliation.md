# Release 1 Functional Expansion Reconciliation (F1–F17)

## Purpose

This document reconciles the functional-expansion line with the current Release 1 candidate without re-merging source that is already present.

Authoritative refs for this review:

- Release 1 branch: `release/release-1-integration-go-live-readiness`
- Release 1 head: `5f508d95b387507ba3ef2b8ac44af3792764205d`
- Functional-expansion branch: `feature/functional-expansion-care-journeys`
- Functional-expansion head: `2251cc4dac6afde735034c3e31962ad2041934f9`
- F1 validated head: `49ae51360776c38b9494a51d749bf789c62ad366`

Git ancestry is decisive for source reconciliation:

- `2251cc4dac6afde735034c3e31962ad2041934f9` is an ancestor of the current Release 1 head.
- `49ae51360776c38b9494a51d749bf789c62ad366` is an ancestor of the current Release 1 head.
- Release 1 is ahead of the functional-expansion head and does not require any F1–F17 cherry-pick or re-merge.

Therefore the functional-expansion source through F17 is already contained in Release 1. Re-integrating those commits would create unnecessary conflict risk and could duplicate migrations or invalidate later fixes.

Source inclusion is not release acceptance. Production infrastructure, mobile signing, external providers, security-owner acceptance, human UAT, performance/resilience, KSA regulatory approval, deployment/rollback and CAB approval remain independent gates.

## Reconciliation rules

1. Do not re-integrate a slice when its source commit is already in Release 1 ancestry.
2. Close or advance a Release 1 requirement only from its own acceptance criteria and evidence, not ancestry alone.
3. Preserve server-side authorization, consent, PHI minimization, audit, idempotency and clinical finalization semantics during follow-up work.
4. Keep `main` unchanged until formal Go/No-Go promotion.
5. Keep production deployment separate from source reconciliation.
6. Treat external, human and regulatory evidence as independent acceptance evidence.

## Current exact-RC automated baseline

On authoritative Release 1 SHA `5f508d95b387507ba3ef2b8ac44af3792764205d`, the established repository workflows are green, including CI, Security Analysis, PostgreSQL Recovery, Slice 10 FHIR, Availability Journeys PostgreSQL, Patient Profile PostgreSQL, Mobile Native Compatibility, Release Candidate Evidence, Container Compatibility, Immutable Containers, Production Infrastructure Acceptance Contract, External Integration Acceptance Contract, Mobile Release Evidence Contract, UAT Evidence Contract, Performance Harness Contract, Resilience Rehearsal Contract, Deployment Rehearsal Contract, Market Readiness Evidence Contract and Promotion Policy Evidence Contract.

This proves repository-side automated compatibility for the current RC. It does not prove external provider activation, physical-device release acceptance, production-equivalent infrastructure, target-load capacity, penetration testing, human UAT or KSA Go-Live approval.

## Controlled reconciliation matrix

| Slice | Tracker | Source status in Release 1 | Functional scope | Release 1 relationship | Remaining release acceptance |
| --- | --- | --- | --- | --- | --- |
| F1 | #140 | **Contained; tracker CLOSED / COMPLETED** | Structured discovery; clinic/home booking context; provider locations/coverage; buffers; vacations/exceptions; slot controls | Primary functional line for #75 | #75 is **CODE COMPLETE / RELEASE ACCEPTANCE CONDITIONAL**. Remaining work is production-equivalent/native UAT and the approved launch decision for any real maps/geocoding/routing dependency. Do not re-merge F1. |
| F2 | #142 | **Contained; tracker CLOSED / COMPLETED** | Patient rescheduling, earlier-appointment waitlist and change history | Booking lifecycle, notification/status continuity, R7 | Dedicated PostgreSQL 16 acceptance passed with 35 tests including F2 concurrency, rollback, financial-snapshot preservation and stale-state handling. Remaining physical-device/provider/launch acceptance is outside the slice source tracker. |
| F3 | #143 | **Contained; tracker CLOSED / COMPLETED** | Unbooked-patient availability requests and in-app notice centre | Scheduling/notification continuity | Preserve separation between in-app observation and real external notification/provider acceptance. |
| F4 | #144 | **Contained; tracker CLOSED / COMPLETED** | Automatic availability detection and consent-scoped in-app alerts | Worker/notification behavior, R7/R8 | Worker production cadence/capacity and external channels remain deployment/integration acceptance. |
| F5 | #145 | **Contained; tracker CLOSED / COMPLETED** | Actionable availability alerts and focused navigation | Patient UX continuity | External push/deep-link entitlement remains R4/R5 work. |
| F6 | #146 | **Contained; tracker CLOSED / COMPLETED** | Patient secure messaging and appointment-context handoff | M14/R7 | Production provider/endpoints and final UAT remain separate. |
| F7 | #147 | **Contained; tracker CLOSED / COMPLETED** | Patient profile self-service with optimistic concurrency | M02/R7 | Exact-RC ownership/concurrency regressions are part of the retained baseline; KYC/demographic expansion remains out of scope. |
| F8 | #148 | **Contained; tracker CLOSED / COMPLETED** | Unified Patient notification centre and safe entity-aware routing | M14/R7; complements #78 UX | #78 scheduled reminder runtime/channel acceptance remains independent. |
| F9 | #149 | **Contained; tracker CLOSED / COMPLETED** | Emergency continuity and safe notification routing | Emergency UAT / R9 | Emergency ambulance remains disabled unless jurisdiction, licensed operator, local approval and 24x7 operating requirements are accepted. |
| F10 | #150 | **Contained; tracker CLOSED / COMPLETED** | Medical transport detail, status history and safe notification routing | M12/R7 | Real transport provider/dispatch operations remain R4/R9 dependent. |
| F11 | #151 | **Contained; tracker CLOSED / COMPLETED** | Released laboratory-result notification and safe clinical-order routing | M13/M14/R7 | External laboratory integration and final clinical UAT remain separate. |
| F12 | #152 | **Contained; tracker CLOSED / COMPLETED** | Released diagnostic-report notification and safe report re-authorization | M13/M14/R7 | PACS/DICOM external activation remains R4 dependent. |
| F13 | — | **No canonical slice identified** | No authoritative F13 issue was found | None can be asserted | Do not invent F13. Add it only if an authoritative tracker/commit is later identified. |
| F14 | #153 | **Contained; tracker CLOSED / COMPLETED** | Patient clinical document centre and one-time secure downloads | M13/R6/R7 | Storage residency, malware scanning and external PACS evidence remain R3/R4/R9 dependent. |
| F15 | #154 | **Contained; tracker CLOSED / COMPLETED** | Document inbox, personal uploads, opened/acknowledged lifecycle and document notifications | M13/M14/R7 | Retention/deletion and storage-residency acceptance remain governed by #77/R9. |
| F16 | #155 | **Contained; tracker CLOSED / COMPLETED** | Patient consent lifecycle self-service and safe re-grant | Consent, R6/R7/R9 | Legal consent text/scope/version approval remains market-specific and independent from source completion. |
| F17 | #156 | **Contained; tracker CLOSED / COMPLETED** | Full Patient encounter detail and secure clinical attachment navigation | M13/R7 | Human clinical UAT and production acceptance remain required. |

## Release 1 P0 implications

### #75 — Discovery, scheduling and visit context

F1 is already integrated and #75 is now **CODE COMPLETE / RELEASE ACCEPTANCE CONDITIONAL**. The code-side scope covers structured discovery, buffers/exceptions, clinic/home context, coverage behavior, concurrency/idempotency and Patient/provider mobile adoption. Remaining conditions are release-environment acceptance, including production-equivalent/native UAT and the launch decision for maps/geocoding/routing. If provider-backed routing is not a launch requirement, the approved coordinate/address/manual-navigation operating model must be documented instead.

### #76 — WEB-05 Patient Clinical Workspace

#76 is **CODE COMPLETE / RELEASE UAT CONDITIONAL**. The dedicated clinical workspace, authorization boundaries, patient-context clinical reads, secure documents and the F17 encounter-detail/attachment re-authorization path are present. Final production-equivalent R7 human clinical/operational UAT and sign-off remain required.

### #77 — Data residency and retention/deletion

#77 is **CODE COMPLETE / R3 + REGULATORY ACCEPTANCE CONDITIONAL**. Repository controls implement fail-closed residency declarations, versioned retention rules, preserve-only safeguards, purge/legal-hold paths and PHI-minimized audit evidence. Final closure requires real infrastructure/residency evidence and approved KSA privacy/legal/clinical governance. Engineering must not invent jurisdiction-specific retention periods.

### #78 — Booking/status reminder orchestration

#78 is **CODE COMPLETE / PRODUCTION RUNTIME + CHANNEL + UAT CONDITIONAL**. Durable transactional lifecycle signals, configurable reminder offsets, dedupe, reschedule/cancellation invalidation, preference enforcement and PHI-neutral templates are implemented and validated. Final closure requires production worker/scheduler evidence, approved launch reminder timing, real enabled notification channels and recipient UAT.

## F1 and F2 release-gate decisions

**F1: do not integrate again.** It is already in Release 1 ancestry and its source tracker is complete. Continue only with the remaining #75 release-environment conditions.

**F2: no additional source integration is required.** Its dedicated real-PostgreSQL concurrency/rollback/financial-integrity acceptance was completed and the tracker is closed. Continue only with the dependent release-environment and human acceptance gates.

The same rule applies to F3–F17: their canonical source trackers are already completed and the source is in Release 1. Any new source work must be justified by a concrete release-blocking defect, safety/security/privacy/regulatory finding, data-integrity issue or required launch integration.

## R10 / deployment note

The current authoritative Release 1 candidate has immutable API/Admin artifacts and passed the R10-G10A digest-verification checkpoint. R10-G10B then stopped during the temporary PostgreSQL restore step before candidate API/Admin startup. Cleanup completed without affecting live staging.

The repository contains a known-good isolated C11 PostgreSQL recovery path using a PostgreSQL 16 container, a custom-format logical backup, `--no-owner`, `--no-privileges`, `--exit-on-error` and `--single-transaction`, followed by fixture verification and Prisma migration-status checks. This is a useful comparison baseline only; the G10B root cause must still be determined from the exact sanitized failing restore command and stderr from the staging evidence. Do not weaken restore/deployment safeguards or guess the failure class.

## Next controlled sequence

1. Resolve R10-G10B from the exact sanitized PostgreSQL restore error and rerun the authoritative isolated runtime using the same immutable RC digests.
2. Complete review/merge of this documentation-only reconciliation PR through the protected Release 1 branch process.
3. Treat F1–F17 as source-complete; do not reopen them for duplicate integration work.
4. Execute the remaining release gates: R3 infrastructure/residency, R4 real providers, R5 signed native/mobile acceptance, R6 security-owner and external adversarial acceptance, R7 human UAT, R8 approved target-load/resilience/DR, and R9 KSA regulatory/clinical-safety approval.
5. If any remaining gate exposes a real source defect, fix only that defect on a focused branch and produce a new exact RC SHA. Otherwise preserve the current immutable candidate.
6. Promote to `main` only after the final Go/No-Go/CAB decision and all mandatory release gates are accepted.
