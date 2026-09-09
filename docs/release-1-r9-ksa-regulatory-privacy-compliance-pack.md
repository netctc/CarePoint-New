# Release 1 — KSA Regulatory, Privacy and Compliance Acceptance Pack

Status: **SANITIZED ENGINEERING EVIDENCE PACK PREPARED / AUTHORIZED KSA SIGN-OFF PENDING**  
R9 tracker: #91  
P0 acceptance owner: #92  
Canonical branch: `release/release-1-integration-go-live-readiness`

## 1. Purpose and evidence boundary

This document is the sanitized repository index for the KSA Release 1 privacy/compliance acceptance pack required by #92. It organizes what can be derived from the approved CarePoint specification and from the Release 1 source tree, and it leaves jurisdiction-specific legal/commercial decisions explicitly unresolved until authorized Privacy/Legal/Clinical/Operations owners provide them.

This document is **not** legal advice, a ROPA/DPIA approval, a processor agreement, a regulatory filing, a healthcare licence, a data-transfer authorization or a compliance certification. Restricted legal advice, contracts, provider licences, production credentials, personal data and sensitive assessment evidence must remain in the approved controlled evidence repository. Public GitHub may contain only sanitized status and immutable/non-secret references.

## 2. Exact launch identity record

The following fields are mandatory before #92 can close. Engineering must not populate them from assumptions.

| Field | Required value | Current status |
| --- | --- | --- |
| Launch jurisdiction | KSA for the current R9 launch assessment | PROGRAMME SCOPE |
| Legal/commercial operating entity | Authorized legal entity name/reference | **PENDING LEGAL/COMMERCIAL OWNER** |
| Controller/processor/joint-controller model | Per CarePoint/provider/vendor relationship | **PENDING PRIVACY/LEGAL OWNER** |
| Launch geography/coverage | Approved service area(s) | **PENDING OPERATIONS/CLINICAL OWNER** |
| Enabled patient modalities | CLINIC / TELEMEDICINE / HOME_VISIT as approved | **PENDING FINAL LAUNCH SCOPE** |
| Emergency ambulance | ENABLED only with #94 approvals; otherwise DISABLED | **PENDING #94 DECISION** |
| Insurance/claims/FHIR/NPHIES scope | Enabled/deferred decision based on actual launch contract/regulatory need | **PENDING #80/#92 DECISION** |
| Exact Release Candidate SHA | Immutable final RC SHA | **PENDING FINAL RC** |
| Production environment reference | Non-secret environment/resource reference | **PENDING #79** |
| Approval date and approvers | Named authorized roles + evidence references | **PENDING** |

## 3. Source-derived data inventory / ROPA working matrix

The rows below identify product data classes and technical processing locations visible in the Release 1 design. `Technical purpose` describes the implemented product purpose; it is **not** a legal basis. `Legal/policy basis`, final retention and transfer decisions remain owner inputs.

