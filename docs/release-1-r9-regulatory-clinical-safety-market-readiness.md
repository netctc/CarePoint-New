# Release 1 — R9 Regulatory, Clinical-Safety and Market-Readiness Gate

## 1. Purpose

R9 is the Release 1 jurisdictional privacy/compliance, clinical-safety and market-readiness workstream.

Canonical branch:

`release/release-1-integration-go-live-readiness`

R9 starting baseline:

`77e01b337bb545b8099d9700d2c581bc5cd84461`

R9 tracker: #91

Dedicated R9 P0 blockers:

- #92 — KSA Release 1 regulatory/privacy/compliance acceptance pack and sign-off;
- #93 — provider licensing, credential-verification and scope-of-practice operating policy acceptance;
- #94 — telemedicine and emergency-ambulance clinical-safety / launch-activation approval.

R9 is not a substitute for qualified legal, privacy, clinical or regulatory advice. It separates what CarePoint engineering can prove from the jurisdiction-specific decisions that require authorized policy owners.

## 2. Approved source baseline

The approved CarePoint functional/technical specification establishes a healthcare platform handling sensitive clinical information. Its Release 1 requirements include minimum-privilege clinical access, field-level protection of sensitive data, versioned/granular consent, auditable PHI access, configurable data residency, policy-driven retention/deletion and jurisdiction-specific adaptation.

For a Saudi Arabia deployment, the specification explicitly states that health data must be treated as sensitive, processing should be limited to the minimum necessary, processing stages must be documented, organizational/technical/administrative safeguards must be applied, and final legal/regulatory assessment must be performed with local advice and applicable health regulators.

The same specification defines telemedicine as an appointment-bound workflow with explicit consent before room entry, short-lived role/user/appointment-scoped access and technical join/leave audit without media recording by default. Recording is permitted only when purpose, consent, retention, location and access are explicitly defined.

For emergency ambulance, the specification intentionally limits Release 1 to a minimal, direct and regulatorily controlled urgent request/confirmation/basic-dispatch path. Advanced CAD, continuous tracking, multi-unit optimization and public emergency-network integration remain later evolution unless explicitly promoted.

The approved KSA/GCC launch plan selects a KSA-first approach. It also explicitly prevents the programme from assuming, without validation:

- the final legal/commercial operating model;
- clinical licensing/liability and provider credential-verification rules;
- whether NPHIES/FHIR is mandatory for the selected services/contracts;
- PSP settlement/refund/chargeback rules;
- telehealth provider residency/encryption/sub-processors;
- emergency ambulance operating relationship with licensed/public networks;
- final country cloud/DR design.

For emergency ambulance specifically, that launch plan requires a licensed partner/operator, operational coverage, 24x7 support and local legal/operating approval before production activation; otherwise the workflow should remain feature-gated/outside the live pilot.

## 3. Current R9 status

Overall R9 status: **BLOCKED / IN PROGRESS**.

The repository has strong technical controls, but technical readiness does not equal jurisdictional authorization or clinical operating approval.

R9 can progress with engineering safeguards, evidence templates and controlled market decisions while R3–R8 continue. It cannot close until the exact Release Candidate has approved market-specific legal/privacy/clinical evidence and every high-risk enabled workflow has an authorized operating model.

## 4. Static repository readiness findings

### 4.1 Consent and clinical access

`PersistentConsentService` supports patient-owned consent grants/revocation with:

- scope;
- version;
- optional provider binding;
- optional expiry;
- ACTIVE-provider validation;
- patient ownership checks;
- audit events for grant, revocation and denied revocation.

This is a useful mechanism for versioned/granular consent. R9 still needs the approved KSA consent texts, purposes, legal/policy basis, scope taxonomy, withdrawal effects and evidence-retention rules. Code must consume approved policy rather than invent legal meaning.

### 4.2 Provider credentialing

Existing Doctor D1 and Other Provider O1 acceptance evidence demonstrates:

- self-service credential capture;
- Admin verification/review;
- PENDING_REVIEW lockout;
- operational access only after APPROVED + Provider ACTIVE;
- suspension blocking workspace access and revoking sessions;
- category-driven required credentials for Other Providers;
- audit of the governance lifecycle.

The category capability layer constrains Other Provider modalities and clinical-order capabilities according to configured category data.

This is a strong enforcement foundation. It does not prove that the configured KSA credential types, verification source, validity/expiry rules or scope-of-practice mappings are legally/clinically correct. #93 owns that policy acceptance.

### 4.3 Telemedicine

