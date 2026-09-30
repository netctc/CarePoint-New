# Transport Phase 12 — Operations Command Center, Historical SLA Drill-Down & Exportable Management Reporting

Branch: `feature/transport-command-center-phase12-20260930`

## Objective

Phase 12 converts the aggregate analytics from Phase 11 into a request-level operations command center.

It provides:

- historical SLA drill-down by Medical Transport request
- bounded filters by history window, mode, provider and overall SLA state
- pagination for Admin review
- sanitized management-report export
- explicit privacy boundaries for operational reporting
- audit evidence for both interactive reads and exports

Phase 12 remains descriptive and read-only.

It does **not**:

- assign or reassign a provider
- mutate `MedicalTransportRequest.status`
- mutate escalations
- trigger provider notifications
- add background GPS
- expose patient name, phone, addresses or coordinates in the command-center/report payload

## API

All endpoints require:

`TRANSPORT_OPERATE`

### Command center

`GET /admin/transport/command-center`

Optional query parameters:

- `windowDays`: 7–365, default 90
- `mode`: `ALL`, `GROUND`, `AIR`
- `providerId`: bounded safe operational ID
- `sla`: `ALL`, `BREACHED`, `COMPLIANT`, `PENDING`
- `page`: 1–1000, default 1
- `limit`: 25–250, default 100

### Management report

`GET /admin/transport/management-report`

Optional query parameters:

- `windowDays`
- `mode`
- `providerId`
- `sla`

The response is structured JSON designed for deterministic CSV rendering in the Admin browser.

It includes:

- `filename`
- `format: CSV_CLIENT_RENDERED`
- ordered column list
- sanitized row objects
- summary
- source truncation flag
- sensitive-data policy

The browser performs the final CSV serialization.

## Historical request model

The command center selects only operational fields from `MedicalTransportRequest`:

- request ID
- mode
- lifecycle status
- requested/scheduled timestamps
- assigned provider ID
- assigned/en-route/arrival/transporting/completion/cancellation timestamps
- ETA minutes

It does not select:

- patient ID
- patient name
- callback phone
- pickup address
- destination address
- pickup coordinates
- destination coordinates

Related operational evidence comes from:

- `CrewAssignment`
- `TransportRouteRevision`
- `TransportIncident`
- `TransportOperationalEscalation`
- `Provider` display name

## SLA drill-down

Each request contains three SLA measurements.

### Assignment SLA

`requestedAt -> assignedAt`

States:

- `COMPLIANT`
- `BREACHED`
- `PENDING`
- `NOT_APPLICABLE`

An unassigned request becomes `BREACHED` only after the configured assignment threshold.

Cancelled requests that were never assigned are `NOT_APPLICABLE`.

### Resource-readiness SLA

`assignedAt -> first CrewAssignment with transport unit + at least one crew provider`

If no complete resource assignment exists:

- inside threshold -> `PENDING`
- outside threshold -> `BREACHED`

Unassigned and cancelled requests are `NOT_APPLICABLE`.

### Departure SLA

`scheduledFor -> enRouteAt`

If no departure exists:

- before scheduled time -> `PENDING`
- inside departure grace -> `PENDING`
- outside departure grace -> `BREACHED`

Cancelled-before-departure requests are `NOT_APPLICABLE`.

### Overall SLA

A request is:

- `NOT_APPLICABLE` if none of the three SLA dimensions is applicable
- otherwise `BREACHED` if any measured SLA is breached
- otherwise `PENDING` if any SLA is pending
- otherwise `COMPLIANT`

Cancelled/non-measurable requests therefore do not inflate the compliant count.

The Admin SLA filter exposes Breached / Compliant / Pending. `NOT_APPLICABLE` remains visible under All.

## Command-center summary

For the filtered request set:

- matching requests
- active
- completed
- cancelled
- SLA breached
- SLA pending
- SLA compliant
- SLA not applicable
- requests with critical incidents
- requests with active open/acknowledged escalations
- distinct assigned providers

## Management CSV

The management report contains only these operational columns:

