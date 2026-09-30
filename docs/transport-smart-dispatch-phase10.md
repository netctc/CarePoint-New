# Transport Phase 10 — Smart Dispatch Automation & Operational Escalation

Branch: `feature/transport-smart-dispatch-phase10-20260930`

## Objective

Phase 10 builds on the Phase 6–9 transport stack to help Transport Operations answer three questions quickly:

1. Which active Medical Transport requests require attention first?
2. Which dispatch-ready provider is the strongest current candidate for an unassigned request?
3. Which warning/critical conditions need a persistent operational escalation?

The engine is deterministic and advisory.

It does **not**:

- auto-assign a provider
- mutate `MedicalTransportRequest.status`
- complete a transport
- infer provider proximity from unavailable location data
- use hidden ML/AI scoring
- add background GPS tracking

## Persistence

Phase 10 adds one migration:

`20260930204500_v2_transport_smart_dispatch`

New model:

- `TransportOperationalEscalation`

Fields include:

- transport request
- escalation code
- severity
- status: `OPEN`, `ACKNOWLEDGED`, `RESOLVED`
- recommended action
- first/last trigger timestamps
- occurrence count
- acknowledgement evidence
- resolution evidence
- auto-resolution flag
- optional bounded resolution note

The unique key is:

`transportRequestId + code`

This prevents duplicate open records for the same operational condition.

## Smart-dispatch signals

Phase 10 evaluates the following conditions:

### Dispatch / SLA

- `ASSIGNMENT_OVERDUE`
- `RESOURCE_NOT_READY`
- `ETA_ATTENTION`
- `ETA_STALE_AFTER_DESTINATION_CHANGE`
- `DEPARTURE_OVERDUE`
- `PROVIDER_READINESS_RISK`

### Incident review

- `CRITICAL_INCIDENT_REVIEW`
- `WARNING_INCIDENT_REVIEW`

### Phase 8 telemetry

Only when an explicit Phase 8 tracking session is already active:

- `TELEMETRY_HEARTBEAT_MISSING`
- `TELEMETRY_STALE`

Telemetry must belong to the current tracking session and must not predate that session's `startedAt`. Retained telemetry from an older session is ignored.

Phase 10 does not treat a provider who never opted into Phase 8 tracking as automatically non-compliant.

### Phase 9 milestones

- `PICKUP_CONFIRMATION_PENDING`
- `DESTINATION_CONFIRMATION_PENDING`

These are generated only when an automated Phase 9 arrival detection exists but the authoritative lifecycle still has not advanced after the configured confirmation window.

## Priority score

Each active request receives:

- `priorityScore`
- `priorityBand`: `CRITICAL`, `HIGH`, `MEDIUM`, `NORMAL`
- schedule urgency
- top recommended action
- current signals

The score is deterministic and based on:

- warning/critical signal severity
- schedule urgency
- whether the request is still unassigned

The score is an operations ordering aid, not an autonomous decision.

## Provider recommendation

For an unassigned `REQUESTED` Medical Transport request, Phase 10 can return up to five dispatch-ready candidates.

A candidate must:

- match Ground/Air mode
- belong to an active Medical Transport category
- have an active user/provider account
- satisfy required current credentials
- have at least one active compatible transport unit

Candidate ordering uses only:

- mode match
- dispatch readiness
- active compatible unit capacity
- current active job load

Phase 10 explicitly returns:

`providerRecommendationUsesLiveLocation: false`

No provider GPS/proximity signal is used.

The Admin button **Assign recommended provider** calls the existing Phase 6 assignment endpoint and requires an explicit operator click.

For assigned requests, **Notify provider** reuses the existing Phase 7 operational-attention endpoint. Notification remains an explicit Admin action and keeps the existing 15-minute deduplication behavior.

The response also states:

`autoAssignmentPerformed: false`

## Escalation lifecycle

### Automatic evaluation

Admin Transport Providers includes a Phase 10 panel.

While that panel is mounted, it calls:

`POST /admin/transport/smart-dispatch/evaluate`

at the configured interval.

The evaluation:

- opens newly detected warning/critical escalations
- updates currently active escalations
- reopens a previously resolved escalation if the underlying condition returns/persists at a later evaluation
- auto-resolves an open/acknowledged escalation when the condition is no longer detected

This is console-driven automation. It is not a hidden background worker and does not run when the Admin panel is not active unless an external scheduler explicitly invokes the evaluation endpoint.

### Acknowledge

`POST /admin/transport/smart-dispatch/:requestId/escalations/:code/acknowledge`

Records the responsible Admin account and timestamp.

### Resolve

`POST /admin/transport/smart-dispatch/:requestId/escalations/:code/resolve`

Accepts an optional note up to 500 characters.

A resolved escalation can reopen on a later evaluation if the underlying condition still exists.

Resolution never changes the Medical Transport lifecycle.

## Read-only snapshot

`GET /admin/transport/smart-dispatch`

Returns the current deterministic snapshot and persisted escalation state without opening/reopening/auto-resolving records.

This endpoint is used after ACK/Resolve so the UI can show the operator action before the next scheduled evaluation cycle.

## Authorization

All Phase 10 Admin endpoints require:

`TRANSPORT_OPERATE`

No new RBAC permission is introduced.

## Admin UI

The new `TransportSmartDispatchPanel` is displayed before Fleet Telemetry, Live Operations and Dispatch Board on the Transport Providers page.

It includes:

- active request count
- Critical/High counts
- unassigned count
- open escalation count
- priority filtering
- configurable evaluation cadence display
- candidate recommendation
- explicit Assign recommended provider action
- ACK
- Resolve
- signal details and recommended action
- explicit statements that:
  - auto assignment is disabled
  - automatic lifecycle mutation is disabled
  - provider live-location ranking is disabled

## Optional environment variables

No `.env` file is added or modified.

Phase 10 optional variables:

```
TRANSPORT_SMART_DISPATCH_EVALUATION_SECONDS=60
TRANSPORT_SMART_TELEMETRY_STALE_SECONDS=180
TRANSPORT_SMART_TELEMETRY_CRITICAL_SECONDS=600
TRANSPORT_SMART_MILESTONE_CONFIRMATION_MINUTES=3
TRANSPORT_SMART_MILESTONE_CRITICAL_MINUTES=10
```

Phase 10 also reuses the existing Phase 7 SLA variables:

```
TRANSPORT_ASSIGNMENT_SLA_MINUTES=15
TRANSPORT_RESOURCE_READY_SLA_MINUTES=10
TRANSPORT_ETA_REFRESH_SLA_MINUTES=10
TRANSPORT_DEPARTURE_GRACE_MINUTES=10
```

All values are bounded server-side and invalid values fall back to defaults.

Critical thresholds are enforced to be greater than or equal to their corresponding warning/confirmation threshold.

## Audit

Phase 10 adds audit evidence for:

- `ADMIN_TRANSPORT_SMART_DISPATCH_READ`
- `ADMIN_TRANSPORT_SMART_DISPATCH_EVALUATED`
- `ADMIN_TRANSPORT_ESCALATION_ACKNOWLEDGED`
- `ADMIN_TRANSPORT_ESCALATION_RESOLVED`

Evaluation audit metadata records:

- number of evaluated requests
- number of detected escalations
- opened/reopened/updated/auto-resolved counts
- `autoAssignmentPerformed: false`
- `automaticLifecycleMutation: false`

No patient coordinates are copied into the escalation model or Phase 10 audit metadata.

## Boundaries preserved from Phase 8 and Phase 9

Phase 10 does not:

- make booking coordinates mandatory
- turn route ETA into GPS
- introduce background location
- expose new patient location data
- auto-confirm Phase 9 milestones
- auto-advance status
- auto-assign a provider

## Validation

The API test chain includes:

`npm run v2:transport-phase10`

The contract verifies:

- persistence and migration
- deterministic signals
- escalation ACK/resolve/reopen/auto-resolve behavior
- provider recommendation constraints
- no live-location ranking
- no automatic provider assignment
- no automatic lifecycle mutation
- Phase 8 telemetry integration
- Phase 9 milestone integration
- Admin panel wiring
- explicit human assignment action
- bounded optional environment configuration
- no committed `.env` file
