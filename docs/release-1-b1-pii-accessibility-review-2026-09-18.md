# Release 1 — B1 PII Classification and Accessibility Review

Cut-off: 2026-09-18  
Branch: `autonomous/completion-2026-09-18`

## Scope and decision boundary

This is the technical B1 review requested by the 2026-09-17 finalization plan. It inventories sensitive-data surfaces and accessibility evidence that can be verified from the repository. It is intentionally a **candidate classification**, not a legal/privacy determination. Rows marked `REQUIRES_POLICY_APPROVAL` must not be represented as finally classified until Privacy/Legal/Clinical owners approve the treatment and retention rules for the launch jurisdiction.

The approved functional specification defines `FR-DAT-001` as application-level authenticated encryption for clinical fields and high-risk PII. Data residency is a separate non-functional/jurisdictional gate. The release therefore must not claim complete `FR-DAT-001` coverage merely because clinical records are encrypted.

## Existing encrypted/safe-by-design boundaries

| Surface | Repository evidence | Technical state |
| --- | --- | --- |
| Clinical records | `ClinicalRecord` stores algorithm/key/wrapped-key/IV/ciphertext; `ClinicalEnvelopeService` uses envelope encryption and forbids local clinical keys in production unless the explicit synthetic-pilot profile allows them | Encrypted application payload. External KMS evidence remains a release-environment gate. |
| Clinical documents | document metadata uses encrypted envelope fields; encrypted blobs carry wrapped-key/IV metadata; diagnostic reports are ciphertext-backed | Encrypted application/document boundary. Storage-provider acceptance remains external. |
| Secure care messaging | conversation subjects and message bodies are stored as encrypted envelopes | Encrypted application payload. |
| MFA secret | `MfaEnrollment` persists wrapped/encrypted secret fields | Encrypted application payload. |
| Telehealth E2EE material | telehealth session persists wrapped E2EE key material rather than room media | Encrypted key material; real LiveKit/TURN/device acceptance remains external. |
| Notifications | `NotificationEvent` stores safe template keys and entity references, not message/location clinical detail; Slice 8 rejects transport/emergency address/callback sentinels in notification persistence | PHI-minimized notification persistence. |

## Candidate high-risk PII inventory

`REQUIRES_POLICY_APPROVAL` means the repository proves the field exists and is currently stored in clear scalar columns, but the audit cannot choose the final legal classification, encryption-at-application requirement, retention duration, masking policy or operational exception on behalf of the deployment authority.

| Domain / field group | Persistence | Candidate risk | Current protection visible in code | B1 disposition |
| --- | --- | --- | --- | --- |
| Emergency ambulance `latitude`, `longitude` | `EmergencyAmbulanceRequest` | Precise patient location | RBAC/ownership + audit; not copied into notification payloads | **REQUIRES_POLICY_APPROVAL** for application-field encryption/operational access/retention. |
| Emergency `pickupAddress` | `EmergencyAmbulanceRequest` | Patient location/address | RBAC/ownership + audit; notification minimization | **REQUIRES_POLICY_APPROVAL**. |
| Emergency `callbackPhone` | `EmergencyAmbulanceRequest` | Direct contact identifier | RBAC/ownership + audit; notification minimization | **REQUIRES_POLICY_APPROVAL**. |
| Emergency free-text `note` | `EmergencyAmbulanceRequest` | May contain health/clinical/contextual PHI | RBAC/ownership + audit; no generic notification copy | **HIGH PRIORITY — REQUIRES_POLICY_APPROVAL**; free text has highest accidental-PHI risk. |
| Scheduled transport pickup/destination coordinates | `MedicalTransportRequest` | Precise patient movement/location | family-scoped authorization + audit + PHI-neutral notifications | **REQUIRES_POLICY_APPROVAL**. |
| Scheduled transport pickup/destination address | `MedicalTransportRequest` | Address/location and care context | family-scoped authorization + audit + PHI-neutral notifications | **REQUIRES_POLICY_APPROVAL**. |
| Scheduled transport `callbackPhone` | `MedicalTransportRequest` | Direct contact identifier | scoped authorization + audit + notification minimization | **REQUIRES_POLICY_APPROVAL**. |
| Scheduled transport assistance/equipment | `MedicalTransportRequest` | Health/mobility information | typed allowlist, scoped provider-family access | **REQUIRES_POLICY_APPROVAL**; medically sensitive even without free text. |
| Home-visit visit address and coordinates | `AppointmentVisitContext` | Patient/home location | appointment authorization + validated visit context | **REQUIRES_POLICY_APPROVAL**. |
| Home-visit `contactPhone` / instructions | `AppointmentVisitContext` | Direct contact + possible contextual PHI | appointment authorization; bounded fields | **REQUIRES_POLICY_APPROVAL**; instructions require special attention if user-entered. |
| Patient name / phone | `PatientProfile` | Direct identifiers | authenticated domain access | **REQUIRES_POLICY_APPROVAL** for high-risk classification/masking/retention; not currently application-field encrypted in the examined schema. |
| Account email / IP / user agent | `User`, `AuthSession` | Identity/security telemetry | IAM controls and session lifecycle | Privacy inventory required; encryption-at-field decision depends on approved classification. |
| Provider credential number / issuer | provider/onboarding credential models | Professional identifiers; may include personal identifiers depending on jurisdiction | admin/provider authorization and audit | Privacy inventory required; final classification jurisdiction-dependent. |
| Provider/clinic locations | `ProviderLocation` | Usually operational/business location, sometimes potentially personal | provider ownership and release context validation | Classification depends on whether location is public facility vs private/home practice. |
| Audit `metadata` JSON | `AuditEvent` | Unstructured leakage channel if callers insert PHI | current transport/emergency writers use IDs/status/source rather than location/contact data | **KEEP PHI-NEUTRAL**; add/maintain regression guards. |

