# F2 - Patient rescheduling and earlier-appointment waiting list

Tracker: #142. Development lane: `feature/functional-expansion-care-journeys`.
Base: F1 `49ae51360776c38b9494a51d749bf789c62ad366`. Neither main nor the Release 1 branch is promoted.

## Delivered source scope

Patients can open rescheduling from My Visits, select a future slot for the same provider/service/modality, review the old/new time and confirm. The appointment ID, pricing snapshot, invoice, payment rows and stored visit context are not replaced. A persistent request receipt binds the authenticated actor, appointment version and destination; reusing the request key with a different payload is rejected. The mobile client retains an immutable in-memory retry request after an ambiguous response.

A patient with an existing future booking can request an earlier appointment within a chosen date interval, list or withdraw that request, refresh matching openings, and explicitly accept an earlier slot. No appointment is cancelled while waiting. Successful acceptance moves the original booking and closes the waiting request in the same transaction. Ordinary appointment changes, including the existing Admin path, invalidate stale waiting requests through a database trigger. Expired windows are treated as expired on reads and rejected on acceptance; no expiry cron is required for correctness.

Provider menus expose an aggregated waiting-demand view by their own service and modality, with counts and requested dates but without patient identities, phone numbers or clinical contents.

EN/AR/FR/ES labels, Arabic RTL, dd/mm/yyyy display, calendar validation, explicit confirmations, loading/error/empty states and preserved authentication transport are included.

## Transaction and safety boundaries

- Patient identity comes from the authenticated session, never from request fields.
- Rescheduling and the public cancellation route lock the appointment and use Serializable transactions with bounded conflict retries. Inventory increments/decrements, appointment updates, append-only change history and audit/SIEM enqueue are transactional.
- The existing lifecycle trigger still emits RESCHEDULED signals for the reminder orchestrator; this is not a new notification provider.
- Current provider/service/modality state, availability exceptions, other active patient appointments, issued claims and the expiry of approved insurance eligibility/authorisation are checked before transfer.
- Clinical documentation prevents self-service date rewriting. Started/ended telehealth sessions are rejected. Telemedicine changes must remain outside the existing 30-minute preparation window at both source and destination.
- A changed clinic assignment or an original home address outside current coverage requires provider review rather than silently rewriting visit context.
- No payment gateway is called and no new payment is created by rescheduling.

## Persistence and migration

`20260911143000_f2_patient_rescheduling_waitlist` is additive. It adds `PatientAppointmentChange` and `PatientWaitlistEntry`, foreign keys, one-active-request uniqueness and append-only/invalidation triggers. Scalar reference fields follow the repository's operational-model convention; referential constraints are enforced by SQL.

Deploy migrations before enabling these new endpoints. Do not drop history tables to perform an application rollback. Existing release migration/recovery gates remain mandatory.

## API surface

- GET `patient-journeys/appointments/:appointmentId/reschedule-options`
- POST `patient-journeys/appointments/:appointmentId/reschedule`
- GET `patient-journeys/appointments/:appointmentId/history`
- POST `patient-journeys/appointments/:appointmentId/waitlist`
- GET `patient-journeys/waitlist`
- POST `patient-journeys/waitlist/:entryId/withdraw`
- GET `patient-journeys/waitlist/:entryId/matches`
- GET `provider/waitlist`

These routes inherit the existing global authentication guard and explicit role permissions. The service separately enforces ownership. History here is F2 patient-initiated change history; it is not a replacement for all prior administrative audit events.

## Verification boundary

New backend tests exercise the compiled policy/service using in-memory collaborators only. They verify ownership, validation, command shape, idempotency, requested transaction isolation, waitlist behaviour and error paths. They are NOT a measurement of PostgreSQL race/rollback behaviour. Flutter tests exercise immutable requests, API boundaries, date/localisation helpers and widget confirmation/retry/history/waitlist flows. Existing full CI, migration, PostgreSQL recovery, security, FHIR, container and native compatibility workflows must run on the resulting head.

Dedicated live-database F2 concurrency/rollback acceptance, financial-snapshot equality, physical-device UAT and production/provider acceptance remain to be recorded; no unit test is represented as that evidence. CI results and exact SHAs are recorded in the PR/issue after execution rather than assumed here.

## Explicit limitations

The waiting list brings an EXISTING appointment forward. It is not yet a queue for patients without a booking, a clinical triage queue, FIFO priority allocation, exclusive timed offers, automatic rebooking or push/SMS/email alerts. Availability is refreshed on demand and can change before confirmation. Production deployment and the external/human go-live gates remain deferred, not bypassed. Source/read history is bounded to the latest 100 records; options are bounded and indicate truncation. Persistent mobile pending-change recovery across process termination is not yet included.
