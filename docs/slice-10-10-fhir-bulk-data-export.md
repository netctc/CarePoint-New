# Slice 10.10 — FHIR Bulk Data Export & Secure Backend Jobs

## Status

Implemented as an incremental extension of the validated Slice 10.0–10.9 FHIR/SMART interoperability foundation.

Slice 10.10 adds a deliberately narrow system-level FHIR Bulk Data export workflow for pre-registered SMART backend-services clients. The implementation follows the FHIR asynchronous bulk interaction pattern without broadening CarePoint's existing system scopes or clinical authorization model.

## Supported export scope

The initial export surface is intentionally limited to the two resource types that already have explicit SMART system authorization in CarePoint:

| Resource type | Required SMART scope | Export support |
| --- | --- | --- |
| `Patient` | `system/Patient.rs` | yes |
| `Appointment` | `system/Appointment.rs` | yes |

Encounter, Observation, MedicationRequest, ServiceRequest, DiagnosticReport, DocumentReference, ImagingStudy, Practitioner and other FHIR resources are not bulk-exportable in this slice.

No wildcard `system/*.rs` scope is added.

A token must contain both read and search interaction permissions for every resource type included in a job. A token that only contains `system/Patient.rs` cannot start or retrieve an export that also contains Appointment data.

## Kick-off

Endpoint:

`GET /api/v1/fhir/R4/$export`

The endpoint is available only to SMART backend-services tokens. Ordinary CarePoint sessions and patient SMART tokens are rejected.

Required header:

`Prefer: respond-async`

Recommended/accepted response negotiation:

`Accept: application/fhir+json`

Supported query parameters:

- `_type`
- `_since`
- `_outputFormat`

All other parameters are rejected in this slice.

### `_type`

`_type` is a comma-separated list of requested FHIR resource types.

Examples:

`_type=Patient`

`_type=Patient,Appointment`

If `_type` is omitted, CarePoint exports the subset of currently supported resource types for which the token has both read and search authorization.

An explicitly requested unsupported resource type is rejected synchronously.

### `_since`

`_since` must be a valid FHIR instant that is not in the future.

CarePoint uses resource `meta.lastUpdated` semantics for the currently exported resource types:

- Patient last-updated time is the later of the PatientProfile update and its account update;
- Appointment last-updated time is the Appointment update time.

The generated Patient and Appointment resources expose `meta.lastUpdated`.

### `_outputFormat`

CarePoint currently produces NDJSON only and accepts the standard NDJSON representations:

- `application/fhir+ndjson`
- `application/ndjson`
- `ndjson`

The manifest normalizes the result to:

`application/fhir+ndjson`

### Kick-off response

A valid request returns:

- HTTP `202 Accepted`;
- an absolute `Content-Location` header;
- no bearer token or secret in the polling URL;
- no-store cache headers.

The status URL is opaque to the client even though the current CarePoint implementation uses the following shape:

`/api/v1/fhir/R4/$export-status/{jobId}`

## Asynchronous processing

Kick-off stores a compact job record in Redis and returns before data extraction begins.

Processing is scheduled asynchronously. A subsequent status request can safely re-trigger processing for an interrupted queued/running job. A distributed Redis lock ensures only one API instance processes a job at a time.

Before data is extracted, CarePoint re-validates that the registered backend client still exists and that the scopes captured at kick-off are still allowed by the current client registration.

### Consistent database snapshot

Patient and Appointment datasets for one job are collected inside a Prisma transaction using PostgreSQL `REPEATABLE READ` isolation.

This prevents the two exported resource files from being constructed from different database snapshots during the same export job.

### Safety limit

The current implementation deliberately bounds one export file to a configurable number of resources per resource type.

Environment variable:

`BULK_EXPORT_MAX_RESOURCES_PER_TYPE`

Default:

`10000`

Maximum accepted configuration:

`50000`

A job that exceeds this safety bound fails rather than silently truncating data.

This limit exists because Slice 10.10 generates one NDJSON object per resource type before writing the artifact. Streaming/multipart exports are a later concern.

