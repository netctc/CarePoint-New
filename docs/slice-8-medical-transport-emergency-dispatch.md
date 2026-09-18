# Slice 8 — Persistent Medical Transport & Emergency Dispatch

## Purpose

Slice 8 closes two MVP gaps:

1. Emergency Ambulance becomes a persistent, auditable dispatch workflow instead of an in-memory runtime map.
2. Ground and air medical transport gain a scheduled workflow that remains separate from ordinary healthcare appointments.

Emergency transport is deliberately **not** an `Appointment`. It bypasses provider search, service availability and booking inventory.

## Domain boundaries

### Doctor

Doctors do not receive Emergency Ambulance or medical-transport responder permissions and have no transport UI.

### Other Provider

Transport capabilities are restricted by the provider category family in addition to role permissions:

- `EMERGENCY_AMBULANCE` — emergency response only;
- `MEDICAL_TRANSPORT_GROUND` — scheduled ground transport only;
- `MEDICAL_TRANSPORT_AIR` — scheduled air transport only.

A generic Other Provider, Doctor, or provider from another transport family cannot cross these boundaries.

## Emergency Ambulance

### Patient flow

The Patient Home emergency action is a high-priority path:

1. minimal confirmation;
2. device location acquisition;
3. server-side Patient identity derivation from the authenticated account;
4. persistent Emergency Ambulance request;
5. dispatch status screen with refresh and limited cancellation.

The request body does not accept an authoritative `patientId`.

A `clientRequestId` gives the mobile request an idempotency boundary. PostgreSQL persists the mapping in `EmergencyRequestIdempotency`.

### Emergency lifecycle

```text
REQUESTED
  -> DISPATCHING
  -> ASSIGNED
  -> EN_ROUTE
  -> ARRIVED
  -> TRANSPORTING
  -> COMPLETED
```

`CANCELLED` is terminal. The Patient may cancel only while the request is `REQUESTED`, `DISPATCHING`, or `ASSIGNED`. Once the assigned responder is en route, cancellation becomes an operational decision rather than a Patient self-service action.

### Dispatch

Operations may:

- list the emergency queue;
- mark a request as dispatching;
- assign an eligible active Emergency Ambulance Other Provider;
- provide an ETA.

Only the assigned Emergency Ambulance provider may advance the response lifecycle.

All state transitions are guarded by compare-and-update conditions inside serializable PostgreSQL transactions so stale clients cannot silently overwrite a concurrent dispatch change.

### Persistence

The existing `EmergencyAmbulanceRequest` table remains the request aggregate. Slice 8 adds:

- `EmergencyRequestIdempotency`;
- `EmergencyDispatchEvent`.

`EmergencyDispatchEvent` provides ordered operational history without storing video/audio or arbitrary clinical content.

## Scheduled Medical Transport

Scheduled transport is independent of `Appointment` and supports:

- `GROUND`;
- `AIR`.

Assistance levels:

- `STANDARD`;
- `WHEELCHAIR`;
- `STRETCHER`.

A scheduled request must be at least 15 minutes in the future. Urgent transport must use Emergency Ambulance.

### Patient lifecycle

```text
REQUESTED
  -> ASSIGNED
  -> EN_ROUTE
  -> ARRIVED
  -> TRANSPORTING
  -> COMPLETED
```

`CANCELLED` is terminal. Patient self-cancellation is available only before the responder goes `EN_ROUTE`.

### Provider acceptance and concurrency

An eligible Ground/Air Other Provider may view unassigned requests for its own mode and accept a request.

Acceptance is atomic:

```text
WHERE status = REQUESTED
  AND assignedProviderId IS NULL
```

If two providers attempt to accept the same request concurrently, exactly one assignment wins. The loser receives an HTTP conflict and must refresh.

Operations may also explicitly assign an eligible provider from the correct transport family.

### Persistence

New modular Prisma schema:

`services/api/prisma/transport.prisma`

Models:

- `MedicalTransportRequest`;
- `MedicalTransportEvent`;
- `EmergencyRequestIdempotency`;
- `EmergencyDispatchEvent`.

Migration:

`20260907054000_medical_transport_emergency_dispatch`

The migration follows CarePoint's existing `TEXT` identifier convention and reuses baseline Emergency Ambulance indexes rather than recreating them.

## Authorization

New permissions:

- `PATIENT_TRANSPORT_REQUEST`;
- `EMERGENCY_DISPATCH_OPERATE`;
- `EMERGENCY_RESPOND`;
- `TRANSPORT_OPERATE`;
- `TRANSPORT_RESPOND`.

Role grants are necessary but not sufficient for responders. Runtime provider-family checks enforce the actual transport domain.

## API

### Patient Emergency Ambulance