The Release 1 telehealth provider path:

- rejects mock mode in production;
- supports LiveKit server-side credentials;
- issues appointment/participant-scoped tokens;
- separates media provider handling from the transactional core;
- verifies provider webhooks through the LiveKit SDK.

R9 still needs approved media residency/sub-processor terms, telehealth-specific informed-consent content, recording policy, clinical responsibility/escalation and launch-country operating approval. R4/R5/R7/R8 provide the corresponding provider/device/UAT/failure evidence.

### 4.4 Emergency ambulance

The emergency API already provides important safety/integrity controls:

- client request idempotency;
- serializable transactional request creation;
- auditable dispatch events;
- role-separated patient/operations/responder endpoints;
- controlled status progression;
- ACTIVE Other Provider + `EMERGENCY_AMBULANCE` provider-family checks;
- PHI-neutral notification templates.

Before R9, `EmergencyModule` was statically imported by `AppModule`, so production deployments had no explicit market/approval activation boundary at module registration.

R9 #94 therefore introduced a deployment-level activation safeguard:

- production emergency ambulance defaults to **disabled**;
- non-production remains enabled by default for development/test acceptance unless explicitly disabled;
- production enablement requires explicit non-secret evidence references for jurisdiction, licensed operator/partner, local approval and 24x7 support confirmation;
- invalid/partial production enablement fails readiness;
- when disabled, the Nest emergency module is not registered, so patient/operations/provider emergency routes are absent for that deployment;
- the activation policy is wired into the API acceptance suite.

Configuration contract:

```text
EMERGENCY_AMBULANCE_ENABLED=false
EMERGENCY_AMBULANCE_JURISDICTION=
EMERGENCY_AMBULANCE_LICENSED_OPERATOR_REF=
EMERGENCY_AMBULANCE_LOCAL_APPROVAL_REF=
EMERGENCY_AMBULANCE_24X7_SUPPORT_CONFIRMED=false
```

The reference fields must contain only sanitized identifiers pointing to restricted approval evidence. They must not contain contract text, licences, credentials, PHI or secrets.

This engineering safeguard prevents accidental activation. It does not authorize ambulance service. Clinical/Operations/Regulatory acceptance under #94 and provider-policy acceptance under #93 remain mandatory before setting `EMERGENCY_AMBULANCE_ENABLED=true` in production.

## 5. KSA Release 1 acceptance matrix

### R9-PRI — Privacy and data governance

| ID | Acceptance objective | Primary dependencies |
| --- | --- | --- |
| R9-PRI-01 | Exact KSA legal/commercial operating entity and controller/processor roles are approved. | #92 |
| R9-PRI-02 | Data inventory/ROPA maps purpose, data classes, systems, processors, location, retention and legal/policy basis. | #92 |
| R9-PRI-03 | DPIA/high-risk privacy assessment covers clinical, location, telehealth, finance and administrative processing. | #92, #85 |
| R9-PRI-04 | Residency and retention/deletion policy is approved and technically implemented without invented periods. | #77, #79, #92 |
| R9-PRI-05 | Backups, object storage, SIEM/OTLP/logs and external providers are inside approved location/transfer boundaries. | #79, #80, #92 |
| R9-PRI-06 | Patient/provider notices, consent versions, withdrawal and rights/escalation procedures are approved. | #92, #87 |
| R9-PRI-07 | Vendor DPA/sub-processor/residency/breach/deletion/exit evidence is accepted for every enabled provider. | #80, #92 |

### R9-CLN — Provider and clinical governance

| ID | Acceptance objective | Primary dependencies |
| --- | --- | --- |
| R9-CLN-01 | Doctor licence/registration verification source and lifecycle are approved. | #93 |
| R9-CLN-02 | Specialty/subspecialty and service/modality privilege policy is approved. | #93 |
| R9-CLN-03 | Every enabled Other Provider category has approved credentials, capabilities, modalities and scope-of-practice. | #93 |
| R9-CLN-04 | Expiry/revocation/suspension and reverification behavior is executable and UAT-tested. | #93, #87 |
| R9-CLN-05 | Admin/Support remain operational roles without broad clinical privilege. | #82, #87, #92 |
| R9-CLN-06 | Clinical responsibility, incident escalation and patient-safety ownership are documented. | #91, #94 |

### R9-TEL — Telemedicine

