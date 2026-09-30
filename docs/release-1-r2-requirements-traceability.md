# Release 1 — R2 Requirements-to-Release Traceability

## Purpose

This document is the Release 1 requirements-to-release traceability baseline for CarePoint Next. It maps the approved functional/technical specification and approved Clinical Aurora UX/UI proposal to the implementation currently consolidated on the canonical Release 1 branch.

Canonical branch:

`release/release-1-integration-go-live-readiness`

R1 validated baseline used for the review:

`1fbda43a1a4dbcfa111626b85728b1955db68556`

Source-of-truth documents supplied for this project:

- `CarePoint_Next_Especificacion_Funcional_Arquitectura_Tecnica_ES_CORREGIDA(1).docx`
- `CarePoint_Next_Propuesta_Diseno_UI_UX_Futurista_ES_CORREGIDA(1).docx`

The approved functional specification defines a Release 1 MVP around patients, independent providers, booking, clinic/telemedicine/home modalities, basic clinical records, payment, administration, security and audit. The same specification places broader FHIR/SMART/national interoperability, RPM, AI and other advanced evolution after the MVP unless explicitly promoted into launch scope.

The UX/UI proposal defines fourteen priority MVP screens and requires clinical information to remain inside authorized clinical surfaces rather than being exposed through generic operational views.

## Status semantics

| Status | Release interpretation |
| --- | --- |
| **READY** | Implementation and automated acceptance evidence exist and no material Release 1 functional closure gap is known. Later environment/UAT gates may still apply globally. |
| **CONDITIONAL** | The capability is implemented, but production infrastructure, native-device, external-integration, clinical/UAT or jurisdictional evidence remains before Go-Live. |
| **BLOCKED** | An approved Release 1 P0 requirement or required MVP surface is materially missing, incomplete or not yet testable. |
| **DEFERRED** | The approved source places the capability after Release 1, or an explicit release decision keeps it outside the Release 1 blocking scope. |

A green CI result is necessary evidence but is not equivalent to production, clinical, privacy or jurisdictional acceptance.

---

## 1. M01–M16 module traceability

