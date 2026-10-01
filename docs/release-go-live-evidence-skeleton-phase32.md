# Release Phase 32 — Go-Live Evidence Skeleton Generator

Branch: quality/release-evidence-skeleton-phase32-20261001

## Objective

Phase 32 prepares operator-ready evidence skeletons for the eight external Go-Live gates without
claiming that any external evidence has been collected.

It extends the existing CarePoint release-evidence tooling instead of creating a parallel release
system.

## Inputs

The generator requires two explicit CI/operator inputs:

- CAREPOINT_RELEASE_SHA — exact 40-character candidate Git SHA.
- CAREPOINT_RELEASE_VERSION — bounded release identifier.

These are generation-time inputs, not new production application environment variables.

The generator also verifies that CAREPOINT_RELEASE_SHA exactly matches git rev-parse HEAD.

## Source templates

The generator reads the Phase 31 readiness inventory and the evidence template associated with each
of its eight external gates.

It does not invent a gate or infer acceptance from workflow success.

## Candidate binding

Where an evidence schema already exposes release.sourceSha and release.releaseVersion (or
release.version), Phase 32 binds those fields to the exact candidate.

The resilience exercise plan intentionally has no release object. It remains schema-identical and
is bound to the candidate through the generated bundle manifest instead of modifying its schema.

## Fail-closed rules

Before and after candidate binding, every evidence object is checked so that:

- approved cannot be true;
- productionAcceptance cannot be true;
- acceptedAt remains null when present;
- accepted/approved sign-offs are rejected;
- accepted/ready/go overall statuses are rejected;
- accepted/ready/go final decisions are rejected.

The generator never changes an approval to true.

## Output

The output directory receives:

- one JSON skeleton per external gate;
- go-live-evidence-skeleton-manifest.json.

The bundle manifest records:

- exact source SHA;
- release version;
- source template for every item;
- SHA-256 digest of every skeleton;
- whether release-field binding was applied;
- externalEvidenceRequired=true;
- automatedContractIsSufficient=false;
- autoClosable=false.

The output directory is created with restricted permissions and files are written mode 0600.

## Security boundary

The generated bundle is still a skeleton.

It contains no:

- production credentials;
- provider secrets;
- access tokens;
- private keys;
- patient data;
- raw penetration-test report;
- restricted topology evidence.

Real restricted evidence remains outside the repository and is referenced later by approved
non-secret evidence identifiers.

## Production boundary

The generated manifest always states:

- productionAcceptance=false
- approvalsApplied=false
- externalEvidenceCompleted=false
- restrictedEvidenceIncluded=false

A generated bundle is never a Go-Live approval.

## Validation

Self-test:

npm run release:evidence-skeleton-self-test

Structural Phase 32 gate:

npm run v2:release-phase32

Generation example for an exact checked-out candidate:

CAREPOINT_RELEASE_SHA=<40_HEX_SHA> CAREPOINT_RELEASE_VERSION=<VERSION> npm run release:evidence-skeleton

## Database

No database migration.

## Environment

No new production environment variables.

No .env file is added.
