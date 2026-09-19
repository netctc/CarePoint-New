# CarePoint V2 Engineering Workspace

This directory is the engineering control surface for CarePoint V2.

## Baseline
- Immutable recovery tag: `Inicio_V2`
- Baseline commit: `604f522412c8da6668ee2df42ce58ec3994798c5`
- V2 integration branch: `v2/development`
- Phase 0 bootstrap branch: `v2/phase-0-bootstrap`
- Engineering/source language: **English**

Code, branches, commits, PRs, issues, API names, database models, tests, ADRs and engineering evidence remain in English.

## Phase 0 purpose
Phase 0 protects the pre-V2 source, records reproducible baseline evidence, establishes V2 governance, freezes the database baseline, defines versioning and UI foundations, and creates the first V2 threat model.

No V2 schema migration or user-facing V2 feature is introduced by Phase 0.

## Contents
- `architecture-decisions/0001-v2-baseline-and-branching.md`
- `baseline-manifest.md`
- `baseline/schema.prisma`
- `migration-ledger.md`
- `contracts-versioning.md`
- `ui-foundations.md`
- `threat-model.md`
- `release-evidence/`

## Phase 0 exit gate
Phase 0 may be merged into `v2/development` only when:
1. `v2/development` is protected against deletion and non-fast-forward updates.
2. The branch is verified to originate exactly from `Inicio_V2`.
3. Baseline build/test evidence is archived.
4. The Phase 0 PR passes existing API/Admin/Flutter/security checks at baseline parity.
5. No database schema migration or user-facing V2 functionality is introduced.
6. A clean branch/worktree from `Inicio_V2` reproduces the pre-V2 source exactly.
