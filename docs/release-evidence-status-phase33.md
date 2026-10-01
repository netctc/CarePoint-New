# Release Phase 33 — External Evidence Status Reporting

Branch: `quality/release-evidence-status-phase33-20261001`

## Objective

Release Phase 33 adds a deterministic, read-only status view over the 8 external gates defined by Phase 31 and validated by Phase 32.

It does not manufacture evidence, accept a gate, authorize production, merge code, or modify the evidence index.

## Output

The reporter reads a repository-relative `carepoint.go-live-evidence-index/v1` document and produces either Markdown or JSON.

It reports:

- exact consolidated release PR and source SHA;
- accepted/pending gate counts;
- completion percentage;
- each gate status and sanitized evidence reference;
- aggregate final decision.

The decision is fail-closed:

- fewer than 8/8 accepted => `BLOCKED`;
- 8/8 accepted => `READY_FOR_HUMAN_RELEASE_AUTHORIZATION`.

Even at 8/8, the reporter enforces:

- `productionAcceptance=false`;
- `mainMergeAllowed=false`;
- human authorization remains mandatory.

## Commands

Structural contract:

`npm run v2:release-phase33`

Human-readable status:

`npm run v2:release-phase33-status -- ops/release-1/go-live-evidence-index.example.json`

JSON status:

`npm run v2:release-phase33-status -- ops/release-1/go-live-evidence-index.example.json --json`

## Safety

Phase 33 is read-only. It does not mutate evidence, secrets, infrastructure, GitHub state, or release state.

Only repository-relative index paths are accepted.

## Environment

No new production environment variables.

No .env file is added.

## Database

No migration.
