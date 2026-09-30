# Release 1 deterministic change inventory and generated release notes

This source-side R10 control produces auditable change evidence for an exact Git range without copying raw diff content, configuration values, PHI, secrets or unreviewed commit messages into the Release Candidate bundle.

It supports #96/#97 and is not a substitute for Product, Security, UAT, Operations, Clinical or Regulatory review.

## Evidence range

Every run requires two immutable Git identities:

- `CAREPOINT_RELEASE_BASE_SHA` — the approved baseline being compared.
- `CAREPOINT_RELEASE_SHA` — the exact candidate checked out and built.

Both values must be full 40-hex SHAs. The base must be an ancestor of the candidate and the candidate must equal `git rev-parse HEAD`.

For pull-request validation, the Release Candidate Evidence workflow uses the exact PR base SHA and exact PR head SHA. For a manually generated candidate bundle, `release_base_sha` is a required workflow input because engineering must not guess which previous release or deployment is authoritative.

## Generator

`.ci/generate-release-change-inventory.mjs` emits:

- `release-change-inventory.json`
- `release-notes.generated.md`

The JSON schema is:

`carepoint.release-change-inventory/v1`

## Inventory content

The inventory records:

- release version;
- exact base and candidate SHAs;
- candidate commit timestamp;
- changed path count;
- changed paths with one or more structural categories;
- API module names inferred only from repository paths;
- changed Prisma migration paths;
- changed GitHub Actions workflow paths;
- changed dependency manifests/lock files;
- added/removed configuration **key names only** from repository-owned `.env*.example` files.

Structural categories include:

- API;
- Admin;
- mobile;
- shared packages;
- database migrations;
- CI/release controls;
- packaging;
- operations;
- documentation;
- dependency manifests/locks;
- other.

A file can belong to more than one category. For example, a Prisma migration belongs to both API and database-migration categories.

## Privacy and security boundary

The generator intentionally does **not** copy:

- raw diff hunks;
- source-code snippets;
- commit-message text;
- configuration values;
- environment secrets;
- credentials/tokens;
- PHI or patient/test records;
- penetration-test or CodeQL data-flow details.

Configuration changes are represented only by allowlisted key names matching the example-file assignment shape, never by the right-hand-side value.

The emitted JSON asserts these boundaries explicitly:

- `containsRawDiffHunks: false`
- `containsCommitMessages: false`
- `containsConfigurationValues: false`
- `sourceChangeEvidenceOnly: true`
- `productionImpactRequiresReview: true`

The RC manifest validates these assertions before accepting the generated files.

## Determinism and fail-closed behavior

The inventory is derived entirely from Git objects in the exact base/candidate range and sorted path/key/module sets. It does not include the wall-clock time of the workflow run.

The generator fails when:

- either SHA is malformed;
- either Git commit is unavailable;
- base and candidate are identical;
- the base is not an ancestor of the candidate;
- checked-out HEAD differs from the requested candidate;
- release version is malformed.

Its self-test creates an isolated temporary Git repository to prove valid ancestry succeeds and a reversed/non-ancestor range fails. It also verifies path classification and configuration-key extraction.

## Release Candidate Evidence integration

`Release Candidate Evidence` now:

1. checks out full Git history for auditable range verification;
2. validates npm and container supply-chain contracts;
3. runs the change-inventory self-test;
4. generates the exact range inventory and Markdown release notes;
5. builds normal dependency/SBOM/build evidence;
6. validates the inventory schema/SHA/version/evidence boundaries in `.ci/generate-rc-evidence.mjs`;
7. fingerprints the change-inventory generator as a source contract;
8. includes the inventory and generated notes in `rc-manifest.json`;
9. includes both files in `SHA256SUMS` and the immutable Actions evidence bundle.

## Interpretation

A green change-inventory control means the repository can describe what source surfaces changed between two exact Git SHAs without relying on mutable branch names or manual prose.

It does **not** mean:

- every change is functionally accepted;
- the baseline is the actual production deployment unless Operations confirms it;
- a schema change is safe for the real production data volume;
- provider behavior is accepted;
- UAT has passed;
- security/pentest findings are closed;
- KSA legal/regulatory approval exists;
- production deployment or rollback has occurred.

Those remain owned by their R3–R10 acceptance gates.