| ID | Data class | Representative data | Technical purpose / product workflow | Primary CarePoint stores/components | Potential recipient/processor boundary | Legal/policy basis | Location/residency evidence | Retention/deletion/hold policy |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ROPA-01 | Identity/account | account id, email, role, status, auth/session state | authentication, authorization, account administration | PostgreSQL IAM/session models; Redis rate-limit/coordination | identity/admin operations; SIEM receives minimized/pseudonymous security evidence | **PENDING** | #79/#92 | #77 policy + **PENDING approved periods** |
| ROPA-02 | MFA/security authentication | encrypted TOTP secret envelope, challenge/session metadata, lockout/replay evidence | privileged/session security | PostgreSQL + KMS envelope protection + audit/SIEM | KMS, SIEM where enabled | **PENDING** | #79/#92 | #77/auth cleanup + **PENDING policy approval** |
| ROPA-03 | Patient profile | name, contact details, patient internal ids | patient identity/profile and care workflows | PostgreSQL PatientProfile | authorized providers/operations only through application controls | **PENDING** | #79/#92 | #77 preserve/delete decision **PENDING** |
| ROPA-04 | Consent | patient, optional provider, scope, version, state, grant/revoke/expiry timestamps | evidence and enforcement of versioned/granular consent | PostgreSQL Consent + AuditEvent | authorized clinical/telehealth workflows | **PENDING consent/legal basis** | #79/#92 | #77 + **PENDING evidence-retention rule** |
| ROPA-05 | Provider identity/credentials | provider identity, class/category, specialty, licence/credential type, issuer, number, validity, document ref, review state | provider onboarding, verification, suspension and operational authorization | PostgreSQL provider/onboarding/credential models; document reference where applicable | Admin/credential-verification process; external authority only if separately integrated/approved | **PENDING #93** | #79/#92 | **PENDING #93/#92 policy** |
| ROPA-06 | Services/scheduling/booking | service, modality, availability, appointment, status, timing, clinic context | discovery, booking and care coordination | PostgreSQL scheduling models | patient/provider; notification provider receives PHI-neutral template/entity refs only | **PENDING** | #79/#80/#92 | #77 + **PENDING periods** |
| ROPA-07 | Clinic/home-visit location | clinic coordinates/address/instructions; home-visit coverage/context as approved | navigation, service coverage and visit execution | PostgreSQL scheduling/context models | maps/geocoder only if launch scope selects a real provider | **PENDING** | #79/#80/#92 | #77 + **PENDING minimization/retention rule** |
| ROPA-08 | Emergency location/dispatch | patient ref, coordinates, pickup address, callback, request/status/assignment/ETA metadata | minimum emergency ambulance request/basic dispatch when enabled | PostgreSQL emergency models + audit + PHI-neutral notifications | licensed operator/dispatch/provider only when #94 enables approved path | **PENDING emergency policy** | #79/#80/#92/#94 | #77/#92 + **PENDING emergency retention** |
| ROPA-09 | Telehealth session | appointment/room ids, participant readiness, timestamps, consent ref/version, encrypted session key envelope | appointment-bound remote consultation | PostgreSQL TelehealthSession; LiveKit media boundary when enabled | LiveKit/self-hosted/managed media provider according to #80 decision | **PENDING telehealth basis/consent** | #79/#80/#92 | **PENDING session metadata retention** |
| ROPA-10 | Telehealth media | live audio/video; recording disabled by default | synchronous consultation | media provider in transit; CarePoint does not approve recording by default | approved media provider/sub-processors | **PENDING** | #80/#92/#94 | no recording unless separately approved; any recording policy **PENDING** |
| ROPA-11 | Clinical encounter/PHI | diagnoses, notes, medications, vitals and encounter data | clinical documentation and patient care | PostgreSQL encrypted clinical envelopes + KMS | authorized patient/provider access under treatment/consent basis | **PENDING** | #79/#92 | #77 + **PENDING clinical retention** |
| ROPA-12 | Clinical orders/results | prescriptions, laboratory/imaging/pathology order/result metadata | diagnostic/treatment workflows | PostgreSQL encrypted/order models + KMS/signing | authorized providers/labs/diagnostic services as enabled | **PENDING** | #79/#80/#92 | #77 + **PENDING clinical retention** |
| ROPA-13 | Clinical documents | encrypted document blob/metadata, content digest, document/report status | patient/provider clinical document exchange | PostgreSQL metadata + private object storage + KMS + malware scan | S3/object storage; ClamAV; PACS/DICOM if enabled | **PENDING** | #79/#80/#92 | #77 controlled lifecycle + **PENDING periods** |
| ROPA-14 | Secure messaging | encrypted conversation subject/message bodies, participants, read receipts, attachment refs | patient/provider secure care communication | PostgreSQL encrypted messaging + KMS | notification provider receives only safe template/entity references, not message body | **PENDING** | #79/#80/#92 | #77 closed-message lifecycle + **PENDING periods** |
| ROPA-15 | Notification data | account/channel endpoint ref, preferences, safe title/body keys, delivery/retry status | in-app/push/email/SMS operational notification | PostgreSQL notification outbox/delivery | selected notification provider(s) | **PENDING** | #80/#92 | **PENDING vendor/platform retention** |
| ROPA-16 | Payment data | opaque PSP payment-method token/reference, intent/payment/refund/payout/invoice state; no PAN/CVV by CarePoint design | payment and reconciliation | PostgreSQL billing models | selected PSP/acquirer | **PENDING financial basis** | #80/#92 | financial retention **PENDING policy/contract** |
| ROPA-17 | Insurance/claims | opaque policy refs, eligibility/prior-auth/claim/EOB/remittance normalized state | coverage/revenue-cycle workflows when enabled | PostgreSQL insurance/claims models | payer/clearinghouse/national network if enabled | **PENDING launch scope/basis** | #80/#92 | **PENDING contractual/regulatory retention** |
| ROPA-18 | Audit/security evidence | actor/object refs, action, purpose, result, allowlisted metadata | accountability, security investigation and operational audit | PostgreSQL immutable-intent AuditEvent + durable SIEM outbox | selected SIEM | **PENDING** | #79/#92 | #77 preserve-only class + **PENDING approved retention** |
| ROPA-19 | Observability | request id, trace/span, duration, metrics and bounded structured operational metadata | reliability/performance/security operations | OTLP exporter/collector; application logs | selected OTLP/monitoring platform | **PENDING** | #79/#92 | **PENDING telemetry retention/minimization policy** |
| ROPA-20 | Backups/recovery | PostgreSQL backup/PITR data, object-storage recovery/versioning as configured | continuity and recovery | production DB/storage provider | infrastructure/backup provider | **PENDING** | #79/#92 | **PENDING backup retention and deletion propagation** |
| ROPA-21 | FHIR/bulk exports | authorized FHIR resources and generated export artifacts when enabled | interoperability/export | PostgreSQL source + private bulk artifact storage | authorized SMART/FHIR recipient/client | **PENDING scope/basis** | #79/#80/#92 | configured technical expiry + **PENDING legal approval** |
| ROPA-22 | Support/evidence records | support references, incident/security evidence, sanitized release evidence | support, incident response, audit and Go/No-Go | support/evidence systems outside application source may apply | support/security/legal teams and approved tools | **PENDING** | **PENDING actual tools/providers** | **PENDING** |

