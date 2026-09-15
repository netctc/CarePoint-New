# Release 1 — R10 Release Candidate Evidence Bundle

Status: **SOURCE-SIDE EVIDENCE PIPELINE IMPLEMENTED / FINAL DEPLOYMENT ARTIFACTS PENDING**  
Tracker: #96  
Primary blocker: #97  
Canonical branch: `release/release-1-integration-go-live-readiness`

## 1. Purpose

This document defines the repository-side Release Candidate (RC) evidence bundle added for R10. The objective is to bind one exact Git SHA to its dependency locks, migration set, source/configuration contracts, build snapshots and software-dependency evidence before the final production deployment mechanism is selected and accepted.

The bundle deliberately does **not** claim to be the final production deployment artifact. The authoritative API/Admin deployment image/package, registry digest, signing/provenance mechanism and production promotion path still depend on #79 and #97. Signed native Android/iOS artifacts remain owned by #81.

## 2. Workflow

Workflow:

`.github/workflows/release-candidate-evidence.yml`

The workflow has two modes:

- pull-request mode explicitly checks out and validates the PR **head SHA**, not GitHub's synthetic merge SHA, using a non-release `0.0.0-ci` version;
- manual `workflow_dispatch` mode generates a candidate evidence bundle for the exact ref selected by the authorized operator and requires an explicit RC version input.

The workflow uses pinned source-control/setup actions already consistent with the repository's CI model and a pinned `actions/upload-artifact` release. The uploaded GitHub Actions artifact is immutable within the workflow run and exposes an artifact digest that can be referenced by the final release evidence record.

## 3. Exact-SHA binding

`.ci/generate-rc-evidence.mjs` requires:

- `CAREPOINT_RELEASE_VERSION` using the same bounded release-version character model as the API release identity;
- a full 40-hex `CAREPOINT_RELEASE_SHA`;
- the checked-out `git rev-parse HEAD` to equal that SHA exactly;
- an evidence purpose of `validation` or `candidate`.

A mismatched source SHA fails the workflow. This prevents an evidence package from being labelled as one candidate while being built from another checkout. For pull-request validation the workflow deliberately supplies `github.event.pull_request.head.sha` and checks out that same commit so the evidence corresponds to the canonical release-branch source, not to the temporary GitHub PR merge commit.

## 4. Dependency evidence

The workflow:

- fixes npm to the repository package-manager version (`10.9.2`);
- resolves the candidate lock without package scripts;
- executes the existing `.ci/verify-npm-lock.mjs` Phase C2 canonical dependency-graph verifier;
- runs `npm ci` from the verified lock;
- resolves Flutter dependencies using the same pinned Flutter version as normal CI;
- verifies every generated mobile `pubspec.lock` against `.ci/flutter-pubspec-locks.sha256`;
- records the raw `package-lock.json` SHA-256, the canonical-contract file SHA-256 and the canonical-verifier SHA-256 separately in `rc-manifest.json`;
- re-runs the existing canonical npm verifier from the evidence generator and records a digest of its success output rather than incorrectly treating the normalized canonical graph digest as a raw file-byte digest;
- records the actual Flutter lock hashes in `rc-manifest.json`;
- captures Flutter dependency inventories for `mobile_core`, Patient, Doctor and Other Provider applications.

The canonical npm dependency digest and the raw `package-lock.json` byte digest serve different purposes and are intentionally not compared directly. Phase C2 canonicalization remains owned by `.ci/verify-npm-lock.mjs`; the RC manifest fingerprints the raw lock and verifier/contract independently for evidence correlation.

The mobile dependency inventories are source-side evidence only. They do not replace native signed-artifact/SBOM/store evidence required by #81.

## 5. SBOM evidence

After the verified npm installation, the workflow generates:

`node-sbom.cdx.json`

using npm's CycloneDX SBOM support with development dependencies omitted for the production dependency view.

This establishes a versioned Node dependency SBOM tied to the exact workflow checkout. The final production release record must still associate the accepted SBOM with the actual immutable deployable API/Admin artifact digest. If the selected deployment platform generates additional image/container/package SBOM or provenance evidence, #97 should retain those authoritative references as well.

## 6. Build snapshots

The workflow performs the normal repository Node build and produces deterministic archive envelopes for inspection/correlation:

- `api-build-snapshot.tar.gz` — API compiled output plus Prisma schema/migrations and package/lock metadata;
- `admin-build-snapshot.tar.gz` — Admin Next.js build output plus package/lock metadata, excluding build cache/trace material.

Archive metadata is normalized (`sorted paths`, zero timestamp, numeric owner/group and timestamp-free gzip header) to remove avoidable archive-envelope variation.

These files are **build snapshots**, not an assertion that the selected production runtime should deploy these tarballs directly. The final deployable artifact format remains a #79/#97 decision and must have its own immutable digest.

## 7. Database migration evidence

The manifest enumerates every Prisma migration directory in sorted order and records:

- migration name;
- `migration.sql` path;
- file size;
- SHA-256 digest;
- aggregate migration-set SHA-256.

This gives R10/#98 an exact migration set for the candidate. It does not by itself prove expand/contract compatibility, lock duration, production-volume behavior or rollback safety; those remain part of the production-equivalent rehearsal under #98.

## 8. Source/configuration contracts

The manifest hashes the principal source contracts that determine the candidate's release/dependency/configuration gate, including:

- root/API/Admin package definitions;
- npm and Flutter canonical lock contracts;
- the canonical npm verifier itself;
- API `.env.example` configuration contract;
- Admin `next.config.ts`;
- CI, Security Analysis, PostgreSQL Recovery, Slice 10 FHIR and RC-evidence workflow definitions.

No environment secret values are captured.

## 9. Output bundle

The workflow uploads a bundle named with the exact validated source SHA. It contains:

- `rc-manifest.json`;
- `SHA256SUMS`;
- Node CycloneDX SBOM;
- API/Admin build snapshots;
- Flutter version evidence;
- four Flutter dependency inventories.

`SHA256SUMS` is verified before upload. The GitHub upload step additionally returns an immutable artifact digest for the uploaded bundle. Final Release CAB evidence should record the workflow run, artifact digest, exact source SHA and RC version.

## 10. What this closes and what remains open

This source-side pipeline materially advances #97 by providing exact-head-SHA evidence generation, canonical dependency-graph verification, raw lock fingerprinting, a Node SBOM, migration-set hashing, deterministic build snapshots and an immutable workflow artifact digest.

It does **not** close #97. The following still require the real selected release platform/environment:

- final immutable deployable API artifact/image and digest;
- final immutable deployable Admin artifact/image and digest;
- artifact signing/provenance/attestation appropriate to the approved registry/platform;
- signed Android/iOS artifacts/checksums and mobile release evidence from #81;
- proof that production deploys the exact immutable artifact represented by the accepted release package;
- branch/promotion enforcement from #84;
- production-equivalent deploy/rollback evidence from #98.

## 11. Final RC operating rule

For the final Release 1 candidate, run the manual evidence workflow from the exact frozen candidate ref. Record the RC version, SHA, workflow run and immutable evidence artifact digest. Then bind that evidence to the authoritative production API/Admin artifact digests selected under #79/#97.

Do not rebuild from a moving branch for production and do not use a source-only evidence PASS to infer production deployment readiness.
