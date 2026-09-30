# Transport Phase 6 — Dispatch Board + Assignment / ETA Lifecycle

Branch: `feature/transport-dispatch-eta-phase6-20260930`

## Objective

Phase 6 turns the scheduled medical transport queue into an operational dispatch surface without changing the Patient booking contract.

It builds on Phase 5 routing and the existing transport lifecycle, crew/unit revision history and provider readiness rules.

## Admin dispatch board

Admin / Operations users with `TRANSPORT_OPERATE` can use:

- `GET /admin/transport/dispatch-board`
- `POST /admin/transport/dispatch-board/:requestId/recalculate-eta`

The board aggregates:

- active scheduled transport requests
- patient and route summary required for dispatch
- assigned Transport Provider
- latest crew/unit assignment revision
- provider dispatch readiness
- current ETA and ETA health state
- latest route revision
- mode/status information

Assignment states:

- `UNASSIGNED`
- `PROVIDER_ASSIGNED`
- `RESOURCES_PARTIAL`
- `RESOURCES_READY`

ETA states:

- `CURRENT`
- `MISSING`
- `STALE_AFTER_DESTINATION_CHANGE`
- `NOT_APPLICABLE`

The Admin UI uses the existing assignment endpoint through the Admin transport proxy and only presents providers whose account, provider status, provider category, required credentials and compatible active unit are dispatch ready.

## ETA recalculation

Phase 6 reuses `TransportSavedLocationsService.routePreviewForRequest`; it does not introduce a second routing engine.

ETA recalculation:

1. requires an assigned provider
2. is allowed only while the transport is active
3. is idempotent
4. obtains a fresh server-side route estimate
5. locks the Medical Transport Request before persistence
6. rejects persistence if the request changed while the route was being calculated
7. creates an immutable `TransportRouteRevision`
8. updates `MedicalTransportRequest.etaMinutes`
9. writes an audit event
10. notifies the patient through the existing transport notification channel

A destination change from the advanced lifecycle continues to clear the ETA. The dispatch board then reports `STALE_AFTER_DESTINATION_CHANGE` until a new ETA is calculated.

## Transport Provider Mobile

Transport Provider Mobile can use:

- `POST /provider/medical-transport/:requestId/recalculate-eta`

Only the provider assigned to that job can persist the recalculated ETA.

The workspace exposes a **Recalculate ETA** action for active Ground Transport jobs and reports whether the automatic ETA was refreshed or remains unavailable.

## Route provider and fallback

The route provider is optional.

Supported configuration remains:

```
TRANSPORT_ROUTE_PROVIDER=google
GOOGLE_MAPS_SERVER_API_KEY=<server-side key>
```

`GOOGLE_MAPS_API_KEY` remains a compatibility fallback.

No `.env` file is added or modified by Phase 6.

If automatic routing is not configured or temporarily unavailable:

- dispatch remains usable
- provider assignment remains usable
- manual ETA/status workflows remain usable
- no booking is blocked

Air Transport does not use the Ground route estimator and returns a non-blocking `AIR_NOT_SUPPORTED` result.

## Location compatibility

Coordinates remain optional.

Existing requests continue to support:

- address-only pickup and destination
- complete latitude/longitude pairs
- address plus coordinates

Phase 6 does not make coordinates mandatory.

## Security and integrity

- Admin dispatch requires `TRANSPORT_OPERATE`.
- Provider ETA refresh requires `TRANSPORT_RESPOND` and ownership of the assigned job.
- ETA mutations require an idempotency key.
- The request row is locked during persistence.
- The request `updatedAt` value is compared with the version used for route calculation to prevent stale ETA writes.
- Route changes are recorded as immutable route revisions.
- Patient notification uses a dedupe key derived from the transport request and idempotency key.

## Database

No Phase 6 migration is required.

The implementation reuses:

- `MedicalTransportRequest.etaMinutes`
- `TransportRouteRevision`
- `CrewAssignment`
- `TransportUnit`

## Compatibility

Phase 6 does not change:

- Patient booking request shape
- coordinate optionality
- provider assignment contract
- crew/unit revision model
- manual status progression
- destination-change contract

## Validation

The API test chain includes:

`npm run v2:transport-phase6`

The smoke contract validates:

- dispatch board registration
- provider/resource aggregation
- dispatch-readiness filtering
- ETA state handling
- idempotent ETA recalculation
- concurrency protection
- audit and patient notification hooks
- Admin UI wiring
- Transport Provider Mobile wiring
- optional route-provider fallback