### ROPA completion rule

No row is complete until the authorized KSA owner records at minimum: processing purpose, applicable legal/policy basis, controller/processor role, recipients, actual production location, cross-border/transfer treatment if applicable, approved retention period, deletion/restriction/hold handling, owner and evidence reference.

## 4. Data location and lifecycle evidence map

| Evidence objective | Repository/Release 1 mechanism | External evidence still required |
| --- | --- | --- |
| Explicit residency boundary | #77 fail-closed data-residency declaration and region consistency checks | approved KSA policy/jurisdiction and actual #79 resource locations |
| DB location/backup/HA/PITR | production PostgreSQL preflight and recovery gates | production endpoint/provider region, backup/PITR geography, failover/restore evidence #79 |
| Redis location/durability | production Redis TLS/auth/replica/persistence preflight | actual provider region/topology/durability/failover evidence #79 |
| Object storage location | private S3/KMS preflight | actual bucket/account/region/lifecycle/versioning evidence #79 |
| KMS/key custody | customer-managed alias/account/region/rotation preflight | actual runtime IAM/key inventory/rotation/recovery evidence #79 |
| Clinical-document deletion | #77 object deletion + tombstone/pseudonymized lifecycle | approved retention/deletion/hold policy and production rehearsal |
| Audit preservation | generic data lifecycle does not purge AuditEvent/security evidence | approved audit retention, SIEM retention and restricted evidence handling |
| External provider location | endpoint/secret/egress controls exist | real provider residency/sub-processor/transfer terms #80/#92 |
| Telemetry location | OTLP/SIEM production controls exist | actual collector/SIEM provider, storage location, retention and leakage review #79/#92 |

## 5. DPIA / high-risk privacy assessment working register

The table identifies risks that the final DPIA/high-risk assessment must disposition. The `Technical controls` column records implemented mitigations; it does not decide the legal acceptability of residual risk.

