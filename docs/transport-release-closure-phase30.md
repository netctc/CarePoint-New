# Transport Phase 30 — Final Integration & Rollback Readiness

Branch: quality/transport-release-closure-phase30-20261001

## Objective

Phase 30 is a release-closure quality gate. It adds no new Transport business feature.

It defines how the complete Transport work can be consolidated safely, how database changes are
classified, what evidence is required before a main merge, and how an application rollback must be
handled without destructive ad-hoc database rollback SQL.

## Current merge boundary

The contract explicitly keeps:

mainMergeAuthorized: false

The current full validation candidate is draft PR #508:

integration/transport-phases8-29-validation-20261001

A green fast-lane PR is not sufficient for final integration. The exact consolidated candidate head
must pass the full canonical matrix.

## Quality prerequisites

Phase 30 requires the guarantees introduced by:

- Phase 27 — integration closure + migration preflight;
- Phase 28 — cross-phase end-to-end acceptance;
- Phase 29 — real PostgreSQL transactional acceptance.

Phase 29 also refuses production execution and requires its explicit CI/test enable flag.

## Migration safety

The closure contract tracks 23 Transport migrations.

The Phase 30 smoke reads every migration.sql and forbids:

- DROP TABLE
- DROP COLUMN
- DROP TYPE
- TRUNCATE
- DELETE FROM

The only DROP-form syntax explicitly permitted is:

DROP NOT NULL

This occurs in the optional-coordinate migration and relaxes a nullability constraint. It does not
delete a table, column, type, or row.

Migration timestamps must remain chronological and unique.

## Rollback model

Rollback mode:

APPLICATION_REVERT_PLUS_FORWARD_DB_REMEDIATION

Transport schema changes are intentionally additive or constraint-relaxing. Therefore Phase 30 does
not pretend that a generic destructive down migration is safe.

If the application must be rolled back:

1. revert the consolidated application merge;
2. preserve compatible additive database structures;
3. deploy any necessary database correction through a reviewed forward migration;
4. never execute ad-hoc destructive down SQL.

## Final merge protocol

Before a main merge:

1. freeze the exact consolidated candidate head after the full matrix is green;
2. require explicit human authorization;
3. merge the single consolidated Transport candidate rather than replaying every stacked PR;
4. run canonical validation again on the resulting main SHA;
5. deploy migrations only through the approved migration command/environment;
6. close the stacked PR chain only after the consolidated main merge is verified.

## Required operational evidence

The final release record must retain:

- pre-deploy database backup/recovery evidence;
- exact release/main SHA;
- migration deployment log;
- post-deploy health/readiness evidence;
- post-merge canonical CI evidence;
- rollback/revert command evidence if rollback is actually exercised.

## Acceptance boundary

Phase 30 keeps productionAcceptance=false.

It does not authorize:

- production deployment;
- a main merge;
- bypassing live UAT;
- bypassing infrastructure/security/recovery evidence.

## Database

No new database migration.

## Environment

No new production environment variables.

No .env file is added.

## Validation

npm run v2:transport-phase30