## Status polling

Endpoint:

`GET /api/v1/fhir/R4/$export-status/{jobId}`

The request must carry a valid SMART backend-services token.

CarePoint additionally requires:

1. the token client id to match the client that initiated the export;
2. the current token to still cover every resource type in the job.

A token from another registered backend client receives `403 Forbidden` even if it has equivalent system scopes.

A narrower token from the same client also receives `403 Forbidden` when it does not cover the complete job.

### In progress

Queued or running jobs return:

- HTTP `202 Accepted`;
- `Retry-After`;
- `X-Progress`;
- no-store headers.

Status polling is rate-limited per client/job.

### Complete

Completed jobs return HTTP `200 OK` with `Content-Type: application/json` and a Bulk Data output manifest containing:

- `manifestType`;
- `transactionTime`;
- `requiresAccessToken: true`;
- `outputFormat: application/fhir+ndjson`;
- one `output` entry per non-empty resource type;
- output resource counts;
- an empty `error` array for a fully successful job.

The response also includes an HTTP `Expires` header.

No access token is embedded in manifest URLs.

## NDJSON files

Each output file contains one FHIR resource per line and only one resource type.

Current URL shape:

`GET /api/v1/fhir/R4/$export-file/{jobId}/{ResourceType}.ndjson`

Successful responses use:

`Content-Type: application/fhir+ndjson`

Output files are protected by the same SMART backend authorization boundary as the job.

`requiresAccessToken` is therefore always `true` in the manifest.

Clients may obtain a fresh backend access token after the five-minute token used for kick-off expires. The fresh token must:

- belong to the same registered client;
- still carry scopes covering all resources in the export job.

## Integrity validation

For each generated file CarePoint stores:

- SHA-256 digest;
- UTF-8 byte length;
- resource count;
- resource type.

Before an artifact is returned, the server re-computes the digest and byte length. A mismatch fails closed and emits a dedicated integrity audit event.

The manifest itself does not expose the internal digest or storage object key.

## Artifact storage

Bulk-export artifacts use a storage service separate from normal FHIR request/response state.

### Test and development

Local private storage is allowed outside production and uses:

`BULK_EXPORT_STORAGE_LOCAL_ROOT`

Files are created with private filesystem permissions.

### Production

Local bulk-export storage is forbidden in production.

Production uses private S3-compatible object storage with:

- no-store object cache metadata;
- AWS KMS server-side encryption;
- a dedicated bulk-export prefix;
- no direct public object URL in the manifest.

Configuration can use:

- `BULK_EXPORT_STORAGE_PROVIDER=s3`
- `BULK_EXPORT_S3_BUCKET`
- `BULK_EXPORT_S3_KMS_KEY_ID`
- `BULK_EXPORT_S3_PREFIX`

The document-storage bucket/KMS settings are accepted as fallbacks when a dedicated bulk-export bucket is not configured.

Production additionally requires:

`BULK_EXPORT_STORAGE_LIFECYCLE_CONFIRMED=true`

This is an operational fail-closed requirement confirming that the object-storage prefix is covered by an expiration lifecycle policy. Logical API expiry alone is not considered sufficient for protected bulk health data.

## Retention

Completed files remain logically accessible for at least 24 hours.

Environment variable:

`BULK_EXPORT_RETENTION_SECONDS`

Default and minimum:

`86400` seconds (24 hours)

Maximum supported by this slice:

`604800` seconds (7 days)

Redis job metadata uses the same completed-job retention interval.

When job metadata expires, status and download routes return `404` even if a stale storage object has not yet been physically removed by the storage provider. Production lifecycle policy is required to physically remove expired artifacts.

## Cancellation and cleanup

Endpoint:

`DELETE /api/v1/fhir/R4/$export-status/{jobId}`

A successful cancellation/cleanup returns HTTP `202 Accepted`.

The caller must be the originating backend client and must still have scopes covering the export.

Deletion:

- marks the job cancelled so an in-flight worker will not republish it;
- removes generated artifacts known to the job;
- removes the Redis job record;
- causes subsequent status requests to return `404`.

The same DELETE endpoint can be used after successful retrieval as an early cleanup signal.

## Rate limiting

Slice 10.10 adds rate limits for:

- export kick-off;
- status polling;
- cancellation;
- output downloads.

The status limit is keyed by backend client and job. This reduces abusive high-frequency polling while still supporting normal exponential-backoff clients.

## Audit events

Dedicated events include:

- `FHIR_BULK_EXPORT_KICKOFF`
- `FHIR_BULK_EXPORT_STATUS`
- `FHIR_BULK_EXPORT_COMPLETED`
- `FHIR_BULK_EXPORT_FAILED`
- `FHIR_BULK_EXPORT_FILE_DOWNLOADED`
- `FHIR_BULK_EXPORT_CANCELLED`
- `FHIR_BULK_EXPORT_CLIENT_DENIED`
- `FHIR_BULK_EXPORT_INTEGRITY_FAILURE`

Audit metadata can include:

- backend client id;
- opaque token id, never the bearer token;
- requested resource types;
- `_since` value;
- output counts and byte sizes;
- SHA-256 file digest;
- transaction time;
- expiry time.

Raw bearer tokens and NDJSON contents are never written to the audit database.

## CapabilityStatement

The public FHIR CapabilityStatement version advances to:

`slice-10.10`

The server-level REST operations advertise:

- operation name `export`;
- definition `http://hl7.org/fhir/uv/bulkdata/OperationDefinition/export`.

The implementation description explicitly states that system-level Bulk Data export is currently restricted to authorized Patient and Appointment resources.

## Security invariants

Slice 10.10 preserves these boundaries:

1. Bulk export is backend-services only.
2. Patient SMART tokens cannot use `$export`.
3. Ordinary CarePoint user sessions cannot use `$export`.
4. No wildcard system scope is introduced.
5. Every requested/exported type must be covered by the token.
6. Status and files are restricted to the client that created the job.
7. A fresh token from the same client is allowed only when it still covers the whole job.
8. Output URLs do not contain credentials.
9. Output files require bearer authorization.
10. Artifacts are integrity checked before delivery.
11. Production local storage is forbidden.
12. Production object lifecycle cleanup must be explicitly confirmed.
13. Cancellation prevents an in-flight worker from publishing a cancelled job.
14. Export jobs cannot become general CarePoint API credentials.

## Validation

`services/api/scripts/slice1010-smoke.mjs` validates:

- CapabilityStatement `slice-10.10` and `$export` advertisement;
- backend-only kick-off;
- required `Prefer: respond-async`;
- unsupported resource rejection;
- resource-scope enforcement;
- future `_since` rejection;
- `ndjson` output-format normalization;
- `202 + Content-Location` kick-off;
- same-client status enforcement;
- full-job scope enforcement during status/download;
- asynchronous polling guidance;
- completed manifest and expiry header;
- protected Patient and Appointment NDJSON downloads;
- resource-type purity of each file;
- `meta.lastUpdated` generation;
- `_since` incremental export behavior;
- no-token download denial;
- bearer-free manifest URLs;
- cancellation and post-cancel `404`;
- bulk-export audit events.

The dedicated Slice 10 workflow runs the complete interoperability suite from Slice 10.0 through Slice 10.10.

## Explicit non-goals

Slice 10.10 does not add:

- `system/*.rs` wildcard authorization;
- bulk export of the full CarePoint clinical graph;
- Group-level `$export`;
- Patient-level `$export`;
- `_typeFilter`;
- `includeAssociatedData`;
- `organizeOutputBy`;
- partial manifests;
- multiple files per resource type;
- streaming/multipart generation;
- Parquet or CSV output;
- public/capability download URLs;
- FHIR writes;
- long-lived backend bearer tokens;
- backend refresh tokens;
- dynamic client registration;
- formal Bulk Data certification/conformance claim.

Those capabilities require separate scaling, privacy and authorization acceptance criteria.