| Module | Release 1 responsibility | Current implementation evidence | Automated evidence | R2 status | Remaining release action |
| --- | --- | --- | --- | --- | --- |
| **M01 Identity & Access** | Accounts, authentication, MFA, sessions and access control | `services/api/src/modules/iam`, `services/api/src/security`, mobile secure-session foundation | CI IAM persistence/authentication; Phase B security acceptance; security workflow | **CONDITIONAL** | R5 real-device secure-storage/session checks; R6 penetration/authz/session testing; R9 privacy review. |
| **M02 Patients** | Unique patient identity/profile, patient-owned continuity and consent relationship | `PatientProfile` persistence; IAM patient registration; consent, documents and clinical domains | IAM smoke; clinical/consent/document slice acceptance | **CONDITIONAL** | R7 end-to-end patient UAT; verify all approved profile/contact semantics and privacy lifecycle under #77. |
| **M03 Provider Registry** | Independent provider profiles, status, credentials and configurable taxonomy | `services/api/src/modules/providers`, `onboarding`, provider credentials/category persistence | Admin B1–B9 and Other Provider O1/O2 acceptance | **CONDITIONAL** | R7 credentialing UAT; R9 market credential rules and expiry/revalidation policy. |
| **M04 Doctors & Specialties** | All doctors, specialty/subspecialty taxonomy and required credentials | Doctor application/domain, provider/credential APIs, Admin Doctors surface | Doctor Flutter analysis; Admin acceptance | **CONDITIONAL** | R5 signed native build; R7 doctor credential/specialty UAT; R9 market credential rules. |
| **M05 Other Providers** | Configurable non-doctor health/transport categories and capability enforcement | Provider-category capability service; O2 service/order/encounter enforcement; capability-aware provider mobile | Other Provider O1/O2 permanent CI gates | **CONDITIONAL** | R5 native build/device tests; R7 non-doctor provider UAT. |
| **M06 Services & Modalities** | Service catalog with clinic, telemedicine and home-visit modality semantics | Scheduling service catalog; modality/coverage data; O2 category publication enforcement | Slice 2 and O2 acceptance | **CONDITIONAL** | Complete Release 1 visit-context/coverage semantics in #75; R7 multimodal UAT. |
| **M07 Availability & Agenda** | Recurring availability, exceptions, blocks and buffers | Recurring availability rules and explicit blocks exist | Slice 2 scheduling acceptance | **BLOCKED** | #75: add/test the approved buffer semantics and complete exception/vacation handling. |
| **M08 Discovery & Search** | Search by specialty, provider type, service, modality and location | Current public service search supports text query and modality | Slice 2 covers service/slot discovery but not full approved structured filter set | **BLOCKED** | #75: implement/test specialty, provider type and location filters while retaining service/modality search. |
| **M09 Booking & Requests** | Transactional booking, visit context, status and rescheduling | Serializable booking, exclusion constraint, idempotency, cancellation/history; Admin rescheduling | Slice 2 concurrency acceptance; Admin rescheduling acceptance | **BLOCKED** | Booking engine is strong, but #75 must close FR-CLN-001 clinic context and home-visit context before Release 1 closure. |
| **M10 Telemedicine** | Consent/readiness, secure join, session operation and termination | LiveKit abstraction/production adapter, scoped signed webhook raw-body handling, consent/readiness/E2EE context | Slice 3; C17 LiveKit readiness; CI/security gates | **CONDITIONAL** | R4 real LiveKit/TURN; R5 camera/mic/native builds; R7 clinical UAT; R9 consent/legal review. |
| **M11 Home Visits** | Home service address, coordinates, instructions, contact confirmation and coverage handling | `HOME_VISIT` modality is supported in scheduling, but structured home-visit context is not evidenced | No complete Release 1 acceptance for the approved home-visit context | **BLOCKED** | #75: persist/expose address, coordinates, instructions, contact confirmation and coverage validation; add field/offline UAT. |
| **M12 Medical Transport & Emergency Ambulance** | Direct emergency ambulance plus scheduled medical transport, separate from normal appointment flow | Persistent emergency dispatch and scheduled transport domains; mobile flows; operational state/history | Slice 8 acceptance | **CONDITIONAL** | R4 fleet/map/routing integration; R5 native/location permissions; R7 operations UAT; R8 load/failure testing; R9 legal/operational review. |
| **M13 Clinical Encounter & Record** | Longitudinal authorized clinical record and encounter documentation | Encrypted clinical revisions, encounter timeline, finalization, orders/labs/documents and access-basis controls | Slices 3.1, 4 and 5 | **BLOCKED** | Backend/mobile foundation is strong, but approved high-priority `WEB-05 Patient Clinical Workspace` is absent. Close #76. |
| **M14 Messaging & Notifications** | Release 1 P0 booking/status reminders; secure messaging is later/P1 scope | Notification preferences, durable outbox/delivery, PHI-neutral gateway; secure appointment-bound messaging implemented | Slice 7 plus C7 notification-outbox hardening | **BLOCKED** | #78: implement appointment lifecycle + scheduled reminder orchestration. Secure messaging does not substitute for FR-NOT-001. |
| **M15 Payments & Billing** | Payment state, tokenized PSP interaction and financial integrity | Billing/payment intents, receipts/refunds, hosted-payment trust, provider ledger; insurance/claims also implemented beyond core P0 | Slice 6/6.2; C13/C14/C16 financial hardening | **CONDITIONAL** | R4 real PSP/acquirer; R7 finance UAT; R8 reconciliation/failure tests. Insurance/claims remain non-blocking unless explicitly in launch scope. |
| **M16 Administration & Compliance** | Admin operations, taxonomy/status/credential controls, security/audit and data governance | Admin appointments/doctors/providers/finance/security/telehealth/analytics plus audit/SIEM/security modules | Admin B1–B9; Security Analysis | **BLOCKED** | Operational Admin is substantial, but FR-DAT-001/002 have no complete Release 1 residency/lifecycle mechanism. Close #77; then R6/R9 evidence. |

### Module-level result

Release 1 has a broad implemented foundation, but R2 identifies six module areas with P0 closure blockers: **M07, M08, M09, M11, M13, M14 and M16**. M09 is blocked by visit-context closure rather than its concurrency engine. M13 is blocked by the approved clinical web surface rather than the encrypted clinical backend.

---

## 2. Release 1 P0 functional requirement traceability

