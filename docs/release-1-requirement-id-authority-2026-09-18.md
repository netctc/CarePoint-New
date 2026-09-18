# Release 1 — Canonical Requirement-ID Authority and Reconciliation

Cut-off: 2026-09-18  
Implementation branch: `autonomous/completion-2026-09-18`  
Audited source baseline: `0ce3828a21aadbceb44262f3ea328aac616c303b` (`release/release-1-integration-go-live-readiness`)

## Purpose

This document is the canonical ID crosswalk for Release 1 traceability after the 2026-09-17 audit. It does **not** rewrite historical evidence. Historical documents, issue bodies and acceptance logs may retain identifiers that were used when they were created; this document maps those aliases to the identifiers in the approved functional specification so current release decisions use one vocabulary.

Source authority:

- `CarePoint_Next_Especificacion_Funcional_Arquitectura_Tecnica_ES_CORREGIDA.docx`
- `CarePoint_Next_Propuesta_Diseno_UI_UX_Futurista_ES_CORREGIDA.docx`
- `CarePoint_Informe_Estado_Plan_2026-09-17.docx` for the audited implementation state and execution plan.

A code change, test pass or documentation change does not by itself promote a requirement to 100%. Production-equivalent environment evidence, independent security/UAT, device acceptance and regulatory/clinical sign-off remain separate gates.

## Canonical corrections

| Historical/internal wording or alias | Canonical approved ID | Canonical meaning | Rule for current traceability |
| --- | --- | --- | --- |
| `FR-NOT-001`, `FR-NOT`, reminder-notification aliases | **FR-NTF-001** | Booking reminders, status changes and operational communications over configurable channels | New/current material must use `FR-NTF-001`; old evidence may be cited as an alias. |
| `FR-EMR-001`, `FR-EMR`, emergency-flow aliases | **FR-TRN-002** | One-touch, high-visibility Patient emergency ambulance flow with priority dispatch, location/contact, immediate confirmation and status/ETA when available | Do not use `FR-EMR-*` as a current requirement identifier. |
| `FR-CON-001`, `FR-CON`, consent aliases | **FR-PAT-002** | Patient-managed granular consent for access and data processing | Current traceability must use `FR-PAT-002`. |
| `FR-DAT-001` described as data residency | **FR-DAT-001** | Application-level authenticated encryption of clinical fields and high-risk PII | Data residency belongs to the NFR/jurisdictional release gate; it must not replace the approved FR-DAT-001 meaning. |
| Secure messaging described as post-MVP/P1 | **FR-MSG-001 (P0)** | Patient/provider secure messages associated with care context | Secure messaging remains P0 according to the approved functional specification. |

## Canonical functional requirement inventory

The approved specification contains 49 functional requirements: 45 P0 and 4 P1. The IDs below are the only current functional IDs used by this reconciliation.

| Module | Canonical requirements | Priority / audited baseline |
| --- | --- | --- |
| M01 Identity & Access | `FR-IAM-001`, `FR-IAM-002`, `FR-IAM-003` | P0 / 75%, 75%, 75% |
| M02 Patients | `FR-PAT-001`, `FR-PAT-002`, `FR-PAT-003` | P0, P0, P1 / 75%, 75%, 25% |
| M03 Provider Registry | `FR-PRV-001`, `FR-PRV-002`, `FR-PRV-003`, `FR-PRV-004` | P0 / 75% each |
| M04 Doctors & Specialties | `FR-DOC-001`, `FR-DOC-002`, `FR-DOC-003` | P0 / 75% each |
| M05 Other-provider Taxonomy | `FR-TAX-001`, `FR-TAX-002` | P0 / 75% each |
| M06 Services & Modalities | `FR-SVC-001`, `FR-SVC-002`, `FR-SVC-003`, `FR-SVC-004` | P0 / 75%, 75%, 50%, 50% |
| M07 Availability & Agenda | `FR-SCH-001`, `FR-SCH-002` | P0 / 75% each |
| M08 Discovery & Search | `FR-SRC-001`, `FR-SRC-002` | P0, P1 / 75%, 25% |
| M09 Booking & Requests | `FR-BKG-001`, `FR-BKG-002`, `FR-BKG-003`, `FR-CLN-001` | P0 / 75% each |
| M10 Telemedicine | `FR-TEL-001`, `FR-TEL-002`, `FR-TEL-003`, `FR-TEL-004` | P0 / 75% each |
| M11 Home Visit | `FR-HOM-001`, `FR-HOM-002` | P0, P1 / 75%, 25% |
| M12 Medical Transport & Emergency | `FR-TRN-001`, `FR-TRN-002` | P0 / 50%, 75% at the audited pre-implementation matrix |
| M13 Clinical Encounter | `FR-ENC-001`, `FR-ENC-002`, `FR-ENC-003` | P0, P0, P1 / 75%, 75%, 50% |
| M14 Messaging & Notifications | `FR-MSG-001`, `FR-NTF-001` | P0 / 75% each |
| M15 Payments & Billing | `FR-PAY-001`, `FR-PAY-002` | P0 / 75% each |
| M16 Administration & Compliance | `FR-ADM-001`, `FR-ADM-002`, `FR-AUD-001`, `FR-DAT-001`, `FR-DAT-002`, `FR-OPS-001`, `FR-OPS-002` | P0 / 75%, 75%, 75%, 50%, 75%, 75%, 75% |

