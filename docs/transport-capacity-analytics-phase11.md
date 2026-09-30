# Transport Phase 11 — Capacity Planning, SLA Analytics & Dispatch Performance Intelligence

Branch: `feature/transport-capacity-analytics-phase11-20260930`

## Objective

Phase 11 extends the existing Transport analytics surface with operational intelligence built from the authoritative Medical Transport data already introduced in Phases 1–10.

The feature answers four questions:

1. How is Medical Transport performing against assignment, resource-readiness and departure SLAs?
2. What is the current operational capacity proxy by Ground/Air mode?
3. What demand is already booked over the next days compared with the same weekday's historical average?
4. What operational evidence is associated with each Transport Provider?

Phase 11 is descriptive. It does **not**:

- auto-assign providers
- mutate Medical Transport lifecycle status
- rank providers by a quality score
- promise that fleet capacity is sufficient
- use machine learning
- add new GPS/background tracking
- require booking coordinates

## API

New Admin endpoint:

`GET /admin/transport/performance-analytics`

Permission:

`TRANSPORT_OPERATE`

Optional query parameters:

- `windowDays`: integer 7–365, default 90
- `forecastDays`: integer 1–30, default 14

The Admin transport proxy forwards only those two known query parameters for this endpoint.

## Persistence

Phase 11 adds **no new Prisma model and no database migration**.

It reads existing sources:

- `MedicalTransportRequest`
- `CrewAssignment`
- `TransportRouteRevision`
- `TransportOperationalEscalation`
- `TransportIncident`
- `Provider`
- `TransportUnit`

This avoids creating a second analytics source of truth.

## SLA analytics

### Provider assignment SLA

The historical assignment metric uses:

`requestedAt -> assignedAt`

Requests still unassigned but already outside the configured SLA are counted as breaches.

Requests still inside the SLA window are reported separately as:

`pendingWithinSla`

They are **not** counted as failures.

### Crew / unit readiness SLA

Readiness is measured from:

`assignedAt -> first CrewAssignment containing both a unit and at least one crew provider`

Assigned requests that still have no ready crew/unit after the SLA window are counted as breaches.

### Departure SLA

Departure uses:

`scheduledFor -> enRouteAt`

Requests without `enRouteAt` are evaluated as breaches only after the configured departure grace window.

Requests currently between scheduled time and the end of the grace period are reported as:

`pendingWithinGrace`

### ETA coverage

For assigned Ground Transport requests, Phase 11 reports the percentage with either:

- current `etaMinutes`, or
- at least one `TransportRouteRevision`

This is an evidence-coverage metric, not ETA accuracy.

## Distribution statistics

Duration metrics return:

- count
- average
- p50
- p90
- max

Examples:

- request → assignment
- assignment → resources ready
- scheduled time → departure delay
- request → completion
- transporting → completion
- escalation detection → acknowledgement
- escalation detection → resolution

Percentiles are deterministic nearest-rank calculations.

## Current capacity proxy

Ground and Air are calculated separately.

Current data includes:

- active compatible units
- currently dispatch-ready providers
- active assigned jobs
- upcoming requests in 24h
- upcoming requests in 72h
- upcoming requests in 7d
- requests per active unit

The request-per-unit values are explicitly labeled as a **planning load proxy**.

They are not a capacity guarantee because one vehicle can serve multiple trips during a day and trip duration/turnaround varies.

The capacity query always covers at least seven days even when the selected forecast horizon is shorter.

Current active-job counts are taken from a dedicated active-request query and do not depend on the selected historical window.

## Demand planning

Forecast method:

`SAME_WEEKDAY_HISTORICAL_AVERAGE`

For every future planning day and mode:

- Phase 11 calculates the historical average number of scheduled requests for the same weekday inside the selected historical window.
- It compares that average with requests already booked for the future day.
- It shows booked requests per currently active unit.

Response metadata explicitly states:

- `machineLearning: false`
- `capacityGuarantee: false`

Planning signals are descriptive:

- `NO_ACTIVE_UNITS`
- `BOOKED_ABOVE_HISTORICAL_WEEKDAY_AVERAGE`
- `BOOKED_NEAR_OR_ABOVE_HISTORICAL_AVERAGE`
- `WITHIN_HISTORICAL_RANGE`

These signals do not schedule, cancel, assign or reprioritize any request.

## Provider performance evidence

For providers with Medical Transport requests in the historical window, Phase 11 reports:

- request volume
- completed count
- cancelled count
- completion percentage
- measurable departure count
- on-time departure percentage
- transport-duration distribution
- incident count
- escalation count
- current active jobs
- current active unit count
- current dispatch-readiness status

The table is sorted only by request volume and provider name.

It is **not a provider quality ranking**.

Historical request attribution uses the request's stored `assignedProviderId` for the analyzed record. Phase 11 does not attempt to reconstruct every prior reassignment from lifecycle history.

## Daily demand series

The API returns one row per UTC day in the historical window:

- Ground requests
- Air requests
- requests whose final status is Completed
- requests whose final status is Cancelled

The daily row is anchored on `requestedAt`; Completed/Cancelled describe the current/final request outcome, not necessarily the date that completion/cancellation happened.

## Admin UI

New component:

`TransportPerformanceAnalyticsPanel`

It is rendered on the existing Transport Providers Admin page before the legacy Transport Analytics/Audit panel.

Controls:

- History: 30 / 60 / 90 / 180 / 365 days
- Planning horizon: 7 / 14 / 30 days

Sections:

- operational summary
- assignment SLA
- resource-readiness SLA
- departure SLA
- ETA coverage
- escalation response evidence
- lifecycle-duration evidence
- Ground/Air capacity proxy
- planning horizon table
- provider performance evidence
- recent daily demand

The existing Transport Analytics panel remains available for the original 30-day aggregate and audit view.

## Existing configuration reused

No new environment variables are required.

Phase 11 reuses:

- `TRANSPORT_ASSIGNMENT_SLA_MINUTES`
- `TRANSPORT_RESOURCE_READY_SLA_MINUTES`
- `TRANSPORT_DEPARTURE_GRACE_MINUTES`

No `.env` file is added or modified.

## Audit

Reading the Phase 11 endpoint writes:

`ADMIN_TRANSPORT_PERFORMANCE_ANALYTICS_READ`

Audit metadata includes:

- analytics window
- planning horizon
- historical request count
- upcoming scheduled request count
- forecast method
- `machineLearning: false`
- `capacityGuarantee: false`

No patient coordinates are placed in analytics audit metadata.

## Performance safeguards

Phase 11:

- caps historical requests at 20,000
- caps future/active requests and current resources
- batches assignment/route lookups
- groups provider requests once instead of repeatedly scanning the historical request set
- uses a dedicated current-active-job query
- does not create per-row API calls

## Validation

The API test chain includes:

`npm run v2:transport-phase11`

The contract verifies:

- module registration
- `TRANSPORT_OPERATE` authorization
- bounded query parameters
- no Phase 11 migration
- correct pending-vs-breach SLA semantics
- capacity horizons independent of forecast horizon
- current active-job query independent of historical window
- deterministic same-weekday planning
- no ML/capacity guarantee
- provider evidence without quality ranking
- no lifecycle mutation or provider assignment
- Admin query forwarding
- Admin UI wiring
- no committed `.env` file
