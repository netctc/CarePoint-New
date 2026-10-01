# Transport Phase 31 — Transport Release Readiness Gate

## Objective

Phase 31 consolidates the Transport validation chain into one release-readiness contract.

Its state is deliberately:

`CODE_ACCEPTANCE_READY_PRODUCTION_EVIDENCE_REQUIRED`

This means the Transport code can be treated as a **code merge candidate** after the canonical
checks are green, but this gate is **not a production deployment approval**.

The contract explicitly keeps `productionAcceptance=false`.

## Code acceptance mapped by the gate

The gate requires all of the following to remain wired:

- Phase 27 integration closure for Transport Phases 8–26.
- Phase 28 source-level end-to-end acceptance.
- Phase 29 real PostgreSQL transactional acceptance.
- Phase 30 advanced live HTTP acceptance.
- The full API test chain.
- Security Analysis.
- Canonical release-candidate evidence.
- UAT evidence.
- Promotion-policy evidence.
- Production-infrastructure evidence.

## Transactional and live ordering

Phase 29 must remain after database migrations and before shared bootstrap data:

1. `db:deploy`
2. Phase 29 PostgreSQL transactional acceptance
3. `db:bootstrap`

Phase 30 must remain chained after the established Slice 8 live medical-transport journey so it
reuses the same API, PostgreSQL, Redis and authenticated CI environment without introducing a
second test bootstrap or additional secrets.

## Production evidence still required

Production is still blocked until the exact release candidate has evidence for:

- live Cloud Run Job deployment;
- Cloud Scheduler invocation using OIDC service-account identity;
- lease/idempotency behavior in the live worker;
- failure recovery;
- private regional object storage;
- immutable release-candidate digest;
- production observability and SIEM;
- live UAT;
- promotion approval.

The existing GCP worker/scheduler contracts also continue to state that geographic DR and RPO/RTO
proofs are not yet established.

## Security boundary

The release gate preserves these requirements:

- no unauthenticated scheduler invocation;
- no static service-account keys;
- no static access tokens;
- management reports contain no patient identity, patient contact, or patient location;
- compliance manifests contain no raw audit metadata, object-storage key, or CSV content;
- report downloads do not issue public URLs;
- plaintext one-time download grants are not persisted.

## Merge boundary

Phase 31 does not authorize a direct merge to `main`.

The stacked Transport chain must first satisfy its canonical checks and then follow the normal
release/promotion process.

## Database

No Prisma model change.

No database migration.

## Environment

No new production environment variables.

No .env file is added.

## Validation

Run:

`npm run v2:transport-phase31`
