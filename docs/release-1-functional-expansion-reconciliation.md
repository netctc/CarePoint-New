# Release 1 Functional Expansion Reconciliation (F1–F17)

## Purpose

This document reconciles the functional-expansion line with the current Release 1 candidate without re-merging source that is already present.

Authoritative refs at the time of this review:

- Release 1 branch: `release/release-1-integration-go-live-readiness`
- Release 1 head: `5f508d95b387507ba3ef2b8ac44af3792764205d`
- Functional-expansion branch: `feature/functional-expansion-care-journeys`
- Functional-expansion head: `2251cc4dac6afde735034c3e31962ad2041934f9`
- F1 validated head: `49ae51360776c38b9494a51d749bf789c62ad366`

Git ancestry is decisive for source reconciliation:

- `2251cc4dac6afde735034c3e31962ad2041934f9` is an ancestor of the current Release 1 head.
- `49ae51360776c38b9494a51d749bf789c62ad366` is an ancestor of the current Release 1 head.
- Release 1 is currently 17 commits ahead of the functional-expansion head and 0 commits behind it.

Therefore the functional-expansion source through the current F17 branch head is already contained in Release 1. Re-cherry-picking or re-merging F1–F17 would be incorrect and could duplicate migrations, regress later fixes, or create false release evidence.

This document separates **source inclusion** from **release acceptance**. Source presence does not close P0, UAT, security, infrastructure, mobile-signing, external-provider, performance/resilience, regulatory, deployment, rollback, or human-approval gates.

## Reconciliation rules

1. Do not re-integrate a slice when its source commit is already in Release 1 ancestry.
2. Close or advance a Release 1 requirement only from its own acceptance criteria and evidence, not from ancestry alone.
3. Preserve server-side authorization, consent, PHI minimization, audit, idempotency, and clinical finalization semantics during any follow-up work.
4. Keep `main` unchanged until formal Go/No-Go promotion.
5. Keep production deployment separate from source reconciliation.
6. Treat external/human/regulatory evidence as independent acceptance evidence; never infer it from a green source build.

## Controlled reconciliation matrix

