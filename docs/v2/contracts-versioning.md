# CarePoint V2 Contract and Event Versioning Rules

## HTTP API
1. Existing `/api/v1` behavior remains backward compatible unless a documented breaking change is intentionally introduced.
2. Additive request fields are optional by default unless a new endpoint/major contract requires them.
3. Additive response fields are permitted; clients must ignore unknown fields.
4. Removing/renaming a field, changing meaning/type, tightening previously valid required input or changing status semantics is breaking.
5. Breaking HTTP changes require a new major API contract plus migration/deprecation plan.
6. Idempotency, authorization scopes and audit behavior are contract surface and cannot change silently.

## Shared DTOs
1. `packages/contracts` is canonical cross-application vocabulary where applicable.
2. Every contract change identifies affected applications and functional IDs.
3. Schema and client changes merge in compatibility-safe order.

## Durable events
Every durable V2 event carries `eventId`, `eventType`, `eventVersion`, `occurredAt`, `aggregateType`, `aggregateId`, `correlationId` when available, and a versioned payload.

Event versions are immutable. Compatible additive evolution may remain within a version only if old consumers remain safe; otherwise increment `eventVersion`.

## Clinical/security invariants
Versioning never weakens ownership checks, provider capability checks, consent reauthorization, audit, PHI minimization, encryption policy or idempotency.
