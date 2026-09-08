# Phase B8 — Admin Telehealth & Care Delivery Operations

## Objective

Phase B8 turns the Admin Telehealth navigation item into a live, PHI-neutral virtual-care operations workspace. Administrators can detect readiness/lifecycle problems and perform narrowly scoped operational recovery without acquiring participant access to a telemedicine visit.

## Security boundary

- Admin keeps the existing `APPOINTMENT_OPERATE` permission and is explicitly checked for the `ADMIN` role.
- Admin is **not** granted `TELEHEALTH_JOIN` or `TELEHEALTH_OPERATE`.
- The participant `/telehealth/appointments/:id` routes remain inaccessible to Admin.
- The Admin workspace never returns patient identity, patient account/profile IDs, email, room names, LiveKit URLs/tokens, E2EE key identifiers, wrapped keys, IVs, ciphertext or raw readiness JSON.
- The Next.js BFF keeps CarePoint bearer tokens in HttpOnly server-side flows. Destructive actions require same-origin requests.
- Recording remains disabled by policy; an unexpected stored recording flag is raised as a critical operational signal.

## Live workspace

`GET /api/v1/admin/operations/telehealth/workspace` reads telemedicine appointments from a bounded operational window (2 hours lookback, 24 hours lookahead) and returns:

- appointment/session lifecycle status;
- provider and service operational context;
- normalized boolean consent/readiness state;
- schedule/start/end timestamps;
- KPIs for waiting, ready, active and attention-needed sessions;
- deterministic severity (`INFO`, `MEDIUM`, `HIGH`, `CRITICAL`);
- safe attention reasons such as missing session initialization, missing consent/readiness, terminal-appointment/session mismatch, overdue active session or recording-policy violation.

The response is deliberately PHI-neutral. It is an operations queue, not a clinical workspace and not a patient-identification surface.

## Administrative actions

### Reset readiness

`RESET_READINESS` is allowed only while a telehealth session is `WAITING` or `READY` and the appointment remains active. It:

- clears patient/provider readiness timestamps and stored diagnostic booleans;
- moves the session to `WAITING`;
- preserves telemedicine patient consent;
- does not change appointment schedule, pricing or billing state;
- emits `ADMIN_TELEHEALTH_READINESS_RESET` to `AuditEvent`.

### Terminate active session

`TERMINATE_SESSION` is allowed only for `ACTIVE` sessions and requires one controlled reason:

- `TECHNICAL_FAILURE`
- `SECURITY`
- `PROVIDER_REQUEST`
- `OPERATIONS`

It marks only the telehealth session `ENDED`, sets `endedAt`, and emits `ADMIN_TELEHEALTH_SESSION_TERMINATED`. It **does not** complete, cancel or no-show the appointment; Phase B4 appointment operations remain authoritative for appointment lifecycle transitions.

## Admin Web

- New protected page: `/telehealth`
- New BFF routes:
  - `GET /api/admin/telehealth/workspace`
  - `POST /api/admin/telehealth/actions`
- Navigation module 06 now links to `/telehealth`.
- UI supports English, Arabic, French and Spanish.

## Acceptance gate

`services/api/scripts/admin-b8-smoke.mjs` verifies:

- PATIENT cannot read the Admin telehealth workspace;
- ADMIN still cannot use participant Telehealth routes;
- live queue and severity prioritization;
- patient identity, room credentials, E2EE material and bearer credentials are absent from browser JSON;
- forged cross-origin mutation is rejected without state change;
- readiness reset persists and preserves consent;
- active-session termination persists while appointment status remains unchanged;
- both interventions are auditable;
- authenticated `/telehealth` renders successfully.

General CI runs B8 after B7 and before the existing Slice 2–9 regression smokes. The independent FHIR 10.0–10.13 workflow and Flutter shared/Patient/Doctor/Provider checks remain mandatory before merge.

## Non-goals

- no database migration;
- no RBAC/grant change;
- no Admin join capability;
- no room credential, LiveKit token or E2EE key exposure;
- no clinical content display;
- no raw readiness diagnostics display;
- no new incident-management database model;
- no appointment cancellation/completion/no-show duplication.