| Requirement | Approved intent | Current evidence | Status | Action |
| --- | --- | --- | --- | --- |
| **FR-SRC-001** | Search by specialty, provider type, service, modality and location | Service text/modality search exists; complete structured specialty/provider-type/location contract not evidenced | **BLOCKED** | #75 |
| **FR-SCH-001** | Recurring availability, exceptions, blocks and buffers | Recurring rules + blocks exist; explicit buffer/full exception semantics incomplete | **BLOCKED** | #75 |
| **FR-BKG-001** | Idempotent, concurrency-safe transactional booking | Serializable transaction + PostgreSQL overlap/exclusion protection + idempotency | **READY** | Preserve under #75 regression; R8 production concurrency/load. |
| **FR-TEL-001** | Valid booking/consent/readiness before telemedicine join | Implemented with LiveKit abstraction and signed webhook path | **CONDITIONAL** | R4/R5/R7/R9 |
| **FR-HOM-001** | Home address, coordinates, instructions, contact confirmation and coverage | Modality exists; structured visit context incomplete | **BLOCKED** | #75 |
| **FR-CLN-001** | Clinic location/instructions and directions handoff | Generic `locationReference` is insufficient evidence of full approved contract | **BLOCKED** | #75 |
| **FR-EMR-001** | Emergency ambulance as a direct flow, separate from ordinary booking | Dedicated emergency domain and mobile flow implemented | **CONDITIONAL** | R4/R5/R7/R8/R9 |
| **FR-PAT-001** | One global patient profile/identity | Unique patient profile tied to account exists | **CONDITIONAL** | R7 + #77 lifecycle/residency |
| **FR-CON-001** | Granular/versioned consent | Consent domain and telehealth consent flow implemented | **CONDITIONAL** | R7/R9 jurisdictional consent review |
| **FR-ENC-001** | Longitudinal authorized encounter/clinical record | Encrypted revision/timeline/finalization backend and mobile evidence | **CONDITIONAL** | #76 closes web clinical surface; R7 clinical UAT |
| **FR-PAY-001** | Payment states with tokenized PSP; no raw card persistence | Tokenized external payment abstraction, financial persistence and hardening | **CONDITIONAL** | R4 real PSP + R7/R8 finance acceptance |
| **FR-NOT-001** | Booking/status reminders with configurable channels | Preference/outbox/delivery infrastructure exists; appointment/time reminder producer not evidenced | **BLOCKED** | #78 |
| **FR-ADM-001** | Admin of specialties/types/status/credentials/policies | Multiple operational Admin domains exist; governance lifecycle policy remains incomplete | **CONDITIONAL** | #77 + R7/R9 |
| **FR-SEC-001** | TLS/encryption/MFA/audit/SIEM/time/security controls | KMS/security/Redis/egress/origin/SIEM/audit controls and automated gates exist | **CONDITIONAL** | R3 target-infrastructure proof + R6 independent security gate |
| **FR-DAT-001** | Residency configurable by deployment jurisdiction | Cloud regions exist, but no complete healthcare-data residency contract/evidence matrix is present | **BLOCKED** | #77 |
| **FR-DAT-002** | Retention/deletion policy | No dedicated cross-domain retention/deletion/purge/legal-hold implementation is evidenced in the Release 1 source tree | **BLOCKED** | #77 |

---

## 3. Approved MVP UX priority screens

The Clinical Aurora source defines the following fourteen priority MVP screens.

| UX ID | Approved MVP screen | Current Release 1 assessment | Status/action |
| --- | --- | --- | --- |
| **WEB-01** | Admin — Command Center | Admin operational shell/analytics/operations exist | **CONDITIONAL** — R7/R8 operational UAT |
| **WEB-02** | Admin — Provider Directory | `apps/admin/app/providers` and provider admin APIs exist | **CONDITIONAL** — R7 credentialing UAT |
| **WEB-03** | Admin — Doctors / Specialties | `apps/admin/app/doctors` and doctor/provider controls exist | **CONDITIONAL** — R7/R9 credential rules |
| **WEB-04** | Admin — Appointment Operations | `apps/admin/app/appointments` + Admin rescheduling/operations APIs exist | **CONDITIONAL** — #75 context closure + R7 |
| **WEB-05** | Clinical — Patient Workspace | No dedicated top-level patient clinical workspace is present | **BLOCKED** — #76 |
| **WEB-06** | Operations — Telemedicine Operations | `apps/admin/app/telehealth` + Admin telehealth operations exist | **CONDITIONAL** — R4/R7 |
| **PAT-01** | Patient Mobile — Home + Emergency Ambulance Quick Action | Patient emergency flow exists in Slice 8 mobile implementation | **CONDITIONAL** — R5 native/location + R7/R9 |
| **PAT-02** | Patient Mobile — Provider Search: Doctors + Other Providers | Search foundation exists; approved structured discovery contract incomplete | **BLOCKED** — #75 |
| **PAT-03** | Patient Mobile — Booking | Booking engine/mobile integration exists; visit-context gaps remain | **BLOCKED** — #75 |
| **PAT-04** | Patient Mobile — Telemedicine Room | Mobile telemedicine room is implemented | **CONDITIONAL** — R4/R5/R7 |
| **DOC-01** | Doctor Mobile — Today / Queue | Doctor mobile scheduling/workspace exists and is analyzed in CI | **CONDITIONAL** — R5/R7 |
| **DOC-02** | Doctor Mobile — Patient Snapshot | Clinical mobile foundation exists; final clinical UX requires R7 validation | **CONDITIONAL** — R5/R7 |
| **OTH-01** | Other Provider — Route / Job | Other Provider workspace + transport workflow exists; home-visit context incomplete | **BLOCKED** — #75 for home visit; R4/R5 for transport |
| **OTH-02** | Other Provider — Service Completion | Provider service-completion foundation exists | **CONDITIONAL** — #75 home-visit context + R5/R7 |

