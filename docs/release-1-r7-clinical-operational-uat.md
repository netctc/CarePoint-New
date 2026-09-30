# Release 1 — R7 Clinical and Operational UAT

## 1. Purpose

R7 is the Release 1 clinical and operational User Acceptance Testing workstream. It converts the approved CarePoint functional/technical specification and UX/UI baseline into an auditable acceptance suite for the exact Release Candidate.

Canonical branch:

`release/release-1-integration-go-live-readiness`

R7 planning baseline:

`985898fd4b2aaeded1372d12b111287a731b99ad`

R7 tracker: #87

R7 does not replace automated CI, security, integration, resilience or regulatory gates. UAT proves that the in-scope Release 1 product behaves correctly and safely from the perspective of its intended operational roles.

## 2. Source baseline and scope discipline

The approved functional/technical specification requires separate UAT scenarios for:

- patient;
- doctor;
- non-medical/Other Provider;
- administrator.

The Release 1 P0 product scope includes IAM/MFA, patient, independent providers, Doctor App/all specialties, configurable Other Provider taxonomy, services, availability, search, booking, clinic/telemedicine/home modalities, scheduled medical transport, one-touch emergency ambulance/basic dispatch, basic encounter, notifications, payments, administration, audit and encryption.

The approved UX baseline identifies the priority MVP surfaces:

- WEB-01 Admin Command Center;
- WEB-02 Admin Provider Directory;
- WEB-03 Admin Doctors / Specialties;
- WEB-04 Admin Appointment Operations;
- WEB-05 Clinical Patient Workspace;
- WEB-06 Telemedicine Operations;
- PAT-01 Patient Home + Emergency Ambulance Quick Action;
- PAT-02 Patient Provider Search;
- PAT-03 Patient Booking;
- PAT-04 Patient Telemedicine Room;
- DOC-01 Doctor Today / Queue;
- DOC-02 Doctor Patient Snapshot;
- OTH-01 Other Provider Route / Job;
- OTH-02 Other Provider Service Completion.

Release 1.1/Release 2+ capabilities are not made mandatory by this UAT plan unless an explicit release decision promotes them. Examples include family/dependants, advanced tracking/dispatch, advanced ranking, complex refunds, enriched clinical messaging, FHIR/NPHIES integrations, RPM/wearables and AI-assisted workflows.

## 3. Current UAT readiness

Overall R7 status: **BLOCKED / IN PROGRESS**.

The release tree contains substantial Patient, Doctor, Other Provider and Admin application functionality, so preparation and partial rehearsals can start. Final Release 1 UAT sign-off is not possible until the production-equivalent environment and required P0 product/mobile/integration dependencies are available.

Known dependencies relevant to final UAT:

- #75 — discovery, scheduling buffers/exceptions and clinic/home-visit context;
- #76 — approved WEB-05 Clinical Patient Workspace;
- #78 — booking/status reminder orchestration;
- #79 — production/staging-equivalent infrastructure acceptance;
- #80 — real external integration activation where launch workflows require it;
- #81 — native Android/iOS runners, signing and real-device evidence;
- #83 — enforced privileged-role MFA policy.

R7 must not convert a blocked case into PASS because the underlying provider, mobile build or Release 1 feature is unavailable.

## 4. UAT environment and evidence rules

Final UAT must execute against:

1. the exact Release Candidate SHA/build;
2. a production-equivalent environment accepted under R3;
3. the approved launch integration configuration for every enabled external workflow;
4. signed/native mobile candidates when mobile behavior is under test;
5. synthetic/non-production identities and clinical data unless a specifically approved controlled clinical-test process exists.

For every case record:

- UAT case ID;
- source requirement ID(s) and/or UX surface;
- persona;
- preconditions;
- environment and build identifier;
- exact Release Candidate SHA;
- synthetic test-data references;
- execution steps;
- expected result;
- actual result;
- PASS / FAIL / BLOCKED;
- screenshot/log/correlation evidence reference;
- defect/issue reference when applicable;
- tester;
- execution date;
- retest result/date when applicable.

Do not place real PHI, passwords, payment secrets, API credentials, signing material or restricted security evidence in public GitHub artifacts.

## 5. Minimum UAT personas and fixtures

### Identities

- Patient A and Patient B — separate accounts, patient profiles and consent states.
- Doctor A and Doctor B — separate identities/provider entities, specialties and credentials.
- Other Provider A and Other Provider B — separate configurable provider types/capability profiles.
- Admin A — provider/credential/operations administrator.
- Support A — only if SUPPORT is enabled for Release 1, with intentionally restricted permissions.

