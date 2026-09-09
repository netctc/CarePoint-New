# Release 1 — Booking/status reminder orchestration (FR-NTF-001)

Status: **CODE IMPLEMENTED / EXACT-SHA VALIDATION REQUIRED / PRODUCTION DEPLOYMENT EVIDENCE PENDING R3 #79**

Release branch: `release/release-1-integration-go-live-readiness`
Tracker: #78, master #70

## Requirement baseline

The approved Release 1 specification places reminders in M14 Messaging and notifications and defines FR-NTF-001 as P0: CarePoint must generate booking reminders, status-change notifications and operational communications through configurable channels. Reminder timing must therefore be a deployment/product policy, not a hard-coded market assumption.

## Implementation

Release 1 now uses two durable PostgreSQL stages before the existing notification delivery outbox.

1. A database trigger on `Appointment` writes an `AppointmentLifecycleSignal` in the same transaction as appointment creation, status change or reschedule. This prevents successful booking/status mutations from depending on an in-memory callback.
2. `AppointmentNotificationOrchestratorService` claims unprocessed lifecycle signals transactionally and creates idempotent `APPOINTMENT_UPDATE` notification events for the patient and linked provider account. Existing `NotificationDelivery` rows continue to enforce per-account IN_APP/PUSH/EMAIL/SMS preferences and retries.
3. `AppointmentReminderSchedule` stores the configured reminder offset, appointment generation (`appointmentUpdatedAt`), due time and terminal state. Schedules are generated only from the configured offsets.
4. On reschedule, reminder schedules and pending reminder deliveries for the previous appointment generation are cancelled/skipped. On CANCELLED, COMPLETED or NO_SHOW, all active reminder schedules for the appointment are cancelled.
5. Before a reminder delivery is routed, `NotificationOutboxStoreService` revalidates that the appointment is still CONFIRMED, still in the future and still matches the appointment generation embedded in the reminder dedupe key. A stale reminder is skipped even if it was already present in the delivery outbox.

## Idempotency and concurrency

Lifecycle notification dedupe keys are based on the durable lifecycle-signal ID. Reminder dedupe keys are based on appointment ID, configured offset and appointment generation. `NotificationEvent.dedupeKey` remains globally unique and channel rows use the existing `(notificationId, channel)` uniqueness. Lifecycle signals and reminder schedules are claimed with conditional PostgreSQL updates inside transactions; competing API replicas therefore cannot legitimately complete the same work twice.

## PHI minimisation

External delivery continues to use only safe template keys plus opaque entity references. Appointment service names, patient names, clinical notes, cancellation reasons and other clinical/operational text are not placed in the notification event template payload. In-app detail must be resolved after authenticated application access.

Release 1 appointment template keys are:

- `notification.appointment.requested.title/body`
- `notification.appointment.confirmed.title/body`
- `notification.appointment.rescheduled.title/body`
- `notification.appointment.cancelled.title/body`
- `notification.appointment.completed.title/body`
- `notification.appointment.no-show.title/body`
- `notification.appointment.reminder.title/body`

## Production configuration

The production deployment must explicitly set an approved reminder timing policy. Engineering does not choose a market timing policy.

- `APPOINTMENT_NOTIFICATION_WORKER_ENABLED=true` — mandatory in production.
- `APPOINTMENT_NOTIFICATION_POLL_MS` — technical poll cadence, 100..60000 ms.
- `APPOINTMENT_NOTIFICATION_BATCH_SIZE` — 1..200.
- `APPOINTMENT_REMINDER_OFFSETS_MINUTES` — comma-separated positive integer minute offsets, each no greater than 30 days. Production startup fails if this is absent/empty.

Example syntax only, **not an approved market policy**: `APPOINTMENT_REMINDER_OFFSETS_MINUTES=1440,120`. The actual values require Product/Operations approval for the launch market.

The existing notification delivery configuration remains authoritative for channels/providers: `NOTIFICATION_GATEWAY_*`, `NOTIFICATION_WORKER_*`, user preferences and registered endpoints.

## Automated acceptance

`services/api/scripts/release1-appointment-reminders-smoke.mjs` and the dedicated CI step validate:

- production rejects a disabled appointment-notification worker and an undefined reminder timing policy;
- booking creates patient/provider confirmation notifications;
- idempotent booking retries do not duplicate notifications;
- user channel opt-out is enforced;
- rescheduling cancels the old reminder generation and skips its pending deliveries;
- cancellation cancels active reminders;
- delivery-time validation skips stale reminders;
- a configured due reminder is created and delivered through the durable outbox;
- due time is absolute appointment time minus the configured offset and is independent of display locale/time-zone formatting;
- completion produces a status-change notification;
- notification events use PHI-neutral template keys;
- appointment mutations create durable lifecycle signals which are subsequently processed.

## Operational acceptance still required

Code-side completion is not production evidence. Before #78 can be considered fully production accepted, R3 #79 must prove that the Release 1 runtime actually runs the appointment orchestrator and existing notification worker continuously, that the approved launch timing values are supplied through runtime configuration, and that enabled real channels are validated under R4 #80. UAT R7 #87 must confirm that Patient/Doctor/Other Provider operational expectations are met for the selected channel/timing policy.

No merge to `main` is authorized by this document.