```text
POST /api/v1/emergency/ambulance
GET  /api/v1/emergency/ambulance
GET  /api/v1/emergency/ambulance/:id
POST /api/v1/emergency/ambulance/:id/cancel
```

### Emergency operations

```text
GET  /api/v1/operations/emergency/ambulance
POST /api/v1/operations/emergency/ambulance/:id/dispatch
POST /api/v1/operations/emergency/ambulance/:id/assign
```

### Emergency responder

```text
GET  /api/v1/provider/emergency/ambulance
POST /api/v1/provider/emergency/ambulance/:id/status
```

### Patient scheduled transport

```text
POST /api/v1/medical-transport
GET  /api/v1/medical-transport
GET  /api/v1/medical-transport/:id
POST /api/v1/medical-transport/:id/cancel
```

### Scheduled transport operations

```text
GET  /api/v1/operations/medical-transport
POST /api/v1/operations/medical-transport/:id/assign
```

### Scheduled transport responder

```text
GET  /api/v1/provider/medical-transport/available
GET  /api/v1/provider/medical-transport
POST /api/v1/provider/medical-transport/:id/accept
POST /api/v1/provider/medical-transport/:id/status
```

## Notifications and PHI boundary

Slice 8 extends the Slice 7 notification taxonomy with:

- `EMERGENCY_UPDATE`;
- `TRANSPORT_UPDATE`.

External/in-app notification records receive generic safe template keys only:

- `notification.emergency.title`;
- `notification.emergency.body`;
- `notification.transport.title`;
- `notification.transport.body`.

Location coordinates, pickup/destination addresses, callback numbers, responder notes and other transport details are not copied into `NotificationEvent` payloads.

## Audit

Material actions generate platform audit events, including:

- emergency request;
- dispatch transition;
- assignment;
- responder lifecycle changes;
- emergency cancellation;
- scheduled transport request;
- transport assignment/acceptance;
- transport lifecycle changes;
- scheduled transport cancellation.

The detailed state history remains in the dedicated transport/dispatch event tables.

## Mobile

### Patient

Patient Home now contains:

- the existing prominent red Emergency Ambulance action, connected to the live API;
- current device location acquisition through `geolocator`;
- emergency status/history and allowed cancellation;
- a separate scheduled Medical Transport screen;
- Ground/Air selection;
- assistance selection;
- pickup from current device location;
- destination coordinates/address;
- scheduled date/time;
- request history and cancellation.

### Other Provider

The Other Provider app exposes a Transport Operations workspace.

The client probes its authorized transport domain through the protected server APIs:

- Emergency Ambulance providers see assigned emergency jobs;
- Ground/Air transport providers see mode-specific available and assigned jobs;
- unrelated Other Provider categories receive a non-enabled state;
- server authorization remains authoritative.

### Doctor

No transport action is added to the Doctor app.

### Localization

Transport UI copy is available in:

- English;
- Arabic;
- French;
- Spanish.

Arabic uses the existing CarePoint RTL directionality.

## Acceptance coverage

`services/api/scripts/slice8-smoke.mjs` verifies:

- Emergency request persistence and idempotency;
- Patient ownership isolation;
- Doctor responder denial;
- transport-family separation;
- dispatch assignment rules;
- Emergency Ambulance responder lifecycle;
- late Patient cancellation rejection;
- scheduled Ground/Air request idempotency;
- Ground/Air family separation;
- concurrent Ground-provider acceptance with one winner and one HTTP 409;
- ordered responder lifecycle enforcement;
- Patient scheduled cancellation;
- Air-provider acceptance;
- zero ordinary `Appointment` creation by Emergency/Transport;
- PHI-neutral notifications;
- audit coverage.

Mobile-core tests verify:

- Patient emergency requests do not send `patientId`;
- Patient transport requests do not send `patientId` or `providerId`;
- provider acceptance/status requests do not send `providerId`;
- Other Provider transport workspace renders a server-authorized queue.

## Production gates

Slice 8 establishes application-level persistence and authorization boundaries but is not a complete emergency-dispatch platform certification.

Production rollout still requires, at minimum:

- Android/iOS host projects with native location permission declarations and release review (those host folders are not versioned in this repository);
- background/location lifecycle handling appropriate to the release platform;
- dispatch-center operational UI/alerting and escalation policies;
- mapping/geocoding/routing provider integration;
- responder fleet/vehicle identity and availability management;
- duplicate/emergency abuse controls and rate limiting;
- push/SMS/email production adapters and delivery retry operations;
- location-data retention and privacy policy;
- regional emergency-service/legal review;
- offline/network-loss behavior and escalation;
- observability/SIEM and incident response;
- load/concurrency testing at dispatch scale;
- disaster recovery and business-continuity exercises.

Emergency Ambulance should not be represented to users as a replacement for local public emergency numbers until the relevant operational, legal and safety requirements are satisfied for the deployment jurisdiction.
