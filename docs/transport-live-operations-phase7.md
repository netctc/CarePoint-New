# Transport Phase 7 — Live Operations & Exception Management

Branch: `feature/transport-live-operations-phase7-20260930`

## Objective

Phase 7 adds an operations-focused exception layer on top of the Phase 6 Dispatch Board.

It does not create a second transport state machine and does not replace the existing sources of truth. Exceptions are derived from current Medical Transport Requests, crew/unit assignment revisions, route revisions, provider readiness and append-only transport incidents.

## Live operations API

Admin and Operations users with `TRANSPORT_OPERATE` can use:

- `GET /admin/transport/live-operations`
- `POST /admin/transport/live-operations/:requestId/notify-provider`

The response contains only active requests with one or more operational exceptions.

## Derived exception types

### Assignment SLA

`ASSIGNMENT_SLA_BREACH`

Raised when a request remains in `REQUESTED` longer than the configured assignment SLA.

### Resource readiness SLA

`RESOURCE_READY_SLA_BREACH`

Raised when a provider has been assigned but the latest crew/unit revision remains incomplete beyond the configured readiness SLA.

### ETA freshness

`ETA_REFRESH_SLA_BREACH`

Raised when an assigned Ground Transport request does not have a current ETA within the configured refresh window.

`ETA_STALE_AFTER_DESTINATION_CHANGE`

Raised when the advanced lifecycle changed the destination, cleared the prior ETA and a fresh route estimate has not been persisted within the configured refresh window.

### Departure SLA

`DEPARTURE_SLA_BREACH`

Raised when a scheduled request remains `REQUESTED` or `ASSIGNED` after the scheduled time plus the configured departure grace.

### Provider readiness

`ASSIGNED_PROVIDER_NOT_READY`

Raised when the currently assigned provider no longer satisfies the dispatch-readiness rules used by Transport Operations:

- active provider account
- active linked user account
- active transport category
- current required credentials
- compatible active transport unit

### Incidents

The existing append-only encrypted Transport Incident model remains authoritative.

Phase 7 surfaces safe operational metadata for recent `WARNING` and `CRITICAL` incidents without decrypting incident detail into the consolidated Admin list:

- `WARNING_TRANSPORT_INCIDENT`
- `CRITICAL_TRANSPORT_INCIDENT`

## SLA configuration

All Phase 7 thresholds are optional environment variables.

Defaults are applied when the variable is missing, invalid or outside 1–1440 minutes.

```
TRANSPORT_ASSIGNMENT_SLA_MINUTES=15
TRANSPORT_RESOURCE_READY_SLA_MINUTES=10
TRANSPORT_ETA_REFRESH_SLA_MINUTES=10
TRANSPORT_DEPARTURE_GRACE_MINUTES=10
```

No `.env` file is added or modified by Phase 7.

## Provider attention

Operations can send an operational-attention notification to the currently assigned Transport Provider.

The notification:

- uses the existing CarePoint notification channel
- is scoped to the assigned provider account
- is deduplicated in a 15-minute time bucket by request and exception code
- writes an audit event `ADMIN_TRANSPORT_PROVIDER_ATTENTION_SENT`

It does not change request status, assignment, ETA or incident state.

## Admin UI

The Transport Providers page now shows **Transport Exception Control** before the Phase 6 Dispatch Board.

It provides:

- exception-request count
- critical and warning request counts
- total active exception count
- configured SLA thresholds
- severity filter
- request-level exception cards
- recommended operational action
- provider attention action when a provider is already assigned

Resolution remains in the authoritative workflows:

- provider assignment in Dispatch Board
- crew/unit assignment in resource workflow
- ETA refresh in Phase 6
- provider/credential/fleet correction in Transport Provider Administration
- incident review in the existing incident lifecycle
- status progression in the provider transport lifecycle

## Tracking boundary

Phase 7 does not implement live GPS tracking.

The API explicitly reports:

- `trackingMode: "ESTIMATED_ROUTE_ONLY"`
- `liveGpsTrackingAvailable: false`

Route ETA remains an estimate produced by the configured route provider. No vehicle telemetry, driver GPS feed or background location stream is claimed or inferred.

## Location compatibility

Coordinates remain optional.

Phase 7 does not alter Patient booking or route-location contracts. Address-only Ground Transport requests remain valid.

## Database

No Phase 7 database migration is required.

The implementation reuses:

- `MedicalTransportRequest`
- `CrewAssignment`
- `TransportUnit`
- `TransportRouteRevision`
- `TransportIncident`
- existing provider credential/readiness data
- existing notification outbox and audit infrastructure

## Security and privacy

- Live operations requires `TRANSPORT_OPERATE`.
- The consolidated incident view reads only incident category, severity, reason code and occurrence time.
- Encrypted incident detail is not decrypted into the exception board.
- Provider notifications are sent only to the provider currently assigned to the request.
- The operation is audited.
- The panel does not expose or infer live patient or vehicle location.

## Validation

The API test chain includes:

`npm run v2:transport-phase7`

The smoke contract verifies:

- module registration
- SLA exception derivation
- ETA-stale handling
- provider-readiness checking
- incident integration
- optional bounded SLA configuration
- provider-attention notification and audit
- Admin UI wiring
- no live-GPS claim
- no Phase 7 migration
- no committed environment file