| DPIA ID | Processing/risk | Release 1 technical controls | Required privacy/legal/clinical decision |
| --- | --- | --- | --- |
| DPIA-01 | Sensitive clinical health-data processing | least privilege, object-level treatment/consent checks, encrypted envelopes, private storage, audit | legal/policy basis, necessity/proportionality, patient rights, retention |
| DPIA-02 | Patient/provider identity linkage and BOLA/IDOR | global authorization, provider ACTIVE/current-credential gate, R6 two-patient/two-provider adversarial regression | residual-risk acceptance after #85 external assessment |
| DPIA-03 | Precise location for home/emergency workflows | bounded workflow data, emergency module feature gate, role separation, audit | necessity/minimization, coverage, emergency exception, retention, recipient/operator model |
| DPIA-04 | Telemedicine audio/video and session metadata | appointment-bound tokens, explicit consent gate, production non-mock provider, recording disabled by default | media provider/hosting, consent text, sub-processors, location/transfer, remote-care responsibility |
| DPIA-05 | Clinical document upload/imaging | size/type bounds, encrypted storage, integrity digest, malware scanner, DICOM boundary controls | enabled PACS/scanner vendors, data-flow terms and retention |
| DPIA-06 | Financial/insurance/claims integrations | tokenized PSP boundary, no PAN/CVV design, idempotency, bounded egress/responses | launch providers, contracts, processing basis, data minimization and retention |
| DPIA-07 | Push/SMS/email notification | PHI-neutral safe template keys, preferences, secure in-app detail retrieval | approved channels/senders, vendor terms, content policy, opt-out/required-service rules |
| DPIA-08 | Admin/support access | centralized role grants, Admin not broadly granted clinical permissions, audit/MFA controls | authorized support role scope, break-glass/emergency access policy if any |
| DPIA-09 | Audit/SIEM/OTLP | allowlisted/pseudonymized security exports, no arbitrary audit metadata forwarding, bounded telemetry | actual vendor, location, retention, access and incident-investigation use |
| DPIA-10 | Retention/deletion/legal hold | versioned policy, preserve-only protected classes, DELETE/PURGE lifecycle, holds and approval-gated execution | exact legal/clinical periods, restriction/hold authority, data-subject request interaction |
| DPIA-11 | Cross-border processing/DR | deployment-time residency/region controls | actual providers/sub-processors/backup/DR geography and approved transfer basis |
| DPIA-12 | Security attack or breach | R6 threat model, CodeQL/scanner, MFA, session replay controls, SIEM, #85 plan | final pentest/adversarial result, breach notification procedure and residual-risk sign-off |

## 6. Processor/vendor and sub-processor register

The codebase intentionally uses provider abstractions in several areas. A technical adapter name does not prove the commercial launch vendor. Do not replace `PENDING` with a guessed company.

