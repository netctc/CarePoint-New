# CarePoint integrated test version

This workflow assembles a reproducible test-only CarePoint candidate from one Git commit.

It includes five immutable OCI images: API, Admin, Patient Web, Doctor Web and Other Provider Web. The three Flutter Web directories are also retained as downloadable artifacts, together with a content-addressed manifest, runtime contract and web-file checksums.

## Invocation

Run Integrated Test Version Bundle manually and provide the HTTPS test API base ending in /api/v1.

The workflow records exact OCI image digests and uploads the three web clients as one integrated artifact. It never uses a mutable latest tag.

## Runtime profile

The API test deployment must use the existing isolated-synthetic private-pilot infrastructure profile. That profile keeps production transport and cookie controls active while requiring synthetic-only data, private/internal PostgreSQL and Redis, local pilot-scoped cryptographic material, mock external integrations and disabled production-facing features.

The Admin container must be given CAREPOINT_API_URL manually at runtime, pointing to the same HTTPS API base used to build the three Flutter clients.

Sensitive runtime values are not stored in the bundle. Configure them through the deployment platform or secret manager. Do not create or ship repository .env files.

## Scope

The bundle is suitable for integrated functional and UAT testing of the functionality merged at the recorded SHA. It is explicitly not production release evidence and does not bypass production infrastructure, security, UAT, regulatory or promotion gates.

## Deployment surface

The integrated manifest records immutable GHCR digest references for all five applications. Web images run as non-root Node containers on port 8080 using the repository static server. The runtime contract lists service ports and variable names only; it contains no credentials or secret values.