| ID | Acceptance objective | Primary dependencies |
| --- | --- | --- |
| R9-TEL-01 | Launch media provider/hosting model and processing location are approved. | #80, #92 |
| R9-TEL-02 | Telehealth-specific consent text/version and pre-join enforcement pass. | #87, #92 |
| R9-TEL-03 | Recording remains disabled unless separately approved with purpose/consent/retention/location/access. | #92, #94 |
| R9-TEL-04 | Native patient/doctor device permissions and join flow pass. | #81, #87 |
| R9-TEL-05 | Provider/network outage cannot be misrepresented as an active consultation. | #90 |
| R9-TEL-06 | Clinical responsibility and emergency escalation during remote care are approved. | #94 |

### R9-EMS — Emergency ambulance

| ID | Acceptance objective | Primary dependencies |
| --- | --- | --- |
| R9-EMS-01 | Production deployment explicitly records ambulance ENABLED or DISABLED. | #94 |
| R9-EMS-02 | Disabled deployment exposes no emergency ambulance API module/routes. | #94 automated gate |
| R9-EMS-03 | Enabled deployment has approved jurisdiction, licensed operator reference, local approval reference and 24x7 support confirmation. | #94 |
| R9-EMS-04 | Operator/provider/crew/vehicle/equipment verification policy is approved where applicable. | #93, #94 |
| R9-EMS-05 | Service area, dispatch ownership, fallback contact and patient safety messaging are approved. | #94 |
| R9-EMS-06 | Emergency location minimization/retention/audit policy is approved. | #77, #92 |
| R9-EMS-07 | Dependency/network/dispatch failure is fail-safe and does not falsely report successful dispatch. | #87, #90 |
| R9-EMS-08 | Advanced CAD/public-network/tracking features remain disabled/deferred unless separately approved. | Release scope governance |

### R9-MKT — Market and commercial-operational scope

| ID | Acceptance objective | Primary dependencies |
| --- | --- | --- |
| R9-MKT-01 | PSP/acquirer contract, settlement/refund/chargeback rules and reconciliation ownership are approved. | #80, #92 |
| R9-MKT-02 | Insurance/claims/NPHIES/FHIR obligation is decided from actual launch regulation/contract rather than assumed. | #80, #92 |
| R9-MKT-03 | Healthcare advertising, notification/SMS/push sender and patient-communication requirements are reviewed. | #80, #92 |
| R9-MKT-04 | Arabic/RTL/accessibility acceptance passes for all in-scope launch journeys. | #81, #87 |
| R9-MKT-05 | Pilot/commercial support coverage and P1/security on-call are staffed and funded. | Operations acceptance |
| R9-MKT-06 | Privacy/security/clinical incident escalation and communications runbooks are rehearsed. | #87, #90, R10 |

## 6. Country expansion rule

KSA acceptance does not automatically authorize UAE, Qatar, Bahrain, Kuwait, Oman or another GCC market.

For every additional country, R9 requires a country delta assessment covering at minimum:

- legal operating entity/contract model;
- healthcare/provider licensing;
- privacy/controller/processor/transfer/residency;
- retention/deletion/records requirements;
- telemedicine;
- emergency/transport;
- payments/insurance/interoperability;
- healthcare communications/advertising;
- support/incident contacts;
- cloud/data-plane and DR topology.

The product should reuse one codebase with country-specific configuration/policy rather than fork product logic by country, but the policy evidence must remain independently approved.

## 7. Evidence and sign-off model

Every R9 acceptance record must include:

- acceptance ID;
- country/jurisdiction;
- exact Release Candidate SHA/build;
- environment;
- enabled/disabled feature list;
- policy/document version;
- evidence reference;
- owner/reviewer role;
- approval date;
- PASS / FAIL / BLOCKED / NOT-APPLICABLE with rationale;
- exception/waiver reference and expiry/review date where applicable.

Restricted legal advice, contracts, licence records, production architecture detail, penetration evidence and personal data must not be committed to public GitHub. Only sanitized references/status belong in #91/#92/#93/#94.

## 8. R9 exit criteria

R9 closes only when:

1. #92, #93 and #94 are closed or formally accepted by the authorized Go/No-Go body;
2. inherited Release 1 dependencies relevant to the launch scope are accepted;
3. the exact Release Candidate has market-specific privacy/legal/compliance and clinical-safety sign-off;
4. every high-risk workflow is either explicitly approved/enabled or safely disabled;
5. no unresolved P0/patient-safety/privacy/security/regulatory blocker is hidden behind a technical PASS;
6. the final decision records country, environment, exact SHA/build and feature scope.

`main` remains unchanged until final Release Candidate Go/No-Go.