The percentages above intentionally preserve the audited matrix from 2026-09-17. They are a discrete implementation/evidence scale, not line-of-code completion or production-readiness probability.

## Implementation delta after the audited matrix

The following engineering changes are now present on this branch but do not erase external acceptance gates:

### FR-TRN-001 — scheduled medical transport

The approved requirement is: scheduled medical transport captures origin, destination, date/time, mobility, equipment and companions.

This branch now provides explicit companions/equipment support across:

- shared typed contracts;
- Prisma model and additive migration;
- API validation and persistence;
- Patient scheduling and detail UI;
- Other Provider transport workspace;
- EN/AR/FR/ES localization;
- Slice 8 and mobile-core regression coverage.

The implementation limits companions to a bounded count and equipment to the typed supported set. It does not certify vehicle capability, responder clinical scope, fleet availability or jurisdictional operational readiness. Therefore FR-TRN-001 has moved from a known code gap to **implemented with automated acceptance evidence / external acceptance pending**, not to 100% production acceptance.

### FR-SVC-003 — home-visit operational coverage

Production discovery/activation/booking now requires explicit home-visit coverage configuration (center + positive radius) and retains distance enforcement. A home-visit modality without valid coverage is not advertised as release-ready and cannot be booked under strict production context.

This closes the known optional-coverage implementation gap without choosing a provider radius or changing consent. Real geocoding/address validation and UAT remain separate.

### Current CI boundary

The pull request workflow matrix executes PostgreSQL/API smoke tests, Flutter/mobile-core checks and release-contract workflows. Green CI is evidence of implementation regression quality only. It does not prove real PSP/LiveKit/maps/KMS/storage providers, signed native distribution, real-device behavior, independent penetration/UAT, load/RPO/RTO acceptance or market/clinical approvals.

## Corrected current traceability for the previously divergent rows

| Canonical ID | Current implementation evidence | Current interpretation |
| --- | --- | --- |
| `FR-PAT-002` | consent module, telehealth consent and patient consent flows | Implemented; UAT/jurisdictional acceptance pending. |
| `FR-TRN-001` | transport module + typed logistics fields + additive migration + Patient/Provider mobile rendering + Slice 8 tests | Code gap addressed on this branch; external operational acceptance pending. |
| `FR-TRN-002` | emergency module, persistent dispatch workflow, Patient one-touch location flow, responder/operations APIs, Slice 8 | Implemented; real operator/location/device/legal acceptance pending. |
| `FR-MSG-001` | communications module and secure care-context messaging | P0 and implemented; real delivery/UAT remains. |
| `FR-NTF-001` | notification preferences, durable delivery/outbox and booking/status reminder orchestration | P0 and implemented with automated evidence; real provider delivery/UAT remains. |
| `FR-DAT-001` | clinical envelope authenticated field encryption and KMS/security controls | Partial coverage. High-risk PII classification remains incomplete; transport contact/address/location data must not be claimed covered until classification/policy is approved and implementation follows it. |
| `FR-DAT-002` | data-governance retention/deletion/holds implementation and evidence | Implemented foundation; legal policy and production acceptance remain. |

## Historical R2 status correction

`docs/release-1-r2-requirements-traceability.md` is retained as historical R2 evidence. Its statements that discovery/buffers/visit context/WEB-05/retention/reminders were absent are no longer authoritative for current implementation state. Issues #75–#78 remain useful acceptance/governance trackers, but their original gap descriptions must be read together with the code and later acceptance evidence.

In particular, current release decisions must not repeat these historical errors:

- do not call emergency ambulance `FR-EMR-001`; use `FR-TRN-002`;
- do not call granular consent `FR-CON-001`; use `FR-PAT-002`;
- do not call notifications `FR-NOT-001`; use `FR-NTF-001`;
- do not redefine `FR-DAT-001` as residency;
- do not defer `FR-MSG-001` out of P0.

## Remaining non-autonomous release gates

This reconciliation does not alter the project’s NO-GO production state. Remaining gates include production-equivalent infrastructure and recovery evidence, real external providers, signed native app identities/runners/devices, independent security acceptance, clinical/operational UAT, performance/resilience/RPO/RTO evidence on the exact RC, and regulatory/clinical/market approvals.