### Product fixtures

At minimum create:

- one CLINIC service;
- one TELEMEDICINE service;
- one HOME_VISIT service;
- one scheduled MEDICAL_TRANSPORT service;
- recurring availability plus an exception, a block and a buffer;
- overlapping booking attempts for transactional conflict testing;
- granted, revoked and absent clinical consent states;
- an active provider, suspended provider and invalid/expired credential case;
- payment success, failure and refund-capable test state where supported by launch PSP;
- LiveKit/telehealth test configuration matching the approved provider;
- notification test channels matching the approved launch configuration;
- an emergency-ambulance-capable provider/dispatch fixture only when the launch operating model authorizes this workflow.

## 6. Patient UAT matrix

| Case | Source | Acceptance objective |
| --- | --- | --- |
| UAT-PAT-001 | FR-IAM-001/002/003 | Patient authenticates with the approved patient risk/MFA policy; session expiry, refresh rotation and logout/revocation behave correctly. |
| UAT-PAT-002 | FR-PAT-001 | Patient has one global profile usable across multiple providers without duplicated provider-owned identities. |
| UAT-PAT-003 | FR-PAT-002 | Patient grants/revokes granular consent and the resulting access boundary changes are observable and auditable. |
| UAT-PAT-004 | FR-SRC-001, PAT-02 | Search supports specialty/provider type/service/modality/location and does not expose ineligible/suspended providers. |
| UAT-PAT-005 | FR-SVC-001..004 | Service details show only configured modalities, price/currency/duration and applicable coverage requirements. |
| UAT-PAT-006 | FR-SCH-001/002 | Availability reflects recurring rules/exceptions/blocks/buffers and two concurrent users cannot consume the same capacity incorrectly. |
| UAT-PAT-007 | FR-BKG-001/002, PAT-03 | Patient books a CLINIC appointment from a valid slot; patient/provider/service/modality/time/price/state are correct. |
| UAT-PAT-008 | FR-BKG-003 | Reprogram/cancel follows configured policy and produces correct state, availability restoration, audit and notification behavior. |
| UAT-PAT-009 | FR-CLN-001 | Clinic booking presents provider location and arrival instructions in the correct appointment context. |
| UAT-PAT-010 | FR-PAY-001/002 | Approved payment flow succeeds/fails deterministically and CarePoint does not collect/store raw PAN/CVV. |
| UAT-PAT-011 | FR-NTF-001, #78 | Booking/reminder/status events generate the approved operational notifications without PHI leakage. |
| UAT-PAT-012 | FR-TEL-001..004, PAT-04 | Telemedicine session belongs only to the booking; explicit consent precedes join; token is scoped/ephemeral; join/leave events are recorded without media storage by default. |
| UAT-PAT-013 | FR-HOM-001 | HOME_VISIT captures validated address, approximate coordinates, access instructions/contact and rejects out-of-coverage requests. |
| UAT-PAT-014 | FR-TRN-001 | Scheduled medical transport captures origin/destination/date-time/mobility/equipment/companions and follows its own operational lifecycle. |
| UAT-PAT-015 | FR-TRN-002, PAT-01 | Emergency ambulance is accessible from the high-visibility one-touch Home action without normal search/booking; minimum dispatch data is captured and immediate receipt/status is shown. |
| UAT-PAT-016 | FR-ENC-001/002 | Patient sees only authorized/released encounter information and documents. |
| UAT-PAT-017 | FR-MSG-001 | Patient can exchange secure context-linked messages when Release 1 messaging is enabled. |
| UAT-PAT-018 | authorization/privacy | Patient A cannot read or mutate Patient B appointments, billing, claims, clinical records, documents, messages or transport resources. |

## 7. Doctor UAT matrix