| Boundary | Source-side integration state | Actual launch provider/account | Processor/controller role | Processing location | Sub-processors | DPA/terms | Incident notice | Exit/delete/return | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| PostgreSQL hosting | PostgreSQL 16+ production contract, TLS/HA/PITR/pooling preflight | **PENDING #79** | **PENDING** | **PENDING** | **PENDING** | **PENDING** | **PENDING** | **PENDING** | BLOCKED |
| Redis hosting | TLS/auth/replica/durability preflight | **PENDING #79** | **PENDING** | **PENDING** | **PENDING** | **PENDING** | **PENDING** | **PENDING** | BLOCKED |
| Object storage | AWS S3 client/private SSE-KMS design; production local storage forbidden | **PENDING #79** | **PENDING** | **PENDING** | **PENDING** | **PENDING** | **PENDING** | **PENDING** | BLOCKED |
| KMS/key custody | AWS KMS customer-managed alias contract | **PENDING #79** | **PENDING** | **PENDING** | **PENDING** | **PENDING** | **PENDING** | **PENDING** | BLOCKED |
| LiveKit/media | real LiveKit adapter; production mock forbidden | **PENDING #80** | **PENDING** | **PENDING** | **PENDING** | **PENDING** | **PENDING** | **PENDING** | BLOCKED if telemedicine enabled |
| PSP/acquirer | generic external gateway; hosted-action allowlist; no PAN/CVV | **PENDING #80** | **PENDING** | **PENDING** | **PENDING** | **PENDING** | **PENDING** | **PENDING** | BLOCKED if payments enabled |
| Insurance gateway | generic external adapter; production mock forbidden | **PENDING #80 / launch scope** | **PENDING** | **PENDING** | **PENDING** | **PENDING** | **PENDING** | **PENDING** | CONDITIONAL |
| Claims gateway | generic external adapter; production mock forbidden | **PENDING #80 / launch scope** | **PENDING** | **PENDING** | **PENDING** | **PENDING** | **PENDING** | **PENDING** | CONDITIONAL |
| Push/SMS/email | generic notification gateway; PHI-neutral payload | **PENDING #80** | **PENDING** | **PENDING** | **PENDING** | **PENDING** | **PENDING** | **PENDING** | BLOCKED for enabled channels |
| SIEM | generic durable HTTPS exporter | **PENDING #79** | **PENDING** | **PENDING** | **PENDING** | **PENDING** | **PENDING** | **PENDING** | BLOCKED |
| OTLP/monitoring | OTLP/HTTP JSON exporter | **PENDING #79** | **PENDING** | **PENDING** | **PENDING** | **PENDING** | **PENDING** | **PENDING** | BLOCKED |
| ClamAV | INSTREAM malware-scanner path | **PENDING runtime/service ownership #80** | **PENDING** | **PENDING** | **PENDING** | **PENDING where external** | **PENDING** | **PENDING** | CONDITIONAL to uploads |
| DICOM/PACS | DICOMweb adapter with production HTTPS/UID/boundary controls | **PENDING #80 if enabled** | **PENDING** | **PENDING** | **PENDING** | **PENDING** | **PENDING** | **PENDING** | DEFER/validate per launch scope |
| Mapping/geocoding/routing | no mandatory external adapter proven by R4; coordinate/manual ETA model exists | **PENDING scope decision** | **PENDING** | **PENDING** | **PENDING** | **PENDING** | **PENDING** | **PENDING** | SCOPE DECISION |
| Emergency operator/dispatch | CarePoint emergency workflow feature-gated; operator is not defined by code | **PENDING #94** | **PENDING** | **PENDING** | **PENDING** | **PENDING** | **PENDING** | **PENDING** | DISABLED unless approved |

## 7. Notice, consent and data-subject-rights register

| ID | Artifact/process | Engineering support | Policy/content owner input still required | Status |
| --- | --- | --- | --- | --- |
| NCR-01 | Patient privacy notice | UI/app surfaces can present versioned content; consent model records scope/version/timestamps | approved KSA notice text, languages, entity/contact, purposes/bases/recipients/rights | PENDING |
| NCR-02 | Provider privacy/processing notice | provider onboarding/account model | approved provider notice/processing terms | PENDING |
| NCR-03 | General/granular consent taxonomy | Consent supports scope/version/provider/expiry/grant/revoke | approved scope taxonomy, wording, evidence and withdrawal effects | PENDING |
| NCR-04 | Telehealth informed consent | telehealth session binds consent id/version before join | approved telehealth consent version/text and emergency/escalation wording | PENDING #92/#94 |
| NCR-05 | Recording consent | recording disabled by default | if ever enabled: separate purpose, consent, retention, location and access policy | DISABLED / PENDING IF PROMOTED |
| NCR-06 | Emergency exception/override | emergency workflow has dedicated gated path/audit | approved exception/override legal/clinical policy and safety messaging | PENDING #94 |
| NCR-07 | Access/correction request | application data is structured and auditable | authorized request intake, identity verification, correction workflow, response SLA | PENDING |
| NCR-08 | Deletion/restriction request | #77 lifecycle, holds and preserve-only controls | policy deciding applicable deletion/restriction vs medical/financial/audit preservation | PENDING |
| NCR-09 | Privacy complaint/escalation | audit/support references can be retained | approved contact, escalation and evidence process | PENDING |

## 8. Regulatory/commercial scope decisions — no engineering inference

The final KSA acceptance record must explicitly decide all of the following from qualified owners and actual launch contracts. A technical implementation cannot answer them:

