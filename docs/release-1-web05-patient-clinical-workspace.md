# Release 1 — WEB-05 Patient Clinical Workspace

## Purpose

This artifact records the Release 1 implementation and acceptance boundary for the approved **WEB-05 Patient Clinical Workspace** tracked by #76 and R7 #87.

The approved UX baseline defines WEB-05 as a longitudinal patient view for authorized clinical staff/providers, using patient identity, consent, appointments, records, laboratory data, prescriptions and clinical signals to provide a clinical summary, timeline, encounter access and risk/clinical alerts. Sensitive clinical values must remain on solid surfaces, with access context and audit/security state visible.

## Release 1 implementation boundary

WEB-05 is implemented as a dedicated clinical zone in the existing Next.js deployment:

- `/clinical` — authorized Patient Clinical Workspace;
- `/clinical/login` — clinical-provider sign-in;
- `/api/clinical/*` — server-side BFF boundary.

It does **not** reuse the Admin authentication/authorization boundary. Clinical sessions use an isolated HttpOnly cookie family (`carepoint_clinical_*`) and accept only active `DOCTOR` or `OTHER_PROVIDER` accounts. Backend clinical endpoints still enforce CarePoint permissions plus patient-level treatment/consent/authorship access. `ADMIN` does not receive clinical-record permission merely because it is an administrative role.

The browser URL never carries a patient identifier. The authorized provider obtains a leakage-minimized roster derived only from the provider's own confirmed/completed treatment relationships or authored clinical records, then sends the selected opaque patient identifier in the same-origin BFF request body.

## Workspace content

The workspace surfaces, where separately authorized:

- patient first/last name and opaque patient identifier;
- viewing provider identity/class and clinical access basis;
- longitudinal finalized/open encounter timeline;
- latest diagnoses, medication list and vitals from the encrypted clinical record;
- prescriptions, laboratory orders and laboratory results;
- clinical documents;
- diagnostic reports;
- provider-entered laboratory flags as clinical/risk signals without creating autonomous medical inference;
- explicit security context showing encrypted records, audited access and server-side authorization.

The Release 1 workspace does not introduce an autonomous risk engine, diagnostic recommendation engine or AI-generated treatment recommendation. It only surfaces stored clinical content and explicit provider/laboratory flags already present in authorized data.

## Privacy, safety and UX controls

- Clinical data remains behind a dedicated provider session boundary.
- Admin and Patient roles are denied the provider clinical workspace.
- Cross-patient access without an approved treatment/consent/authorship basis is denied server-side.
- Orders, documents and diagnostic reports retain their own domain-specific consent/relationship checks; a section can be shown as restricted without weakening those checks.
- Clinical BFF responses use `private, no-store` and `nosniff` response controls.
- No clinical payload is written to client console/logging code.
- Patient identifiers are not encoded into browser routes or query strings.
- Finalized clinical encounters remain immutable through the existing backend controls.
- English, Arabic/RTL, French and Spanish are supported using the existing Release 1 locale provider.
- Sensitive values are displayed on opaque/solid clinical surfaces; status uses text plus symbols/badges rather than color alone.
- The layout adapts from parallel desktop roster/snapshot/timeline presentation to stacked tablet/mobile presentation.

## Automated acceptance

`services/api/scripts/release1-web05-clinical-workspace-smoke.mjs` runs as part of the existing Slice 5 CI step after the clinical-record, order/laboratory and document/report fixtures exist. It validates both direct API and web/BFF behavior:

1. the authorized Doctor sees the patient in the leakage-minimized roster;
2. the workspace contains patient/viewer/access context, longitudinal record, orders/lab result, documents and diagnostic reports;
3. provider-entered lab flags are surfaced without autonomous risk inference;
4. a different unrelated patient is denied;
5. ADMIN and PATIENT roles are denied the provider workspace;
6. the clinical BFF rejects Admin clinical login;
7. the isolated clinical cookie family is issued to an eligible provider;
8. BFF roster/workspace responses are `no-store`;
9. the `/clinical` page is accessible only through the clinical-provider boundary;
10. logout revokes the session and the old cookie set cannot continue reading the roster.

## R7 UAT scenario

### UAT-WEB05-001 — Authorized provider Patient Clinical Workspace

**Persona:** Doctor or clinically authorized Other Provider.

**Preconditions:** active provider account/profile, approved Release 1 MFA policy, synthetic Patient A with a valid treatment relationship or explicit clinical consent, synthetic Patient B with no valid access basis, finalized and open encounter fixtures, clinical order/lab/document/report fixtures.

**Acceptance:** the provider signs into the dedicated clinical zone, selects Patient A without a patient ID appearing in the browser URL, sees patient/provider/access/audit/encryption context, longitudinal encounters and separately authorized orders/labs/documents/reports, and sees explicit stored clinical flags without autonomous interpretation. Patient B must return access denied. Admin-only credentials must not open the workspace. English and Arabic/RTL must preserve data meaning, focus/navigation and authorization behavior.

**Evidence required for final UAT:** exact RC SHA/build, production-equivalent environment, synthetic fixture references, screenshots with synthetic data only, request/correlation references with PHI-safe logging, PASS/FAIL/BLOCKED result, tester and date.

Automated CI is prerequisite evidence but does not replace final R7 production-equivalent UAT sign-off.