| Case | Source | Acceptance objective |
| --- | --- | --- |
| UAT-DOC-001 | FR-IAM-001/002 | Doctor uses a distinct provider identity and the approved provider MFA policy. |
| UAT-DOC-002 | FR-PRV-001..003, FR-DOC-001/002 | Doctor onboarding captures specialty/subspecialty and required credential type/issuer/number/validity/document/review state. |
| UAT-DOC-003 | FR-PRV-002/003, FR-ADM-002 | Admin review/approval/rejection requires reason where designed and creates an auditable decision. |
| UAT-DOC-004 | FR-PRV-004 | Suspended doctor cannot receive new bookings or start clinical service. |
| UAT-DOC-005 | FR-SVC-001/002 | Active doctor configures/publishes permitted services, modalities, price and duration. |
| UAT-DOC-006 | FR-SCH-001/002, #75 | Doctor availability supports recurring rules/exceptions/blocks/buffers and booking conflict prevention. |
| UAT-DOC-007 | FR-DOC-003, DOC-01 | Today/Queue shows the correct appointment patient, modality and operational context. |
| UAT-DOC-008 | FR-DOC-003, FR-ENC-002, DOC-02 | Patient Snapshot exposes only authorized history/context based on valid treatment relationship/consent. |
| UAT-DOC-009 | FR-TEL-001..004 | Doctor joins only the linked telemedicine appointment within permitted state/time and cannot reuse another session/token. |
| UAT-DOC-010 | FR-ENC-001 | Authorized doctor creates encounter notes/summary/attachments for the correct confirmed encounter. |
| UAT-DOC-011 | encounter finalization UX | Explicit confirmation is required to finalize sensitive clinical work and finalized behavior is consistent/controlled. |
| UAT-DOC-012 | clinical documents | Doctor releases only own/authorized encounter documents and patient visibility changes correctly. |
| UAT-DOC-013 | FR-MSG-001 | Doctor can exchange secure context-linked messages. |
| UAT-DOC-014 | authorization/privacy | Doctor A cannot access Doctor B-only operational, financial or clinical resources without explicit valid authority. |

## 8. Other Provider UAT matrix

| Case | Source | Acceptance objective |
| --- | --- | --- |
| UAT-OTH-001 | FR-IAM-001, FR-PRV-001 | Other Provider uses its own independent identity/entity and cannot operate through another provider account. |
| UAT-OTH-002 | FR-TAX-001/002 | Active configurable provider type dynamically controls required credentials, services and modalities without hard-coded medical-specialty behavior. |
| UAT-OTH-003 | FR-PRV-002..004 | Credential review/activation/suspension lifecycle works and suspension prevents new/active service operations as required. |
| UAT-OTH-004 | capability boundary | Other Provider cannot act as a doctor or invoke clinical/order/service capabilities not granted by its configured type. |
| UAT-OTH-005 | FR-SVC-001..004 | Provider configures only services/modalities/coverage allowed by its taxonomy and credentials. |
| UAT-OTH-006 | FR-HOM-001, OTH-01 | Home-visit-capable provider receives correct patient/job/address/instructions and progresses the approved operational states. |
| UAT-OTH-007 | FR-TRN-001, OTH-01 | Transport-capable provider receives correct origin/destination/mobility/equipment context and can accept/reject/progress the request. |
| UAT-OTH-008 | OTH-02 | Service Completion captures approved completion notes/evidence/follow-up and performs explicit secure closure. |
| UAT-OTH-009 | authorization/privacy | Other Provider A cannot access Other Provider B resources or unrelated patient clinical context. |

## 9. Administrator UAT matrix

| Case | Source | Acceptance objective |
| --- | --- | --- |
| UAT-ADM-001 | FR-IAM-002, #83 | ADMIN production login cannot obtain unrestricted privileged access without the approved MFA policy. |
| UAT-ADM-002 | WEB-01 | Command Center operational overview is accurate, role-appropriate and does not expose unnecessary PHI. |
| UAT-ADM-003 | FR-PRV-002/003, WEB-02 | Provider Directory supports credential review, provider state and activation/suspension with auditable decisions. |
| UAT-ADM-004 | FR-DOC-001/002, WEB-03 | Doctors/specialties/subspecialties are administrable without excluding legitimate medical branches. |
| UAT-ADM-005 | FR-TAX-001/002 | Admin manages Other Provider taxonomy, required credentials and allowed services/modalities. |
| UAT-ADM-006 | FR-ADM-001, WEB-04 | Appointment Operations clearly distinguishes clinic, telemedicine, home visit, scheduled transport and emergency ambulance operational flows. |
| UAT-ADM-007 | #76, WEB-05 | Clinical Patient Workspace provides approved clinical context and enforces treatment/consent/role authorization after #76 closure. |
| UAT-ADM-008 | FR-TEL-004, WEB-06 | Telemedicine Operations exposes appropriate operational status/metrics without media content. |
| UAT-ADM-009 | FR-PAY-001, M15 | Finance/payment status and reconciliation evidence matches actual PSP outcomes. |
| UAT-ADM-010 | FR-ADM-002, FR-AUD-001 | Sensitive administrative actions produce audit evidence with actor, purpose/reason, object and result as applicable. |
| UAT-ADM-011 | least privilege | ADMIN/SUPPORT operational roles do not receive broad clinical PHI merely by role membership. |

## 10. Cross-cutting UAT matrix