### Design-system readiness

The UX source explicitly recommends a formal Figma/Design System phase: foundations, reusable component library, semantic tokens, responsive layouts, complete component states, critical-journey prototypes, accessibility content specifications and Figma-to-code mapping.

This remains a **CONDITIONAL product-quality gate**, not a reason to introduce unrelated Release 1 features. Release 1 UI work should close approved screens and align with those system rules rather than create additional visual scope.

---

## 4. Cross-cutting NFR traceability

| NFR / release dimension | Approved intent | Current evidence | R2 status | Gate/action |
| --- | --- | --- | --- | --- |
| **Privacy / minimization / consent** | Versioned consent, least privilege, traceable access, configurable retention | Consent, clinical access-basis, encryption and audit implemented | **CONDITIONAL** | #77, R6, R9 |
| **Audit / SIEM** | Critical immutable/auditable events exportable to SIEM | Audit + durable SIEM export hardening exists | **CONDITIONAL** | R3 real SIEM path; R6 integrity/leakage validation |
| **Observability** | Metrics, structured logs, traces and SLO alerts | OpenTelemetry/observability modules and production preflight exist | **CONDITIONAL** | R3 collector/dashboard/alert evidence |
| **Accessibility** | WCAG 2.2 AA-oriented web and equivalent mobile accessibility | UX rules exist; current CI is not a formal WCAG/device acceptance | **CONDITIONAL** | R5/R7 accessibility test evidence |
| **Localization / Arabic RTL** | i18n from start including English/Arabic RTL | mobile localization/RTL foundation exists | **CONDITIONAL** | R5/R7 full journey visual/content checks |
| **Data residency** | Jurisdiction-configurable clinical-data location; avoid unauthorized cross-border replication | No complete release contract/evidence matrix found | **BLOCKED** | #77 + R3/R9 |
| **Retention / deletion** | Configurable retention and governed deletion | No cross-domain policy/lifecycle implementation found | **BLOCKED** | #77 |
| **Availability / recovery** | Production HA, backups, RPO/RTO and recoverability | PostgreSQL recovery workflow passes in CI; production topology not yet proven | **CONDITIONAL** | R3 production-class topology + restore/DR rehearsal |
| **Performance / concurrency** | Safe peak-load behavior and no double booking | Booking concurrency logic tested; full production peak/failure profile not yet accepted | **CONDITIONAL** | R8 load/resilience/failure-mode acceptance |
| **External dependency resilience** | Controlled timeouts/retries/egress/provider failure | Multiple C13–C19 hardening controls implemented | **CONDITIONAL** | R4 real providers + R8 outage tests |
| **Mobile native security/release** | Secure production mobile apps on real devices | Flutter source/analyze/test exists; signed release/device evidence pending | **CONDITIONAL** | R5 |

---

## 5. Release 1 versus post-MVP scope

The approved functional specification must remain the scope authority even where the repository is technically ahead of the roadmap.

