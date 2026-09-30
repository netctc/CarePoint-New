# Transport Phase 8 — Fleet Telemetry & Patient Tracking Foundation

Branch: `feature/transport-fleet-telemetry-phase8-20260930`

## Objective

Phase 8 adds an explicitly opt-in, time-bounded vehicle telemetry foundation for active Medical Transport jobs.

It keeps three concepts separate:

1. **Medical Transport lifecycle** — authoritative request status and assignment.
2. **Route ETA** — the existing Phase 5/6 route estimate.
3. **Vehicle telemetry** — provider-device foreground location samples.

A telemetry position is never treated as a route ETA and a route ETA is never presented as a vehicle position.

## Persistence

Phase 8 adds one migration:

`20260930173000_v2_transport_telemetry`

New models:

- `TransportTrackingSession`
- `TransportUnitTelemetry`

### Tracking session

A session is unique per Medical Transport request and records:

- assigned provider
- assigned transport unit
- explicit patient-sharing state
- start/stop timestamps
- last heartbeat time
- expiry time
- stop reason

The session is operational metadata. Exact coordinates are not stored on the Medical Transport request.

### Telemetry sample

Each sample contains:

- provider and transport unit
- request and tracking session
- client event id
- latitude / longitude
- optional accuracy, heading and speed
- capture and receive timestamps
- source
- retention expiry

The server opportunistically purges expired telemetry records.

## Provider API

Requires `TRANSPORT_RESPOND` and the authenticated account must own the assigned Medical Transport request.

- `GET /provider/medical-transport/:requestId/tracking`
- `POST /provider/medical-transport/:requestId/tracking/start`
- `POST /provider/medical-transport/:requestId/tracking/heartbeat`
- `POST /provider/medical-transport/:requestId/tracking/stop`

Tracking can start only when:

- the request is assigned to the authenticated transport provider
- the request status is `EN_ROUTE`, `ARRIVED` or `TRANSPORTING`
- the latest crew assignment has an active compatible Transport Unit
- `shareWithPatient` is explicitly `true`

A heartbeat is rejected when the session is stopped/expired, the unit changed or the request is no longer in a tracking-active lifecycle state.

## Patient API

Requires the existing patient transport permission and ownership of the request.

`GET /medical-transport/:requestId/tracking`

The Patient receives only the current allowed state and latest non-expired sample.

The endpoint never returns telemetry history.

Coordinates are hidden when:

- the transport is not active
- sharing was never started
- sharing was stopped
- the session expired
- the provider has not produced a heartbeat yet

The response explicitly includes:

- `trackingMode: PROVIDER_DEVICE_FOREGROUND`
- `trackingPositionIsRouteEta: false`
- `routeEtaMinutes` separately

## Admin fleet telemetry

Requires `TRANSPORT_OPERATE`.

`GET /admin/transport/telemetry`

The Admin Transport page includes a **Transport Fleet Telemetry** panel showing:

- active sharing sessions
- fresh / stale / no-heartbeat counts
- provider and unit
- lifecycle status
- heartbeat age
- latest vehicle coordinates
- optional accuracy / speed
- route ETA as a separate field

## Mobile behavior

### Transport Provider Mobile

Phase 8 adds `geolocator 14.0.2` to Transport Provider Mobile.

Location sharing is explicit:

1. Open Vehicle Tracking on an active assigned job.
2. Start location sharing.
3. The app sends an immediate position.
4. While the workspace remains active in the foreground, a heartbeat is sent every 30 seconds.
5. The provider can send a position manually at any time.
6. The provider can explicitly stop sharing.
7. Completing the job performs a best-effort stop.
8. Signing out performs a best-effort stop.

No background location service is implemented or claimed.

If the process is suspended or terminated, heartbeats stop. Server-side freshness, lifecycle gates and session expiry prevent this from being represented as continuously live tracking.

### Patient Mobile

The Medical Transport detail page retrieves the tracking state separately from the request.

For active transport it can show:

- location sharing status
- fresh/stale status
- latest vehicle coordinates
- last location timestamp
- an explicit notice that vehicle position and route ETA are separate signals

The transport detail remains usable when telemetry is unavailable.

## Native permission boundary

The Native Compatibility workflow now validates Transport Provider Mobile on both Android and iOS.

For Transport Provider Mobile only:

Android validation runner adds:

- `ACCESS_COARSE_LOCATION`
- `ACCESS_FINE_LOCATION`

It explicitly verifies that `ACCESS_BACKGROUND_LOCATION` is absent.

iOS validation runner adds:

- `NSLocationWhenInUseUsageDescription`

It explicitly verifies that `NSLocationAlways*` keys are absent.

This matches the Phase 8 foreground-only tracking contract.

## Privacy and audit

Audit records for telemetry operations deliberately exclude latitude and longitude.

Audit metadata records operational facts such as:

- provider
- transport unit
- capture time
- accuracy
- telemetry source
- freshness

Coordinate values remain in the short-lived telemetry record only.

Patient access is request-owner scoped.

Admin access requires Transport Operations permission.

## Retention and freshness configuration

Optional environment variables:

```
TRANSPORT_TRACKING_SESSION_TTL_MINUTES=480
TRANSPORT_TELEMETRY_RETENTION_HOURS=24
TRANSPORT_TELEMETRY_FRESH_SECONDS=90
TRANSPORT_TELEMETRY_MAX_CAPTURE_AGE_MINUTES=10
```

Defaults are applied when values are absent or outside their accepted bounds.

No `.env` file is added or modified by Phase 8.

## Location compatibility

Booking coordinates remain optional.

Phase 8 does not change the Patient booking contract. Address-only bookings remain valid.

Telemetry is a separate provider-side operational capability and begins only after assignment, resource selection and active transport progression.

## Validation

The API test chain includes:

`npm run v2:transport-phase8`

The contract verifies:

- Prisma persistence and migration
- explicit sharing opt-in
- provider ownership
- active lifecycle gating
- assigned-unit binding
- client-event idempotency
- short-lived telemetry retention
- patient latest-only access
- no coordinate values in audit metadata
- ETA/position separation
- Admin fleet view
- Provider Mobile foreground heartbeat support
- Patient Mobile tracking UI
- Android/iOS foreground-only permission validation
- no background-location claim
- no committed `.env`
