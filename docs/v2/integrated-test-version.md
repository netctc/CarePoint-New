# CarePoint integrated test version

This workflow assembles a reproducible test-only CarePoint candidate from one Git commit.

It includes the API OCI image, the Admin OCI image, Patient Mobile as Flutter Web, Doctor Mobile as Flutter Web, Other Provider Mobile as Flutter Web, plus a content-addressed manifest and web-file checksums.

## Invocation

Run Integrated Test Version Bundle manually and provide the HTTPS test API base ending in /api/v1.

The workflow records exact OCI image digests and uploads the three web clients as one integrated artifact. It never uses a mutable latest tag.

## Runtime profile

The API test deployment must use the existing isolated-synthetic private-pilot infrastructure profile. That profile keeps production transport and cookie controls active while requiring synthetic-only data, private/internal PostgreSQL and Redis, local pilot-scoped cryptographic material, mock external integrations and disabled production-facing features.

The Admin container must be given CAREPOINT_API_URL manually at runtime, pointing to the same HTTPS API base used to build the three Flutter clients.

Sensitive runtime values are not stored in the bundle. Configure them through the deployment platform or secret manager. Do not create or ship repository .env files.

## Scope

The bundle is suitable for integrated functional and UAT testing of the functionality merged at the recorded SHA. It is explicitly not production release evidence and does not bypass production infrastructure, security, UAT, regulatory or promotion gates.
