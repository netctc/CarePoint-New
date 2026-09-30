# Release 1 API/Admin Container Compatibility

This document defines a source-side packaging baseline for CarePoint Release 1. It is supporting evidence for R10/#97/#98 and does not claim that production infrastructure, registry provenance, deployment, rollback, mobile signing, provider activation, UAT or regulatory acceptance has occurred.

## Objectives

- Build the API and Admin deployables from the repository-pinned npm dependency graph.
- Keep runtime configuration and secrets outside image layers.
- Run both application processes as a non-root user.
- Attach exact source SHA and release-version metadata to validation images.
- Build both targets in GitHub Actions without publishing them.
- Preserve the existing fail-closed production readiness checks at runtime.
- Pin source-side container supply-chain inputs so a future rebuild cannot silently move to a different base image or Action implementation.
- Capture machine-readable content-addressed image evidence for each exact candidate build.

## Targets

The root `Dockerfile` exposes two final targets:

- `api` — NestJS API runtime on port 4000.
- `admin` — Next.js standalone Admin runtime on port 3000.

Both targets are built from the same source tree and dependency lock. The Admin build uses Next.js `output: "standalone"` so its runtime can be copied as a self-contained server tree rather than requiring the complete development workspace.

## Pinned container base

All Dockerfile stages use the same immutable multi-platform Node base:

`node:22-bookworm-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5`

The mutable Dockerfile frontend directive is intentionally omitted because this Dockerfile does not require frontend-specific advanced syntax. Updating the Node base digest is therefore an explicit repository change that must rerun the container compatibility gate.

## Build examples

```bash
docker build --target api \
  --build-arg RELEASE_SHA="$(git rev-parse HEAD)" \
  --build-arg RELEASE_VERSION="release-1-candidate" \
  -t carepoint-api:release1 .

docker build --target admin \
  --build-arg RELEASE_SHA="$(git rev-parse HEAD)" \
  --build-arg RELEASE_VERSION="release-1-candidate" \
  -t carepoint-admin:release1 .
```

These commands create local artifacts only. A final production release must use the approved registry/build platform and record immutable registry/artifact digests and approved provenance under #97.

## Runtime configuration boundary

The API intentionally retains the production readiness controls already implemented in source. Production startup may fail unless the approved external configuration is supplied, including database, Redis, KMS, object storage, data-governance, external-secret, OTLP/SIEM, provider, browser-origin and Release Candidate identity settings. This is expected fail-closed behavior and must not be bypassed in the image.

Do not bake `.env` files, credentials, private keys, signing material, provider secrets, PHI or regulated evidence into images. The root `.dockerignore` excludes local runtime configuration and common secret-file formats from the build context while allowing repository-owned example configuration files.

## Release identity

The validation build accepts:

- `RELEASE_SHA`
- `RELEASE_VERSION`

and records them as OCI labels:

- `org.opencontainers.image.revision`
- `org.opencontainers.image.version`

This metadata helps correlate a built artifact with a source candidate. It does not replace the API's runtime Release 1 identity contract or the immutable registry digest/provenance required by #97.

## Non-root runtime

Both final stages switch to the standard unprivileged `node` user. The compatibility workflow fails if a final image has an empty, `0` or `root` runtime user.

## CI compatibility gate

`.github/workflows/release1-container-compatibility.yml` builds `api` and `admin` independently for the exact pull-request head SHA. It:

1. checks out the exact candidate SHA rather than the pull-request merge ref;
2. verifies `git rev-parse HEAD` equals that SHA;
3. uses commit-SHA-pinned checkout, Buildx, build-push and artifact-upload Actions;
4. builds each final target without push/publication;
5. verifies the non-root runtime user;
6. verifies the OCI revision label equals the exact candidate SHA;
7. verifies the Buildx-reported image ID matches the locally inspected content-addressed image ID;
8. fingerprints `Dockerfile` and `.dockerignore`;
9. exports only sanitized machine-readable JSON evidence as a short-lived Actions artifact.

The evidence schema is `carepoint.release-container-compatibility/v1` and records target, source SHA, release version, local image ID, BuildKit digest when supplied, runtime user, OCI revision and source packaging hashes. It explicitly records:

- `published: false`
- `productionDeploymentEvidence: false`

The workflow is a source/build compatibility gate only. A green result means the repository can produce content-addressed local API/Admin container targets from that candidate. It does not mean the images have been security-approved, signed, pushed to a production registry or deployed.

## Deferred final evidence

The following remain intentionally deferred to their owning release gates:

- immutable registry digest, signing/attestation and final provenance — #97;
- actual production-equivalent deployment, migration and rollback rehearsal — #98;
- production infrastructure and residency evidence — #79;
- real provider E2E activation — #80;
- signed mobile artifacts and physical-device acceptance — #81;
- final security/pentest and repository protection — #82/#84/#85/#124;
- human UAT — #87;
- performance/resilience execution — #88/#89/#90;
- KSA legal/privacy/clinical approvals — #91/#92/#93/#94.

## Acceptance boundary

This source-side task may close when both container targets build successfully on one exact Release 1 candidate using the pinned inputs and their content-identity assertions pass. The parent release gates must remain open until their real external evidence and approvals are complete.
