# Phase C2 - Dependency and Supply-Chain Hardening

## Purpose

Phase C2 reduces dependency and CI/CD supply-chain drift after Phase C1 production KMS readiness. The phase is intentionally focused on build and dependency trust: the application feature set and domain boundaries are unchanged.

The controls in this phase are designed to fail closed when the resolved Node or Flutter dependency graph no longer matches the graph that was explicitly validated.

## 1. High-severity npm vulnerability remediation

CI identified three high-severity findings that were the same transitive vulnerability reported through the Prisma toolchain:

```text
deepmerge-ts < 8.0.0
    -> @prisma/config
    -> prisma
```

The vulnerable range is affected by stack exhaustion when maliciously recursive object graphs are merged. The repository currently applies the following root npm override:

```json
{
  "overrides": {
    "deepmerge-ts": "^8.0.1"
  }
}
```

The validated dependency graph resolves `deepmerge-ts` 8.0.2 while retaining Prisma 6.19.3. This avoids an unsafe forced Prisma downgrade.

### Removal condition

The override is temporary technical debt. Remove it only after the repository's supported Prisma / `@prisma/config` release natively requires a non-vulnerable `deepmerge-ts >= 8.0.0`, and only after the complete Node, database, C1 and FHIR regression gates pass without the override.

## 2. npm toolchain and reviewed direct dependency pins

The root project declares:

```text
packageManager = npm@10.9.2
```

CI installs and verifies exactly npm `10.9.2` before dependency resolution instead of accepting the npm version bundled implicitly with the hosted runner.

During C2 acceptance, an otherwise clean re-resolution exposed registry drift limited to the two direct AWS SDK clients: both moved from `3.1127.0` to `3.1128.0` while the total graph remained 442 packages and `npm audit` remained at zero vulnerabilities. The drift was reviewed explicitly rather than accepted by changing a hash blindly.

The API now pins the reviewed direct versions:

```text
@aws-sdk/client-kms = 3.1128.0
@aws-sdk/client-s3  = 3.1128.0
```

## 3. Versioned and canonical Node dependency lock

`package-lock.json` is now a first-class versioned source artifact. The lock was generated with npm 10.9.2 using `--package-lock-only --ignore-scripts`, audited before commit, and its complete canonical structure is pinned by:

```text
.ci/npm-package-lock.canonical.sha256
```

Current approved canonical SHA-256:

```text
274af65084df20d0727b91f1a1f4472d3a5115b65e8d1cb24535f1501007af8a
```

CI retains a no-script re-resolution step as an explicit **drift detector**, not as an approval mechanism. `.ci/verify-npm-lock.mjs` now requires that:

- `package-lock.json` is tracked by git;
- candidate no-script resolution leaves the committed lock byte-for-byte unchanged;
- the recursively canonicalized lock matches the approved SHA-256;
- the graph therefore remains the exact graph reviewed in source control before `npm ci` is allowed.

Sequence:

```text
checkout pinned source
    |
    v
install exact npm 10.9.2
    |
    v
npm install --package-lock-only --ignore-scripts
    |
    v
assert committed package-lock.json is unchanged
    |
    v
canonicalize complete package-lock JSON
    |
    v
SHA-256 must match .ci/npm-package-lock.canonical.sha256
    |
    +--> any drift/mismatch: stop; do not install dependency graph
    |
    v
npm ci
    |
    v
npm audit --audit-level=high
    |
    v
build / tests / database / application smoke suites
```

The canonical verifier remains sensitive to versions, resolved artifacts, integrity data and dependency structure while avoiding false failures caused only by JSON object key ordering.

### Why scripts are disabled during drift detection

`--package-lock-only --ignore-scripts` checks whether current dependency metadata would alter the reviewed lock without executing package lifecycle scripts. Any difference from the committed lock is rejected before `npm ci` executes dependency installation scripts.

This is intentionally stricter than silently refreshing a lock in CI: registry movement requires an explicit source change and review.

