# Transport Phase 9 — Real-Time Tracking Delivery & Automated Trip Milestones

Branch: `feature/transport-realtime-milestones-phase9-20260930`

## Objective

Phase 9 builds on Phase 8 telemetry with two capabilities:

1. **Request-scoped real-time delivery** using CarePoint's existing authenticated SSE infrastructure.
2. **Automated trip milestone detection** derived from accurate foreground telemetry.

The authoritative Medical Transport lifecycle remains unchanged. Telemetry can detect an operational milestone, but it never changes `MedicalTransportRequest.status` automatically.

## Persistence

Phase 9 adds one migration:

`20260930195000_v2_transport_trip_milestones`

New model:

- `TransportTripMilestone`

A milestone records:

- Medical Transport request
- assigned provider and transport unit
- milestone code
- detection source
- lifecycle status at detection time
- optional distance in meters
- telemetry capture timestamp
- occurrence timestamp

Precise latitude/longitude are intentionally not copied into milestone records.

Each milestone code is unique per transport request to prevent noisy duplicate events.

## Milestone codes

Phase 9 supports:

- `TRACKING_STARTED`
- `FIRST_POSITION_RECEIVED`
- `NEAR_PICKUP`
- `PICKUP_ARRIVAL_DETECTED`
- `NEAR_DESTINATION`
- `DESTINATION_ARRIVAL_DETECTED`
- `TRACKING_STOPPED`

### Lifecycle boundary

Milestones use:

`authority: AUTOMATED_DETECTION`

Lifecycle events use:

`authority: AUTHORITATIVE_LIFECYCLE`

The combined timeline response always includes:

`automaticLifecycleMutation: false`

Examples:

- `PICKUP_ARRIVAL_DETECTED` can suggest that the provider reviews/advances the job to ARRIVED.
- It does **not** perform that transition.
- `DESTINATION_ARRIVAL_DETECTED` can suggest destination arrival/handoff review.
- It does **not** complete the transport.

Provider actions remain authoritative.

## Geofence detection

Detection runs only on accepted Phase 8 foreground heartbeats.

A geofence is evaluated only when:

- tracking session is active
- the authenticated provider is still assigned
- the assigned active transport unit still matches
- telemetry accuracy is present and inside the configured maximum
- the relevant pickup/destination coordinates exist
- the request lifecycle is appropriate for that detection

Address-only bookings remain valid. When coordinates are absent, geofence detection is skipped rather than inferred.

Default behavior:

- EN_ROUTE / ARRIVED can detect pickup proximity
- TRANSPORTING can detect destination proximity

Distance uses the Haversine formula server-side.

## Optional geofence environment variables

No `.env` file is added or modified.

Optional variables:

```
TRANSPORT_GEOFENCE_MAX_ACCURACY_METERS=100
TRANSPORT_GEOFENCE_NEAR_PICKUP_METERS=500
TRANSPORT_GEOFENCE_PICKUP_ARRIVAL_METERS=120
TRANSPORT_GEOFENCE_NEAR_DESTINATION_METERS=750
TRANSPORT_GEOFENCE_DESTINATION_ARRIVAL_METERS=150
```

Invalid/out-of-range values fall back to safe defaults.

Phase 8 telemetry variables remain unchanged.

## Timeline API

Patient:

`GET /medical-transport/:requestId/timeline`

Requires Patient ownership and `PATIENT_TRANSPORT_REQUEST`.

Provider:

`GET /provider/medical-transport/:requestId/timeline`

Requires an active assigned Provider and `TRANSPORT_RESPOND`.

Admin:

`GET /admin/transport/:requestId/timeline`

Requires `TRANSPORT_OPERATE`.

The timeline combines:

- immutable `MedicalTransportEvent` lifecycle history
- immutable `TransportTripMilestone` detection history

Coordinates are not returned by the milestone timeline.

## Real-time delivery

Phase 9 extends the existing CarePoint SSE endpoint:

`GET /realtime/stream`

New request-scoped topics:

- `TRANSPORT_TRACKING`
- `TRANSPORT_MILESTONES`
- `TRANSPORT_LIFECYCLE`

Required query:

- `transportRequestId`

Existing realtime properties remain in force:

- authenticated live session
- authorization revalidation
- bounded 10-minute replay window
- 3-second server polling
- subscription audit evidence
- disconnect evidence

### Authorization

For transport topics:

Patient:
- must own the transport request
- must hold `PATIENT_TRANSPORT_REQUEST`

Other Provider:
- must be active
- must be the currently assigned provider
- must hold `TRANSPORT_RESPOND`

Admin:
- must hold `TRANSPORT_OPERATE`

### Structural payload policy

The SSE event contains only structural metadata:

- topic
- event type
- entity type
- entity id
- occurrence time

It does **not** carry latitude, longitude, speed or heading.

On `TELEMETRY_UPDATED`, the client re-fetches the protected latest-tracking endpoint. This preserves Phase 8 patient visibility and expiry rules.

## Patient Mobile

Medical Transport details now:

- subscribe to transport tracking SSE
- subscribe to milestone SSE
- subscribe to lifecycle SSE
- refresh the protected current state immediately when an event arrives
- retain a 15-second fallback refresh if realtime is disabled or unavailable
- retrieve the combined Phase 9 trip timeline
- visually distinguish automated detections from authoritative statuses
- explicitly state that detected milestones do not change transport status

Realtime failures do not make the Medical Transport detail unusable.

## Transport Provider Mobile

The Vehicle Tracking dialog now retrieves the provider timeline and displays the latest detected milestone.

The UI explicitly instructs the provider to confirm operational status manually before advancing the job.

Foreground telemetry behavior remains unchanged from Phase 8.

## Admin

The Fleet Telemetry panel now includes the latest detected trip milestone for each active sharing session.

Admin refresh fallback is reduced to 10 seconds.

Milestones are labeled as advisory; they never mutate lifecycle status automatically.

## Patient notifications

First-position and tracking lifecycle metadata do not generate additional noisy patient messages.

Significant proximity milestones can enqueue the existing safe Transport Update notification template once per milestone.

No coordinate values are placed into notification payloads.

## Privacy and audit

Milestone audit metadata includes:

- milestone code
- source
- lifecycle status at detection time
- distance in meters when available
- explicit `coordinateValuesExcludedFromAudit: true`
- explicit `automaticLifecycleMutation: false`

It never includes latitude or longitude.

SSE transport events are structural only.

## Phase 8 boundaries preserved

Phase 9 does not add background location.

Phase 9 does not claim always-on GPS.

Phase 9 does not make booking coordinates mandatory.

Phase 9 does not treat route ETA as vehicle position.

Phase 9 does not let geofences autonomously transition the Medical Transport lifecycle.

## Validation

The API test chain includes:

`npm run v2:transport-phase9`

The contract verifies:

- Prisma milestone persistence and migration
- milestone idempotency
- accuracy gating
- optional-coordinate behavior
- no automatic lifecycle mutation
- patient/provider/admin timeline authorization
- combined authoritative + detected timeline
- request-scoped SSE authorization
- structural SSE payloads without coordinates
- Patient Mobile realtime subscriptions and fallback refresh
- Provider Mobile milestone advisory
- Admin latest-milestone surface
- no new `.env` file
