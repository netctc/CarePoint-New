# Release Phase 36 — Human Release Authorization Record Contract

Branch: `quality/release-human-authorization-phase36-20261001`

## Objective

Release Phase 36 defines and validates the record used when a real human release authority explicitly authorizes the validated CarePoint release candidate.

It does not create that authorization.

## Preconditions

An `AUTHORIZED` record is valid only when the linked Phase 32 evidence index has all 8/8 external gates in `ACCEPTED` state and its aggregate decision is:

`READY_FOR_HUMAN_RELEASE_AUTHORIZATION`

If the evidence is incomplete, authorization validation fails closed.

## Required human record

A real authorization must contain:

- non-secret `authorizedByRef`;
- ISO-8601 `authorizedAt`;
- decision / ticket / approval reference;
- explicit acknowledgements that:
  - all 8/8 external gates are accepted;
  - rollback plan was reviewed;
  - production change window was approved;
  - post-deploy validation ownership was assigned.

The repository template remains `PENDING` and cannot itself satisfy human authorization.

## Safety boundary

Even a valid human authorization record:

- does not authorize deployment;
- does not authorize merge;
- keeps `productionAcceptance=false`;
- keeps `mainMergeAllowed=false`;
- keeps `deploymentAuthorized=false`;
- requires a separate explicit merge/deploy decision.

## Commands

Structural contract:

`npm run v2:release-phase36`

Validate a real authorization record against its evidence index:

`npm run v2:release-phase36-authorization -- <authorization-record.json> <evidence-index.json>`

## Environment

No new production environment variables.

No .env file is added.

## Database

No migration.