## 4. npm vulnerability gate

Both normal development CI and the FHIR interoperability workflow use the validated graph. The main CI additionally executes:

```text
npm audit --audit-level=high
```

Any new high or critical npm advisory blocks the Node pipeline instead of being logged as a non-failing warning.

## 5. Flutter SDK and dependency-graph pinning

The mobile CI no longer floats on the latest stable Flutter SDK. Phase C2 pins:

```text
Flutter 3.47.2
```

The four Dart/Flutter dependency graphs are resolved once per job and their generated `pubspec.lock` files must match the approved SHA-256 values stored in:

```text
.ci/flutter-pubspec-locks.sha256
```

Covered projects:

- `packages/mobile_core`;
- `apps/patient-mobile`;
- `apps/doctor-mobile`;
- `apps/provider-mobile`.

The shared `mobile_core` acceptance runs analyzer plus its full test suite; Patient, Doctor and Other Provider applications are separately analyzed against the same fixed Flutter SDK.

## 6. GitHub Action source pinning

Top-level workflow actions are referenced by immutable commit SHA rather than mutable major-version tags:

```text
actions/checkout        11d5960a326750d5838078e36cf38b85af677262

actions/setup-node      49933ea5288caeca8642d1e84afbd3f7d6820020

subosito/flutter-action 1a449444c387b1966244ae4d4f8c696479add0b2
```

This prevents an upstream movement of `@v4` / `@v2` from silently changing the top-level action implementation used by CarePoint.

The main CI runner is also pinned to the Ubuntu 24.04 runner family instead of `ubuntu-latest`.

## 7. Regression boundary

C2 must preserve all previously validated behavior. Its acceptance therefore retains:

- Node build and workspace tests;
- Phase C1 production KMS deterministic acceptance;
- Prisma migration/deployment and platform bootstrap;
- API startup and IAM persistence smoke testing;
- Admin B1-B9 acceptance;
- Slices 2-9 regression smoke tests;
- Flutter shared-client tests and all three application analyzers;
- FHIR Slice 10.0 through 10.13 interoperability, SMART and durable Bulk Data regression coverage.

C2 is not complete if supply-chain gates pass but any prior functional/security regression suite fails.

## 8. Dependency update procedure

A dependency update must be intentional rather than an automatic drift event.

1. Change the relevant `package.json`, `pubspec.yaml` or npm override.
2. Resolve with the pinned npm / Flutter toolchain and with package scripts disabled during initial Node resolution.
3. Review package additions/removals/version changes, resolved artifacts, integrity changes and current advisories.
4. For Node, commit the reviewed `package-lock.json` together with the manifest change.
5. Recalculate `.ci/npm-package-lock.canonical.sha256` from that exact committed lock; for Flutter, update only the affected approved lock hashes.
6. Run the complete build and regression suite.
7. Record the reason for the graph change in the commit/PR.

Updating an approved digest merely to make CI green, without reviewing the changed graph, defeats this control and is not an acceptable release procedure.

## 9. Remaining supply-chain work

Phase C2 does not claim that all software-supply-chain controls are complete. Remaining production hardening includes:

- adopting the generated Dart `pubspec.lock` files as first-class versioned release artifacts in addition to their current fail-closed digest gate;
- pinning PostgreSQL and Redis CI service images by immutable OCI digest rather than major/minor tags;
- reviewing nested actions used internally by pinned third-party composite actions, because a pinned parent action can still invoke mutable downstream action references if its implementation does so;
- dependency update automation with explicit review policy (for example, Dependabot/Renovate with controlled grouping and required checks);
- SBOM generation and retention for release artifacts;
- package provenance / build attestation and release signing;
- container-image vulnerability scanning and immutable image digests for production workloads;
- malware/package reputation controls for newly introduced dependencies;
- periodic review of the `deepmerge-ts` override and removal when Prisma incorporates the fixed dependency natively.

These should remain visible in the production-readiness backlog rather than being inferred as complete from the C2 CI gates.
