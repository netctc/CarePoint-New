# Slice 2 - Services, Availability, Scheduling and Booking

Slice 2 implements the first transactional care-booking workflow on top of the persistent IAM baseline.

## Scope

- Active independent Doctors and Other Providers can create their own service catalog.
- Service labels and descriptions support EN/AR/FR/ES while canonical internal identifiers remain English.
- A service can expose one or more modalities: `CLINIC`, `TELEMEDICINE`, `HOME_VISIT`.
- Each modality has its own duration and price in minor currency units.
- Providers define recurring availability rules with IANA time zones.
- Rules are materialized into UTC slots for deterministic search and booking.
- Patients can search active services and open availability without authentication.
- Authenticated patients book a concrete slot using an idempotency key.
- Patients can view and cancel their own appointments.
- Providers can view their own appointment agenda.

Emergency Ambulance remains a separate urgent flow and is intentionally not represented as an ordinary appointment modality.

## Service ownership

Only an `ACTIVE` provider may manage services or availability. The API derives the provider from the authenticated account, so callers cannot manage another provider by sending a different provider id.

Doctor services remain inside the Doctor domain, covering all specialties and sub-specialties. Other Provider services remain inside the non-doctor healthcare/medical-transport domain.

## Availability model

`AvailabilityRule` stores:

- provider and service
- modality
- IANA time zone
- weekday (`0` Sunday through `6` Saturday)
- local start/end minutes
- slot interval
- capacity
- effective date range

The generation endpoint materializes a maximum of 31 days at a time. Generated timestamps are stored in UTC while the originating rule retains its local time zone.

`AvailabilitySlot` stores explicit inventory:

- `capacity`
- `bookedCount`
- `OPEN` / `BLOCKED` status
- optimistic `version`
- source rule

Generation is idempotent through a unique provider/service/modality/start-time key.

## Concurrency-safe booking

Booking is treated as an inventory transaction rather than a simple appointment insert.

1. The patient profile is resolved from the authenticated account.
2. The idempotency key is checked.
3. A serializable PostgreSQL transaction reads the selected slot.
4. Slot inventory is incremented with an atomic conditional update: `bookedCount < capacity`.
5. The appointment is created in the same transaction.
6. Serialization failures are retried up to three times.
7. A duplicate idempotency key returns the already-created appointment for the same patient.

The migration also installs PostgreSQL exclusion constraints using `btree_gist` so active appointments cannot overlap for the same provider or the same patient, even when they originate from different overlapping slots.

## Cancellation

Cancelling an active appointment and releasing its slot inventory occur in the same transaction. A cancelled slot becomes immediately bookable again when capacity is available.

## Permissions

New stable permissions:

- `PROVIDER_MANAGE_SERVICES`
- `PROVIDER_MANAGE_AVAILABILITY`
- `PATIENT_BOOK_APPOINTMENT`
- `PATIENT_MANAGE_APPOINTMENT`
- `APPOINTMENT_OPERATE`

Doctors and Other Providers receive self-service catalog/availability permissions. Patients receive booking and self-management permissions. Administrative appointment operation remains explicit and auditable.

## API surface

### Public discovery

- `GET /api/v1/services/search`
- `GET /api/v1/availability`

### Provider

- `GET /api/v1/provider/services`
- `POST /api/v1/provider/services`
- `PATCH /api/v1/provider/services/:serviceId/status`
- `GET /api/v1/provider/availability/rules`
- `POST /api/v1/provider/availability/rules`
- `POST /api/v1/provider/availability/generate`
- `POST /api/v1/provider/availability/slots/:slotId/block`
- `GET /api/v1/provider/appointments`

### Patient booking

- `POST /api/v1/bookings`
- `GET /api/v1/bookings/me`
- `POST /api/v1/bookings/:appointmentId/cancel`

## CI acceptance scenario

GitHub Actions now executes a PostgreSQL-backed Slice 2 smoke test that:

1. logs in as the bootstrap administrator;
2. creates a Doctor account;
3. completes Doctor onboarding with a verified medical license;
4. creates a multilingual clinic service;
5. creates and materializes an availability rule;
6. registers two patients;
7. sends two concurrent booking requests for the same capacity-one slot;
8. requires exactly one success and one HTTP `409` conflict;
9. verifies idempotent retry returns the same appointment;
10. cancels the winning appointment;
11. verifies the previously losing patient can then book the released slot;
12. verifies the provider agenda contains the booking history.

This scenario is the acceptance gate for the Slice 2 inventory/concurrency invariant.
