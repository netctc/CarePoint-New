# ADR-0001 — V2 Baseline and Branching Authority

- Status: Accepted for Phase 0
- Date: 2026-09-19
- Repository: `netctc/CarePoint-New`
- Recovery reference: `Inicio_V2`
- Baseline commit: `604f522412c8da6668ee2df42ce58ec3994798c5`

## Context
CarePoint V2 must evolve from the audited pre-V2 source while preserving an exact rollback point. The repository's current `main` is not the V2 source of truth because it is not identical to `Inicio_V2`.

At Phase 0 execution time, `main` was observed at `61a7f8d03a9dc68469b83695c826b0f898ab6d7b`.

## Decision
1. `Inicio_V2` is the immutable pre-V2 recovery reference and must never be moved or deleted.
2. `v2/development` is the V2 integration branch and was created directly from `604f522412c8da6668ee2df42ce58ec3994798c5`.
3. Work is performed on scoped `v2/*` branches and enters `v2/development` through pull requests.
4. Force-pushes and branch deletion are forbidden for `v2/development`.
5. V2 work must not be based on or rebased onto `main` unless a future ADR explicitly reconciles the histories.
6. Branches, commits, PRs, issues and engineering artifacts use English.
7. Existing baseline migrations are immutable; V2 database changes use new forward migrations.

## Recovery
```bash
git fetch origin --tags --prune
git switch -c restore/pre-v2 Inicio_V2
git rev-parse HEAD
# Expected: 604f522412c8da6668ee2df42ce58ec3994798c5
```

Parallel worktree:
```bash
git worktree add ../CarePoint-pre-v2 Inicio_V2
```

## Required repository control
Before the Phase 0 bootstrap PR is merged, configure an **active** GitHub ruleset for `refs/heads/v2/development` with at least:
- deletion blocked;
- non-fast-forward updates blocked;
- pull requests required;
- stale approvals dismissed on push;
- review threads resolved;
- required repository CI/security checks.

This control is a Phase 0 exit-gate requirement.