- requestId
- mode
- status
- providerId
- providerName
- requestedAt
- scheduledFor
- assignedAt
- enRouteAt
- completedAt
- overallSlaState
- assignmentSlaState
- assignmentMinutes
- resourceReadinessSlaState
- resourceReadinessMinutes
- departureSlaState
- departureDelayMinutes
- etaEvidence
- warningIncidents
- criticalIncidents
- escalations
- openEscalations

It excludes patient and location fields.

The Admin CSV renderer:

- emits UTF-8 BOM for spreadsheet compatibility
- quotes commas/quotes/newlines
- prefixes values beginning with `=`, `+`, `-` or `@` with an apostrophe to reduce spreadsheet formula-injection risk

## Privacy boundary

Both command-center and management-report responses include:

- `patientIdentityIncluded: false`
- `patientContactIncluded: false`
- `pickupAddressIncluded: false`
- `destinationAddressIncluded: false`
- `coordinatesIncluded: false`

The report is intended for:

`TRANSPORT_OPERATIONS`

## Query forwarding

The Admin transport proxy forwards only a fixed allow-list of query parameters.

Phase 11:

- `windowDays`
- `forecastDays`

Phase 12 command center:

- `windowDays`
- `mode`
- `providerId`
- `sla`
- `page`
- `limit`

Phase 12 management report:

- `windowDays`
- `mode`
- `providerId`
- `sla`

Invalid query values fail closed with HTTP 400 at the Admin proxy or API validation layer.

## Source limits

To prevent unbounded Admin analytics queries:

- source Medical Transport requests are capped at 5,000 + 1 sentinel row
- displayed/exported rows are based on the first 5,000 source rows
- the API returns `truncatedSource: true` when more rows existed
- the UI instructs the operator to narrow filters when truncation occurs
- related assignment/route/incident/escalation reads are bounded

This cap is visible rather than silently implying completeness.

## Pagination

Command-center pagination occurs after SLA-state computation.

Defaults:

- page 1
- 100 rows/page

Bounds:

- 25–250 rows/page
- page 1–1000

Management report uses the same source filters but exports all filtered rows inside the bounded 5,000-row source set.

## Audit evidence

Interactive read:

`ADMIN_TRANSPORT_COMMAND_CENTER_READ`

Export:

`ADMIN_TRANSPORT_MANAGEMENT_REPORT_EXPORTED`

Audit metadata includes:

- history window
- mode
- SLA filter
- whether provider filter was applied
- result count
- export row/column counts
- truncation flag
- explicit patient-identity/location exclusion

No patient identity or location is added to Phase 12 audit metadata.

## Admin UI

New component:

`TransportCommandCenterPanel`

It is rendered on the existing Transport Providers page before Phase 11 Performance Analytics.

Controls:

- 30 / 60 / 90 / 180 / 365 days
- All / Ground / Air
- All / Breached / Compliant / Pending SLA
- Provider
- Previous / Next pagination
- Refresh
- Export management CSV

The table shows:

- short operational request ID
- mode
- provider
- lifecycle status
- scheduled date/time
- assignment SLA
- resource-readiness SLA
- departure SLA
- ETA evidence
- incident counts
- escalation counts

## Persistence

Phase 12 adds:

- no Prisma model
- no migration
- no new table

It uses the existing Transport domain as the single source of truth.

## Environment

No new environment variables are required.

No `.env` file is added or modified.

Phase 12 reuses:

- `TRANSPORT_ASSIGNMENT_SLA_MINUTES`
- `TRANSPORT_RESOURCE_READY_SLA_MINUTES`
- `TRANSPORT_DEPARTURE_GRACE_MINUTES`

## Validation

The API test chain includes:

`npm run v2:transport-phase12`

The contract verifies:

- module registration
- `TRANSPORT_OPERATE` authorization
- bounded filters and pagination
- no Phase 12 persistence/migration
- patient/location field exclusion
- assignment/resource/departure SLA semantics
- overall SLA filter
- source truncation
- sanitized management report columns
- client-side CSV formula-injection mitigation
- audit actions
- query allow-list
- read-only/no lifecycle mutation
- Admin wiring
- no committed `.env`