- provider/professional licensing and clinical liability model;
- authoritative provider credential verification and scope-of-practice rules (#93);
- telemedicine operating requirements, patient location/safety and clinical responsibility (#94);
- ambulance/emergency operator/licensing/network relationship and fallback behavior (#94);
- healthcare advertising and patient communication rules;
- PSP/acquirer settlement/refund/chargeback obligations;
- insurance/claims scope and whether a specific national/FHIR/NPHIES profile/certification is mandatory for the selected services/contracts;
- international/cross-border transfer treatment;
- exact legal/clinical/financial/audit/telemetry retention periods;
- incident/breach notification obligations, owners and timelines.

## 9. Feature and data-flow activation record

For the exact RC, every high-risk integration/workflow must receive one explicit state: `ENABLED`, `DISABLED`, `DEFERRED` or `NOT_APPLICABLE`. Blank/implicit states are not acceptable.

| Feature/boundary | Final state | Evidence/approval reference | Owner | Notes |
| --- | --- | --- | --- | --- |
| Clinic booking | **PENDING** |  |  |  |
| Home visit | **PENDING** |  |  |  |
| Telemedicine | **PENDING** | #80/#81/#87/#92/#94 |  |  |
| Emergency ambulance | **PENDING; production default is DISABLED** | #94 |  |  |
| Payments | **PENDING** | #80/#92 |  |  |
| Insurance eligibility/prior auth | **PENDING/DEFERRED decision** | #80/#92 |  |  |
| Claims/EOB/remittance | **PENDING/DEFERRED decision** | #80/#92 |  |  |
| Push | **PENDING** | #80/#92 |  |  |
| SMS | **PENDING** | #80/#92 |  |  |
| Email | **PENDING** | #80/#92 |  |  |
| Clinical uploads + malware scan | **PENDING** | #79/#80/#92 |  |  |
| DICOM/PACS | **PENDING/DEFERRED decision** | #80/#92 |  |  |
| FHIR/SMART/Bulk | **PENDING/DEFERRED decision** | R2/#80/#92 |  |  |
| External mapping/routing | **PENDING scope decision** | #80/#92 |  |  |

## 10. DPIA and vendor evidence record template

For every restricted evidence item, GitHub should store only the following sanitized index:

| Field | Value |
| --- | --- |
| Evidence ID | `KSA-R9-...` |
| Evidence class | ROPA / DPIA / DPA / vendor assurance / policy / notice / transfer / rights / incident / regulatory decision |
| Country | KSA |
| Exact RC SHA/build |  |
| Environment |  |
| Scope/features |  |
| Document/policy version |  |
| Restricted evidence reference | non-secret immutable identifier/location only |
| Owner/reviewer role |  |
| Approval date |  |
| Result | PASS / FAIL / BLOCKED / NOT-APPLICABLE |
| Exception/waiver reference | if any |
| Revalidation/expiry date | if applicable |

## 11. #92 exit checklist

#92 remains **OPEN / NO-GO** until all of the following are true:

1. legal/commercial launch entity and controller/processor model are approved;
2. the ROPA/data inventory is completed with approved purposes/bases, recipients, locations, retention and rights handling;
3. DPIA/high-risk assessment is approved with residual risks accepted by the authorized owner;
4. #77 policy values and #79 actual infrastructure geography are accepted;
5. every enabled external provider under #80 has accepted DPA/role/location/sub-processor/security/breach/deletion/exit evidence;
6. patient/provider notices and consent versions are approved in required launch languages;
7. data-subject-rights and privacy complaint/escalation procedures are operational;
8. the launch-specific provider/telemedicine/emergency/payments/insurance/transfer scope decisions are explicitly recorded;
9. #85 has no unresolved Critical/High security blocker and #90 continuity/failure evidence is accepted for the launch architecture;
10. authorized KSA Privacy/Legal/Compliance owners sign off the exact final RC SHA, production environment and enabled feature/data-flow list.

Engineering can maintain the inventory, technical control references and fail-closed configuration. It must not replace the authorized KSA sign-off or invent missing legal conclusions.
