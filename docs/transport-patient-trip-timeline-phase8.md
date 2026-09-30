# Transport Phase 8 — Patient Trip Timeline & Milestone Tracking

## Objective

Phase 8 improves the Patient experience for scheduled medical transport by exposing a consolidated trip timeline built from existing authoritative Transport data.

Phase 8 does **not** introduce live vehicle GPS tracking and does not create a second transport state machine.

## Patient tracking model

The existing Patient transport detail response now includes:

```text
tripTracking.trackingMode = MILESTONE_ONLY
tripTracking.liveGpsTrackingAvailable = false
```

The tracking read model combines:

- `MedicalTransportEvent` lifecycle milestones;
- immutable `TransportRouteRevision` events;
- current ETA from `MedicalTransportRequest`;
- current assigned Transport Provider from the existing request presentation layer.

No new transport status is introduced.

## Lifecycle milestones

The Patient progress view uses the existing lifecycle:

1. `REQUESTED`
2. `ASSIGNED`
3. `EN_ROUTE`
4. `ARRIVED`
5. `TRANSPORTING`
6. `COMPLETED`

`CANCELLED` remains a terminal state outside the normal forward-progress path.

## Consolidated timeline

Status events are normalized as:

```json
{
  "kind": "STATUS",
  "status": "EN_ROUTE",
  "fromStatus": "ASSIGNED",
  "etaMinutes": 18,
  "occurredAt": "..."
}
```

Route / ETA revisions are normalized as:

```json
{
  "kind": "ROUTE_UPDATED",
  "status": "EN_ROUTE",
  "revision": 2,
  "etaMinutes": 21,
  "reasonCode": "TRAFFIC",
  "source": "DISPATCH",
  "occurredAt": "..."
}
```

The Patient UI presents route revisions as a generic **Route / ETA updated** milestone. Internal reason codes remain structured in the API response but are not displayed as untranslated technical labels.

## Patient Mobile

The existing medical transport detail screen now shows:

- current transport status;
- milestone progress chips;
- current Transport Provider when assigned;
- current ETA when available;
- pickup and destination;
- assistance / equipment summary;
- consolidated trip timeline;
- route / ETA update milestones;
- existing cancellation action while cancellation is still allowed.

The screen explicitly states that tracking is based on milestones and ETA rather than live vehicle GPS.

## Notifications

Phase 8 does not introduce a duplicate notification system.

Existing Transport lifecycle behavior remains authoritative:

- assignment notifications;
- provider status progression notifications;
- ETA refresh notifications;
- existing notification deduplication rules.

The Phase 8 timeline is a read model over the same lifecycle sources.

## Security and privacy

- Patient detail access remains scoped to the authenticated Patient profile.
- The timeline does not expose another Patient's request.
- Route timeline items do not expose pickup/destination coordinates.
- The timeline does not expose vehicle telemetry.
- The timeline does not infer or claim live vehicle position.
- Provider internal operational data is not added beyond the provider identity already exposed by the existing Patient request view.

## GPS and location compatibility

Phase 8 does not change Transport location contracts.

Latitude and longitude remain optional.

Phase 8 does not add:

- background location permissions;
- continuous GPS collection;
- driver tracking;
- vehicle tracking;
- WebSocket location streaming;
- a new map SDK.

## Database

No Phase 8 database migration is required.

Phase 8 reuses:

- `MedicalTransportRequest`;
- `MedicalTransportEvent`;
- `TransportRouteRevision`;
- existing Provider data;
- existing notification infrastructure.

## Validation

The API test chain includes:

```text
npm run v2:transport-phase8
```

The Phase 8 contract verifies:

- Patient envelope timeline construction;
- milestone-only tracking declaration;
- live GPS explicitly disabled;
- existing status events as timeline source;
- route revisions as timeline source;
- route timeline privacy boundary;
- Patient Mobile progress/timeline wiring;
- no new Phase 8 Prisma migration;
- no committed environment file.