## Data-flow constraints that are safe to enforce without a legal decision

The following are technical invariants and should remain release gates regardless of final field classification:

1. Notification persistence and external templates must remain PHI-neutral. Address, coordinates, callback numbers, free-text notes and clinical details must not be copied to `NotificationEvent`.
2. Audit events should identify actor/action/object/purpose/result and use minimal metadata. Transport/emergency address, coordinates, callback numbers and notes must not be copied to `AuditEvent.metadata`.
3. Sensitive operational data must be returned only through authenticated ownership/role/family-scoped APIs; no generic public discovery endpoint may expose patient logistics.
4. Logs and error messages must not serialize request bodies containing transport/emergency/home-visit sensitive fields.
5. Field encryption decisions must preserve dispatcher/responder availability and emergency safety requirements; no encryption migration should be introduced until access, key-availability, break-glass and recovery behavior are approved and tested.
6. Retention/deletion treatment must be linked to the existing data-governance hold/retention mechanism and to jurisdictional policy rather than hard-coded ad hoc in transport/emergency modules.

## Technical next step for FR-DAT-001

The implementation is **not** promoted to complete. The remaining decision is explicit:

- Privacy/Legal/Clinical owners approve which of the `REQUIRES_POLICY_APPROVAL` rows are "high-risk PII" under the launch profile and whether application-field encryption is mandatory for each.
- Engineering then implements the approved set using the existing envelope/KMS pattern (or a documented operational exception), including migration/backfill, key rotation, masked operational views, backup/dump verification and rollback/recovery tests.
- AC-07 can only move beyond its current partial state after a representative dump proves the approved encrypted fields are not present in clear text.

Until then, release documentation must say **partial application-field encryption coverage**.

---

## Accessibility review

The approved UX source requires WCAG 2.2 AA-oriented web behavior and equivalent mobile accessibility. It also requires status redundancy (color + text + icon/badge), explicit confirmation for sensitive actions, progressive disclosure, persistent context, and no motion dependency for emergency/error information.

### Evidence currently visible in the reviewed Release 1 transport/emergency surfaces

| UX rule | Current evidence | Technical disposition |
| --- | --- | --- |
| Emergency action not color-only | Patient emergency flow uses emergency icon plus explicit localized text and confirmation dialog | Meets redundancy pattern at implementation level; real screen-reader/device verification pending. |
| Transport status not color-only | Patient/Provider transport status uses text chips/status labels together with mode/status icons | Meets redundancy pattern at implementation level. |
| Explicit emergency confirmation | Emergency ambulance action opens a confirmation dialog before acquiring/sending current location | Present. |
| Localized status/content | Transport copy exists in EN/AR/FR/ES; Arabic follows shared RTL directionality | Present; final linguistic/visual review pending. |
| Long transport detail content reachable | Regression tests explicitly scroll long detail pages before asserting provider/logistics controls | Automated rendering/interaction evidence; not a substitute for assistive-technology UAT. |
| Critical information independent of animation | Reviewed emergency/transport flows present textual state; no required motion signal is used for emergency status | Present in reviewed slice. |

### Accessibility gaps that remain external or broader than this code slice

The repository evidence does not prove full WCAG 2.2 AA conformance for all Admin and mobile journeys. Required closure evidence remains:

- automated web accessibility scan on the exact release candidate for the approved MVP screens;
- keyboard-only traversal, focus order and visible focus checks for Admin;
- screen-reader labels/announcements on Android and iOS release builds;
- dynamic text/font scaling, reflow and small-screen testing;
- Arabic RTL visual/reading-order regression;
- contrast verification for semantic states and disabled/focus states;
- real-device checks for dialogs, queues, telemedicine controls and emergency flows;
- remediation evidence tied to the same RC used for final UAT.

These checks require either a runnable browser/device environment or production mobile runners. They cannot be replaced by a document-only declaration.

## B1 status

**Technical inventory: completed on this branch.**  
**Final PII classification: BLOCKED by policy approval.**  
**Full accessibility acceptance: BLOCKED by browser/device evidence and final UAT.**

No field-encryption migration is introduced by this review because doing so before the approved classification and emergency/dispatch availability policy would create an unreviewed safety and recovery decision.
