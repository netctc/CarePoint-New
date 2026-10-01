# Transport Phase 28 — End-to-End Acceptance Matrix

Branch: `quality/transport-e2e-acceptance-phase28-20261001`

## Objective

Phase 28 adds a cross-phase acceptance matrix for the Transport domain.

The purpose is to prevent a release where every individual phase smoke is green but the complete
patient-to-governance journey has silently lost an endpoint, authorization boundary, state
transition, audit event, privacy control, or worker dependency.

This is an integration contract over real source code. It complements — and does not replace —
database migration validation, the full GitHub Actions matrix, live deployment evidence, or UAT.

## Ordered journey

The contract covers twelve ordered scenarios:

1. Patient creates a scheduled medical-transport request.
2. Patient reuses saved locations and requests route preview.
3. Operations assigns an eligible transport provider.
4. Provider confirms resources and advances the authoritative lifecycle.
5. Provider location sharing produces telemetry and non-authoritative milestones.
6. Operations uses smart dispatch, escalation and live provider attention.
7. Management consumes performance analytics and command-center reporting.
8. Admin schedules reports and the application-context worker executes durable report runs.
9. Private report artifacts are prepared for durable notification delivery.
10. Admin retrieves a report only through a short-lived one-time same-origin POST grant.
11. Retention, legal hold, integrity quarantine and governance evidence remain connected.
12. Admin exports a deterministic compliance manifest with SHA-256 evidence and external signing
    explicitly required.

## Authorization boundaries

The acceptance matrix enforces the existing role/permission split:

- Patient: `PATIENT_TRANSPORT_REQUEST`
- Transport Provider: `TRANSPORT_RESPOND`
- Admin / internal admin-system transport workflow: `TRANSPORT_OPERATE`

Every scenario must retain explicit `@RequirePermissions(...)` evidence in at least one owning
source module.

## Lifecycle invariants

The authoritative provider lifecycle remains ordered:

`ASSIGNED → EN_ROUTE → ARRIVED → TRANSPORTING → COMPLETED`

Automated telemetry/geofence milestones remain advisory:

`automaticLifecycleMutation: false`

Therefore telemetry cannot silently advance the clinical/operational transport state machine.

## Privacy and secure artifact invariants

Phase 28 verifies that:

- raw latitude/longitude values are excluded from telemetry audit metadata;
- report artifacts do not expose public or signed URLs;
- one-time download tokens are not persisted in plaintext;
- governance/compliance exports omit:
  - raw audit metadata;
  - object-storage keys;
  - CSV content;
  - patient identity;
  - patient contact data;
  - patient location.

## Worker ordering

The Cloud Run application-context worker must keep the following ordering:

1. report execution;
2. report-ready notification delivery;
3. artifact integrity verification;
4. retention purge.

Integrity verification therefore occurs before purge.

## Acceptance boundary

The Phase 28 contract deliberately keeps:

- `productionAcceptance: false`
- `fullMatrixStillRequired: true`
- `liveUatEvidenceStillRequired: true`

A green Phase 28 smoke does not authorize production or a direct merge to `main`.

## Files

- `ops/transport/transport-e2e-acceptance-phase28.json`
- `services/api/scripts/v2-transport-phase28-smoke.mjs`
- `docs/transport-e2e-acceptance-phase28.md`

## Validation

Run:

`npm run v2:transport-phase28`

The full API test chain also includes this smoke after Phase 27.

## Database

No new database migration.

## Environment

No new environment variables.

No `.env` file is added.