| Slice | Tracker | Functional scope | Source in current Release 1 ancestry | Release 1 relationship | Data/schema impact | API/client impact | Security / privacy considerations | KSA / market considerations | Existing evidence visible in tracker | Remaining Release 1 acceptance |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| F1 | #140 | Structured discovery; contextual clinic/home booking; persisted visit context; provider locations, coverage, buffers, vacations/exceptions; explicit slot controls | **YES** | Directly addresses #75; contributes to R5/R7 | Persistence/migrations were permitted by scope | API + Patient/Doctor/Other Provider client journeys | Preserve role/capability boundaries, booking idempotency and authorization | Location/coverage/routing activation remains dependent on launch-market operating model and external-provider decisions | F1 validated head is `49ae51360776c38b9494a51d749bf789c62ad366`; ancestry proves inclusion | Validate #75 criteria on the current RC, including structured filters, buffers/exceptions, clinic/home context, coverage rejection paths, concurrency and client acceptance. **Do not re-merge F1.** |
| F2 | #142 | Patient rescheduling, earlier-slot waitlist, change history | **YES** | Extends booking lifecycle; supports #78 notification/status behavior and R7 | Adds/uses waitlist/change-history persistence and transactional inventory semantics | API + Patient UI + provider demand summary | Atomic inventory transfer, optimistic concurrency, idempotency, no patient identity leakage in provider demand summary | No clinical-priority/FIFO promise; operating policy must not imply triage semantics | Tracker defines durable idempotency, rollback, financial snapshot and concurrency acceptance | Re-run exact-RC booking/reschedule concurrency and financial-integrity acceptance; ensure obsolete reminder/waitlist state is safely invalidated. |
| F3 | #143 | Availability requests for unbooked patients and in-app notice centre | **YES** | Product continuity enhancement; interacts with scheduling/notifications but is not itself a Release 1 P0 closure substitute | Availability request/notice persistence | API + Patient client | Ownership, bounded/deduplicated requests, explicit opt-in, no automatic booking | No market-specific slot promise or triage inference | Tracker requires PostgreSQL isolation/idempotency/booking/withdrawal checks | Confirm exact-RC regressions remain green; do not use F3 as evidence for external notification activation. |
| F4 | #144 | Automatic availability detection and consent-scoped in-app alerts | **YES** | Notification infrastructure enhancement; contributes to R7/R8 worker behavior | Additive exactly-once-per-version notification bookkeeping | Worker + API + Patient notifications | Consent scope limited to in-app; race-safe dedupe; PHI-neutral event model | Worker cadence/capacity and external channels require approved operational configuration | Tracker requires real PostgreSQL concurrency/rollback/idempotency acceptance | Validate worker scheduling and production deployment evidence separately under R3/R8; no external-channel inference. |
| F5 | #145 | Actionable availability notifications and focused navigation | **YES** | Patient UX continuity enhancement | No material schema change stated in tracker | Flutter navigation / notification handling | Re-authorize owned request; notification event does not grant data access | No deep-link/push entitlement implied | Tracker defines version-aware read semantics and safe degradation | Verify current RC navigation/ownership regressions; external push remains R4/R5 work. |
| F6 | #146 | Patient secure messaging and appointment-context handoff | **YES** | Supports M14/R7 communication journeys; not a substitute for #78 scheduled reminders | Reuses existing secure conversation persistence | Patient client + existing secure messaging API | Server-derived parties, membership authorization, encrypted message storage, stable client intent ID, PHI-neutral notifications | Production endpoint/provider activation is separate | Tracker records source candidate `4112f52e4683e4a99c48a34bd34825fcd86baed4`; completion evidence must be taken from exact validated ancestry/workflows, not assumed here | Confirm exact-RC secure-message authorization, appointment eligibility, attachment access and notification navigation regressions. |
| F7 | #147 | Patient profile self-service with optimistic concurrency | **YES** | Closes a Patient self-service gap; supports M02/R7 | Existing PatientProfile fields; no broad demographic expansion | PATIENT-only GET/PATCH + Patient UI | Principal-derived ownership, stale-write rejection, sanitized audit metadata | Identity/KYC/national-ID expansion remains out of scope | Tracker records exact validated head `5b79b337eb49253364e5e3e7e13ed643d77c8183`, 18/18 workflows SUCCESS and PostgreSQL/native/security evidence | Preserve exact-RC concurrency/ownership checks; no additional source integration required. |
| F8 | #148 | Unified Patient notification centre with entity-aware navigation | **YES** | Supports M14/R7; contributes to #78 UX but does not by itself prove scheduled reminders | Reuses notification persistence | Patient client + existing notification APIs | Allowlisted entity routes; raw IDs/template metadata not rendered; destination re-authorization | External push/SMS/email activation remains separate | Tracker records exact validated head `c8427fa608efacf716ea45b5906256dace79442a`, 18/18 workflows SUCCESS and CodeQL/native/PostgreSQL evidence | Validate #78 scheduled reminder production separately; preserve safe routing on current RC. |
| F9 | #149 | Emergency continuity, active-request re-entry and safe notification routing | **YES** | Supports emergency UAT / R9 clinical-safety boundaries | No backend/schema change stated for validated increment | Patient client | Patient ownership re-authorization; list/notification data is not authorization | Emergency ambulance must remain disabled unless jurisdiction/operator/approval/24x7 requirements are accepted | Tracker records exact validated head `38f0784d692bbb73bc180d3ee00ef679b05a36d7` and complete workflow/native/security evidence | Final R9 #94 clinical-safety/activation approval remains mandatory. |
| F10 | #150 | Medical transport detail, status history and notification routing | **YES** | Supports M12/R7 | No backend/schema change stated for validated increment | Patient client + existing transport API | Owned-detail re-fetch, state/ownership checks, safe notification semantics | Real transport provider/dispatch operations remain R4/R9 dependent | Tracker records exact validated head `b61db1c6acfe38829846ab3d9e838a0b4af1031d` and complete workflow/native/security evidence | Validate launch provider operations and UAT separately; no source re-integration required. |
| F11 | #151 | Patient notification on released laboratory results | **YES** | Supports clinical continuity and M13/M14/R7 | Notification persistence coupled transactionally to result release | Clinical order backend + Patient notification/detail client | Atomic release + PHI-neutral notification; patient detail re-authorizes | External lab integration and market clinical policy remain separate | Tracker defines acceptance intent but does not provide a final exact-head completion summary in the issue body reviewed | Confirm exact-RC backend transaction/dedupe/authorization tests and final workflow evidence before claiming acceptance. |
| F12 | #152 | Patient notification on released diagnostic reports | **YES** | Supports M13/M14/R7 | Notification persistence transactionally coupled to report release | Diagnostic report backend + Patient client | No findings/impression/PACS metadata in notification; re-authorization required | PACS/DICOM external activation remains R4 dependent | Tracker defines acceptance intent but does not provide a final exact-head completion summary in the issue body reviewed | Confirm exact-RC transaction rollback, dedupe, release-state authorization and client fail-closed tests. |
| F13 | — | No canonical F13 issue was identified in the repository issue set reviewed | **NO CANONICAL SLICE IDENTIFIED** | None can be asserted | Unknown | Unknown | Unknown | Unknown | No authoritative F13 tracker found | Do not invent F13. If an authoritative commit/issue is later identified, add it with evidence. |
| F14 | #153 | Patient clinical document centre and one-time secure downloads | **YES** | Supports M13/R6/R7 | Additive short-lived single-use grant persistence | Document API + Patient client | Token hash only, authenticated/no-store download, patient authorization, no storage/encryption metadata in DTO | Storage residency, malware scanning and external PACS evidence remain R3/R4/R9 dependent | Tracker states F14 scope; F15 identifies validated F14 head `c052c1cb76b524d6f0eae642a17f217ad5523548` | Confirm current-RC one-time-grant replay denial, authorization, malware/storage controls and data-residency dependencies. |
| F15 | #154 | Document inbox, personal uploads, opened/acknowledged lifecycle and document notifications | **YES** | Supports M13/M14/R7 | Adds per-patient opened/ack state; uses encrypted PATIENT_UPLOAD pipeline | Document backend + Patient client | Only owner-created PATIENT_UPLOAD can be removed; provider documents immutable; secure grants and PHI-neutral notifications retained | Retention/deletion and storage residency remain governed by #77/R9 | Tracker defines full vertical-slice acceptance but reviewed issue body does not provide final exact-head workflow summary | Confirm exact-RC ownership/removal boundaries, acknowledgement idempotency, release notification dedupe and #77 lifecycle behavior. |
| F16 | #155 | Patient consent lifecycle self-service and safe re-grant | **YES** | Supports consent requirements, R6/R7/R9 | Consent lifecycle records; no new free-form scopes | Consent API + Patient client | Ownership-scoped replay of original scope/version/provider; expired/inactive-provider rejection; idempotency | Legal consent text/scope/version approval remains market-specific and outside engineering | Tracker defines required permanent backend/mobile regressions; no final exact-head summary in reviewed body | Validate exact-RC consent ownership, idempotency and policy behavior; R9 legal/privacy approval remains independent. |
| F17 | #156 | Full Patient encounter detail and secure clinical attachment navigation | **YES** | Supports M13/R7 and Patient clinical continuity | No new schema/migration/endpoint by scope | Patient client over existing clinical/document APIs | Read-only patient view; exact appointment re-fetch; attachment navigation re-authorizes through document centre | Clinical documentation policy/UAT remains required | Tracker defines permanent Flutter regressions; no final exact-head completion summary in reviewed body | Confirm exact-RC role/ownership fail-closed behavior, full field rendering, RTL and attachment re-authorization. |