| Case | Source | Acceptance objective |
| --- | --- | --- |
| UAT-X-001 | UX persistent context | Patient/provider/appointment/modality/status context remains visible for sensitive actions. |
| UAT-X-002 | UX explicit confirmation | Clinical finalization, payment, consent and other irreversible/sensitive operations require meaningful confirmation. |
| UAT-X-003 | UX status redundancy | Safety, consent and credential states are conveyed with text/icon/badge and not color alone. |
| UAT-X-004 | NFR-LOC-01 | English and Arabic/RTL core journeys are usable and locale changes do not alter authorization or data meaning. |
| UAT-X-005 | NFR-ACC-01 | Web keyboard/focus and mobile screen-reader/text-scaling acceptance meets the approved accessibility baseline. |
| UAT-X-006 | FR-OPS-001 | Retry/network interruption does not duplicate critical booking/payment/emergency requests when idempotency applies. |
| UAT-X-007 | UX offline-aware | Field/home workflow connectivity loss is visible and does not silently discard or misrepresent state. |
| UAT-X-008 | UX realtime presence | Telehealth/queue status remains clear and timely without unsafe/invasive motion. |
| UAT-X-009 | FR-AUD-001, privacy | Required sensitive transitions are auditable while logs/traces/notifications avoid unapproved PHI/secrets/tokens. |
| UAT-X-010 | negative-path suite | Inactive/suspended provider, invalid/expired credential, unavailable slot, invalid booking transition, payment failure, no telehealth consent, unauthorized clinical access and provider outage are handled safely. |
| UAT-X-011 | FR-DAT-001/002 | Sensitive data remains protected and retention/deletion behavior aligns with the approved policy after #77 closure. |
| UAT-X-012 | release evidence | Every PASS result is tied to the exact RC SHA/build/environment and is reproducible/retestable. |

## 11. Execution waves

### Wave 0 — preparation

- approve Release 1 UAT scope and owners;
- create synthetic fixtures;
- finalize requirement-to-case mapping;
- define evidence storage and defect workflow;
- identify BLOCKED cases from unresolved P0 dependencies.

### Wave 1 — controlled staging rehearsal

May begin before all release dependencies close. Execute API/web and available mobile logic against a controlled staging environment. The purpose is to discover workflow defects early, not to issue final sign-off.

### Wave 2 — production-equivalent candidate UAT

Execute all in-scope P0 cases on the exact candidate with real approved integration configuration, native builds and infrastructure. BLOCKED is not equivalent to PASS.

### Wave 3 — defect retest and sign-off

Retest every release blocker on the final candidate and collect role-specific sign-off from product/operations/clinical representatives authorized by the Release 1 governance model.

## 12. Defect severity and disposition

### Release blockers

A defect blocks Release 1 when it involves:

- patient safety;
- authentication or authorization;
- privacy/PHI exposure;
- financial integrity;
- data corruption/loss;
- incorrect patient/provider context;
- inability to complete an approved P0 journey;
- major P1 workflow failure with no safe workaround when that workflow was explicitly promoted into launch scope.

### Non-blocking findings

Cosmetic/lower-severity defects may be accepted only when:

- no safety/privacy/accessibility impact exists;
- workaround is safe and documented where needed;
- owner and target treatment date are recorded;
- acceptance is made by the authorized Go/No-Go role.

No missing Release 1 P0 capability may be reclassified as cosmetic.

## 13. Sign-off record

Final UAT evidence should record explicit sign-off for:

- Patient journey;
- Doctor journey;
- Other Provider journey;
- Admin/operations journey;
- clinical safety/clinical workflow representative;
- product owner;
- QA/UAT owner.

Country-specific regulatory/operational approval belongs to R9 and is not replaced by UAT sign-off.

## 14. Exit criteria

R7 may close only when:

1. all in-scope P0 Release 1 UAT cases PASS on the exact production-equivalent candidate;
2. all release-blocking UAT defects are closed and retested;
3. Patient, Doctor, Other Provider and Admin/operations sign-offs are recorded;
4. #75, #76, #78 and any other UAT-blocking Release 1 product gaps are closed or formally removed from launch scope through approved governance;
5. required infrastructure/integration/mobile dependencies under #79, #80 and #81 provide executable acceptance conditions rather than placeholders;
6. privileged authentication policy required by #83 is enforced;
7. evidence contains no real PHI/secrets and is traceable to the exact candidate;
8. unresolved dependencies are not represented as successful UAT.

`main` remains intentionally unchanged until the final Release Candidate Go/No-Go authorizes promotion.
