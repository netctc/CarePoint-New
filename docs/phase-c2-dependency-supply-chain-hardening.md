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

The validated dependency graph resolves `deepmerge-ts` 8.0.2 while retaining the current Prisma major version. This avoids an unsafe forced Prisma downgrade.

### Removal condition

The override is temporary technical debt. Remove it only after the repository's supported Prisma / `@prisma/config` release natively requires a non-vulnerable `deepmerge-ts >= 8.0.0`, and only after the complete Node, database, C1 and FHIR regression gates pass without the override.

## 2. npm toolchain pin

The root project already declares:

```text
packageManager = npm@10.9.2
```

CI now installs and verifies exactly npm `10.9.2` before dependency resolution instead of accepting the npm version bundled implicitly with the hosted runner.

This avoids lock resolution changing merely because GitHub updates the runner image.

## 3. Canonical Node dependency-graph gate

The repository does not currently version the full generated `package-lock.json`. Phase C2 therefore uses a fail-closed graph-verification boundary before dependency package scripts are allowed to execute.

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
canonicalize complete package-lock JSON
    |
    v
SHA-256 must match .ci/npm-package-lock.canonical.sha256
    |
    +--> mismatch: stop; do not install dependency graph
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

`.ci/verify-npm-lock.mjs` recursively sorts JSON object keys and hashes the complete semantic lock structure. This keeps the gate sensitive to versions, resolved artifacts, integrity data and dependency structure while avoiding false failures caused only by JSON key serialization order.

The current validated canonical SHA-256 is stored in:

```text
.ci/npm-package-lock.canonical.sha256
```

Changing any dependency range or override therefore requires an explicit review and regeneration of the validated canonical digest.

### Why scripts are disabled during candidate resolution

`--package-lock-only --ignore-scripts` resolves the candidate graph without executing package lifecycle scripts. A graph that does not match the approved digest is rejected before `npm ci` executes dependency installation scripts.

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

The current validated graph includes the shared mobile security/runtime dependencies plus the patient geolocation dependency. A change in any resolved lock causes CI to stop before analyzer/test acceptance.

The shared `mobile_core` acceptance currently runs analyzer plus its full test suite; Patient, Doctor and Other Provider applications are separately analyzed against the same fixed Flutter SDK.

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
2. Resolve with the pinned npm / Flutter toolchain.
3. Review the resulting dependency changes and current advisories.
4. Run the complete build and regression suite.
5. Only after acceptance, update the corresponding approved canonical/hash file.
6. Commit the dependency declaration and approved digest change together.
7. Record the reason for the graph change in the commit/PR.

Updating an approved digest merely to make CI green, without reviewing the changed graph, defeats this control and is not an acceptable release procedure.

## 9. Remaining supply-chain work

Phase C2 does not claim that all software-supply-chain controls are complete. Remaining production hardening includes:

- versioning the full generated Node and Dart lockfiles when the repository release process adopts them as first-class source artifacts; the current digest gates provide fail-closed graph validation in the meantime;
- pinning PostgreSQL and Redis CI service images by immutable OCI digest rather than major/minor tags;
- reviewing nested actions used internally by pinned third-party composite actions, because a pinned parent action can still invoke mutable downstream action references if its implementation does so;
- dependency update automation with explicit review policy (for example, Dependabot/Renovate with controlled grouping and required checks);
- SBOM generation and retention for release artifacts;
- package provenance / build attestation and release signing;
- container-image vulnerability scanning and immutable image digests for production workloads;
- malware/package reputation controls for newly introduced dependencies;
- periodic review of the `deepmerge-ts` override and removal when Prisma incorporates the fixed dependency natively.

These should remain visible in the production-readiness backlog rather than being inferred as complete from the C2 CI gates.
