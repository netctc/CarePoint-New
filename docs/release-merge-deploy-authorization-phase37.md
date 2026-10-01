# Release Phase 37 — Explicit Merge/Deploy Authorization Contract

Branch: `quality/release-merge-deploy-authorization-phase37-20261001`

## Objective

Release Phase 37 defines a separate explicit merge/deploy authorization record after Phase 36 human release authorization.

It prevents a human release authorization from being interpreted as an implicit merge or deployment approval.

## Preconditions

Any `AUTHORIZED` merge/deploy decision requires:

- all 8/8 external gates accepted;
- Phase 32 aggregate decision `READY_FOR_HUMAN_RELEASE_AUTHORIZATION`;
- Phase 36 human release authorization status `AUTHORIZED`;
- exact release candidate PR/SHA match.

Deployment authorization additionally requires merge authorization and an approved production change-window reference.

## Independent decisions

The record has two explicit decisions:

1. `mergeDecision`
2. `deploymentDecision`

They remain `PENDING` in the repository template.

A deployment decision cannot become `AUTHORIZED` unless merge is also explicitly authorized.

## Safety boundary

Phase 37:

- does not execute merge;
- does not execute deployment;
- does not modify `main`;
- keeps `productionAcceptance=false`;
- requires post-deploy validation even after deployment authorization.

Actual merge and deployment execution remain operator actions.

## Commands

Structural contract:

`npm run v2:release-phase37`

Validate a real decision:

`npm run v2:release-phase37-merge-deploy -- <merge-deploy-record.json> <human-authorization-record.json> <evidence-index.json>`

## Environment

No new production environment variables.

No .env file is added.

## Database

No migration.
