# Transport Phase 27 — Integration Closure Contract + Migration Preflight

Branch: `quality/transport-integration-closure-phase27-20261001`

## Objective

Phase 27 is a closure-quality phase, not a new business feature.

It converts Transport Phases 8–26 into one explicit integration contract so the final merge
cannot silently omit a phase, migration, backend module, Admin surface, smoke test, or test-chain
registration.

## Contract

`ops/transport/transport-phases8-26-integration-contract.json`

The contract declares every phase from 8 through 26 and maps each one to:

- phase documentation
- phase smoke script
- additive Prisma migration(s), when required
- backend module(s)
- Admin panel(s), when applicable

The phase sequence must be continuous:

`8, 9, 10, ... 26`

No duplicate phase is permitted.

## Migration preflight

The Phase 27 smoke validates that every declared migration:

- has a unique migration directory
- starts with a 14-digit timestamp
- appears in chronological phase order
- contains `migration.sql`

Phase 27 introduces no new database migration.

## Backend registration

The closure contract verifies that declared Transport modules exist in source.

Critical top-level modules must also remain registered in `AppModule`, including:

- telemetry
- smart dispatch
- performance analytics
- command center
- executive KPI
- report execution
- secure download
- retention/legal hold
- governance/compliance evidence
- artifact integrity/quarantine

Nested modules remain validated at their owning boundary rather than being registered twice at
application root. In particular, `TransportTripMilestonesModule` must remain imported by
`TransportTelemetryModule`, and report delivery may remain owned by report execution.

## Admin surface validation

Every Admin panel declared by Phases 8–26 must remain surfaced by:

`apps/admin/app/transport-providers/page.tsx`

This catches regressions where backend functionality survives but its management UI is accidentally
removed during consolidation.

## Smoke and full-test registration

For every phase 8–26 the preflight requires:

- `v2:transport-phase<N>` package script
- the expected `v2-transport-phase<N>-smoke.mjs`
- inclusion of that script in the full API `npm test` chain

Therefore the fast lane does not replace phase tests. It only controls when the large independent
release workflows are repeated.

## Integration state

Current contract deliberately states:

- `productionAcceptance: false`
- `fullMatrixRequiredBeforeMerge: true`
- `mainMergeAllowed: false`
- consolidated validation PR: #497

These values must remain conservative until the full consolidated matrix and final merge-governance
work are complete.

## Speed versus quality

Phase 27 formalizes the project rule:

- independent checks should run in parallel;
- obsolete duplicate workflow runs should be cancelled;
- stacked feature PRs use the fast lane;
- every phase smoke remains mandatory;
- the complete release matrix remains mandatory at canonical integration;
- no failed gate is waived simply to increase velocity.

## Environment

No new environment variables.

No `.env` file is added.

## Database

No database migration is required.

## Validation

`npm run v2:transport-phase27`

The smoke validates:

- continuous Phase 8–26 coverage
- documentation presence
- smoke presence
- package-script registration
- full test-chain registration
- migration uniqueness/order/SQL presence
- Transport module presence
- critical AppModule registration
- Admin panel presence
- conservative integration acceptance state
