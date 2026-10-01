# Release Phase 34 — Release-Chain Integrity Manifest

Branch: `quality/release-chain-integrity-phase34-20261001`

## Objective

Release Phase 34 freezes the validated release-control chain as an auditable manifest so later work cannot silently drift away from the exact baseline and release gates already validated.

## Canonical chain

- #511 — unified Transport 8–30 validation baseline
- #512 — external Go-Live readiness
- #513 — external evidence validator and gate aggregator
- #514 — external evidence status reporting

The manifest binds each PR to its exact head SHA and expected parent PR.

This is a release-chain integrity control, not a merge authorization mechanism.

## Invariants

The following remain mandatory:

- `productionAcceptance=false`
- `mainMergeAllowed=false`
- automatic merge is not authorized
- external evidence must never be synthesized
- explicit human authorization remains required

The Phase 32/33 decision boundary remains unchanged:

- fewer than 8/8 accepted external gates => `BLOCKED`
- 8/8 accepted external gates => `READY_FOR_HUMAN_RELEASE_AUTHORIZATION`

## Command

`npm run v2:release-phase34`

The smoke contract verifies the exact PR/SHA chain and the release-safety invariants.

## Environment

No new production environment variables.

No .env file is added.

## Database

No migration.