## P0 implications

### #75 — Discovery, scheduling and visit context

F1 source is already present in Release 1 and is the primary functional implementation line for #75. The next action is **acceptance reconciliation**, not source integration. #75 may only advance after the current Release 1 candidate proves its full definition of done, including:

- structured specialty/provider-type/service/modality/location discovery;
- deterministic pagination;
- buffer and exception/vacation behavior;
- clinic location/instructions/directions context;
- home-visit address/coordinates/instructions/contact confirmation;
- configured coverage rejection behavior;
- persistence/backfill correctness;
- booking concurrency/idempotency regression;
- Patient/Doctor/Other Provider acceptance where applicable.

### #76 — WEB-05 Patient Clinical Workspace

F17 improves Patient Mobile clinical detail but does not automatically satisfy the approved WEB-05 clinical workspace. #76 remains an independent web-surface and authorization acceptance item until its dedicated route, RBAC/ABAC, cross-patient isolation, clinical timeline/orders/documents, localization/accessibility and R7 evidence are proven.

### #77 — Data residency and retention/deletion

F14/F15/F16 strengthen document/consent lifecycle behavior but do not replace #77. Residency selection, policy-driven retention/deletion/anonymization, holds, backup/object-storage lifecycle, dry-run reporting and KSA policy approval remain independent P0 work.

### #78 — Booking/status reminder orchestration

F2/F4/F8 and later notification slices materially strengthen notification/event infrastructure and user navigation. They do not by themselves prove the Release 1 scheduled appointment reminder contract. #78 remains open until the current RC proves booking/status events, configurable reminder timing, preferences, scheduled production, dedupe, cancellation/reschedule invalidation, timezone behavior, worker deployment and launch-channel acceptance.

## F1 release-gate decision

**Decision: do not integrate F1 again.**

F1 is already in the ancestry of the current Release 1 head. The correct replacement for the previously proposed “integrate F1 first” step is:

1. Prove ancestry and record it in release evidence.
2. Validate the current Release 1 candidate against the #75 F1-derived acceptance contract.
3. Run the complete exact-SHA Release 1 automated gate set on any new candidate only if source/evidence changes are made.
4. Keep #75 open until its remaining acceptance criteria are actually proven.

A documentation-only reconciliation must not be represented as a new functional Release Candidate or as production approval.

## R10 / deployment note

The current authoritative Release 1 candidate has immutable API/Admin artifacts and passed the R10-G10A digest verification checkpoint. The later R10-G10B isolated-runtime attempt stopped during the temporary PostgreSQL restore stage before API/Admin startup. That restore review is independent of F1–F17 source reconciliation and must be resolved with the exact sanitized restore command/error evidence from the staging rehearsal. Do not infer a root cause or weaken restore/deployment safeguards without that evidence.

## Next controlled sequence

1. Resolve the authoritative R10-G10B PostgreSQL restore review using exact staging evidence.
2. Use this matrix to reconcile each slice against the current RC and its owning Release 1 P0/UAT/security/regulatory acceptance criteria.
3. Treat F1 as already integrated; execute #75 acceptance on the current RC instead of re-merging F1.
4. Continue F2 → F17 acceptance slice by slice, changing source only when a concrete acceptance defect is found.
5. After all release-blocking source changes are complete, freeze a new exact SHA and rerun the full mandatory Release 1 gate set before any Go/No-Go consideration.
