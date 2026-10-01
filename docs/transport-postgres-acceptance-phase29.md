# Transport Phase 29 — PostgreSQL Transactional Transport Acceptance

Branch: quality/transport-postgres-acceptance-phase29-20261001

## Objective

Phase 29 adds real PostgreSQL acceptance for the scheduled medical-transport state machine.
Phase 28 verifies the complete source-level journey. Phase 29 complements it by exercising the actual MedicalTransportService against the migrated PostgreSQL schema and checking real transactional behavior.

## Runtime-neutral service export

MedicalTransportService is exported as a TypeScript symbol so the acceptance harness can invoke the same service implementation used by the Nest controllers.
The Nest provider registration, routes, guards and runtime dependency injection remain unchanged.

## Serializable concurrency

Scheduled transport writes already use PostgreSQL SERIALIZABLE transactions.
Phase 29 normalizes Prisma P2034 serialization conflicts into HTTP-domain 409 Conflict exceptions for assignment and lifecycle races.
Concurrent idempotent request creation also treats P2034 as a replay race and resolves the canonical patientId + clientRequestId request when it exists.

## PostgreSQL acceptance scenarios

1. Patient request persistence is idempotent on patientId + clientRequestId.
2. A different patient cannot read the request.
3. Missing pickup location is rejected without persisting a row.
4. Two providers racing one dispatch produce exactly one assignment and one ASSIGNED event.
5. The losing concurrent assignment receives 409 Conflict.
6. An unassigned provider cannot mutate another provider job.
7. Lifecycle jumps such as ASSIGNED → ARRIVED are rejected.
8. Persisted lifecycle is REQUESTED → ASSIGNED → EN_ROUTE → ARRIVED → TRANSPORTING → COMPLETED.
9. Lifecycle timestamp columns are persisted.
10. Patient cancellation is persistence-idempotent and creates one CANCELLED event.
11. Patient cancellation after EN_ROUTE is rejected.
12. A ground transport provider cannot be assigned to an AIR request.
13. Domain audit/notification intents remain emitted without coordinate fields.

## Fixture isolation

The script creates unique synthetic Patient and Other Provider records using a per-run UUID.
Cleanup targets only IDs created by that run. It does not use TRUNCATE, DROP TABLE, or unbounded deleteMany operations.

## CI ordering

The real PostgreSQL acceptance runs after db:deploy and before shared db:bootstrap, so it sees the actual migrated schema while remaining isolated from shared bootstrap fixtures.

## Safety

The database acceptance requires CAREPOINT_TRANSPORT_POSTGRES_ACCEPTANCE=true and refuses to execute when NODE_ENV=production.
This is a CI/test execution flag only.

No new production environment variables.
No .env file is added.

## Database

Phase 29 adds no Prisma schema model and no migration.

## Validation

Structural: npm run v2:transport-phase29
PostgreSQL: CAREPOINT_TRANSPORT_POSTGRES_ACCEPTANCE=true npm run v2:transport-phase29-postgres