| Capability | Approved roadmap position | Current repository state | Release 1 disposition |
| --- | --- | --- | --- |
| **FHIR R4 interoperability** | Release 2 / post-MVP | Substantial Slice 10 implementation and dedicated workflow are present | **DEFERRED / non-blocking for Release 1** unless a named launch partner requires it. Keep tests green. |
| **SMART OAuth/OIDC** | Release 2 / post-MVP | SMART module/public-endpoint hardening exists | **DEFERRED / non-blocking for Release 1** unless explicitly promoted. |
| **NPHIES / national implementation guide certification** | Release 2 / jurisdictional integration | Foundation only; no certification claim should be made | **DEFERRED** |
| **RPM / wearables** | Later evolution | Not required for MVP | **DEFERRED** |
| **AI-assisted clinical capabilities** | Later evolution; autonomous clinical decisions outside MVP | Not required for MVP | **DEFERRED** |
| **Advanced analytics / dispatch optimization** | Later evolution beyond essential operations | Some analytics already exist | **DEFERRED as feature expansion**; only operational safety/monitoring needed for Go-Live remains in scope. |
| **Secure internal messaging** | Release 1 P1 / later than P0 closure | Implemented ahead of minimum P0 | **Non-blocking feature already present**; preserve regression/security coverage. |
| **Insurance/claims expansion** | P1/post-core depending launch decision | Claims/insurance implementation exists | **Non-blocking unless explicitly enabled in launch scope**; if enabled, R4/R7/R8 apply. |

No sales, UI or release note should describe a post-MVP national interoperability or regulatory capability as certified merely because foundation code exists.

---

## 6. Release 1 P0 closure backlog created by R2

The following issues are requirements-closure work, not feature expansion:

- **#75 — P0: Close Release 1 discovery, scheduling and visit-context gaps**
  - FR-SRC-001
  - FR-SCH-001
  - FR-CLN-001
  - FR-HOM-001
- **#76 — P0: Implement Release 1 WEB-05 Patient Clinical Workspace**
  - approved Clinical Aurora MVP WEB-05
  - closes the clinical web-surface gap while preserving strict clinical access boundaries
- **#77 — P0: Implement Release 1 data residency and retention/deletion controls**
  - FR-DAT-001
  - FR-DAT-002
  - cross-domain privacy/governance release evidence
- **#78 — P0: Implement Release 1 booking/status reminder orchestration**
  - FR-NOT-001
  - reuses existing durable notification infrastructure without expanding into marketing/engagement features

These four issues are the primary functional/product blockers discovered by R2. Other remaining workstreams R3–R10 are release-readiness gates around the already-implemented product: infrastructure, real external integrations, signed mobile builds, security, UAT, resilience, jurisdictional review and deployment/rollback.

---

## 7. Evidence map

Representative implementation/release evidence used by R2:

- `.github/workflows/ci.yml`
- `services/api/src/app.module.ts`
- `services/api/prisma/schema.prisma`
- `services/api/src/modules/scheduling/scheduling.module.ts`
- `services/api/src/modules/scheduling/scheduling.service.ts`
- `services/api/src/modules/admin-rescheduling/admin-rescheduling.module.ts`
- `services/api/src/modules/communications/communications.service.ts`
- `services/api/src/modules/communications/notifications.service.ts`
- `apps/admin/app/`
- `docs/slice-2-services-scheduling-booking.md`
- `docs/slice-3-secure-telemedicine.md`
- `docs/slice-3-1-clinical-encounters.md`
- `docs/slice-7-secure-messaging-notifications.md`
- `docs/slice-8-medical-transport-emergency-dispatch.md`
- `docs/release-1-r1-security-hardening-reconciliation.md`
- `docs/release-1-r1-livekit-raw-body-scope.md`
- `docs/release-1-r1-other-provider-o2-reconciliation.md`

Exact R1 baseline workflow evidence before this documentation-only R2 commit:

- CI — SUCCESS
- Security Analysis — SUCCESS
- PostgreSQL Recovery — SUCCESS
- Slice 10 FHIR — SUCCESS

R2 does not treat those workflow results as proof of real production infrastructure or clinical acceptance; those are deliberately assigned to R3–R9.

---

## 8. R2 exit decision

**R2 traceability objective: COMPLETE.**

The purpose of R2 is to identify the authoritative Release 1 scope, map it to implementation/test evidence and convert every material closure gap into an explicit release action. R2 does not require all blockers to be implemented before the traceability workstream itself can close.

Release 1 remains **NO-GO** at this point because #75–#78 are open and R3–R10 have not yet been accepted.

Next workstream:

**R3 — Production Configuration & Infrastructure Acceptance**

R3 must validate the actual target topology and deployment identity for PostgreSQL, Redis, object storage, KMS, secrets, workers, OpenTelemetry/SIEM, TLS/proxy/origins and disaster recovery rather than relying on development/mock adapters or CI-only fixtures.
