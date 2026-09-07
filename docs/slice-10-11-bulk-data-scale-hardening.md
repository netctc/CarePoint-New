# Slice 10.11 — FHIR Bulk Data Scale & Production Hardening

## Purpose

Slice 10.11 hardens the Slice 10.10 asynchronous FHIR Bulk Data export path without weakening the existing SMART backend-services authorization boundary.

The slice deliberately keeps the exportable resource set at `Patient` and `Appointment`. Additional clinical resources in CarePoint are backed by encrypted domain services (`ClinicalService`, `OrdersService`, `DocumentsService`) and are not exported directly from Prisma in this slice. This avoids bypassing established decryption, integrity, release and audit controls.

## Supported kickoff

`GET /api/v1/fhir/R4/$export`

Requirements remain:

- SMART backend-services access token.
- `Prefer: respond-async`.
- Explicit system read/search scopes for every exported resource type.
- JSON-compatible kickoff response negotiation.

Supported parameters:

- `_type=Patient,Appointment`
- `_since=<FHIR instant>`
- `_outputFormat=application/fhir+ndjson` (aliases `application/ndjson` and `ndjson` normalize to the canonical media type)
- repeatable `_typeFilter`

## Strict `_typeFilter` subset

CarePoint does not attempt to implement arbitrary FHIR search expressions inside `_typeFilter`.

Supported forms are intentionally explicit:

- `Patient?_id=<id>[,<id>...]`
- `Appointment?patient=Patient/<id>`
- `Appointment?status=<FHIR appointment status>[,<status>...]`
- `Appointment?patient=Patient/<id>&status=<status>[,<status>...]`

Rules:

- At most one `_typeFilter` is accepted for each resource type.
- A filter may only reference a resource type that is part of the current export resource set.
- Patient `_id` supports at most 100 distinct ids.
- Appointment status values are limited to the statuses already supported by the CarePoint FHIR facade: `pending`, `booked`, `cancelled`, `fulfilled`, `noshow`, `entered-in-error`.
- Unknown nested search parameters are rejected with a FHIR `OperationOutcome`; they are never silently ignored.
- Repeated nested parameters are rejected.
- Filter strings are bounded in length.

The accepted filter is normalized and stored in the transient Redis job state. It is also represented in the completed manifest `request` URL. No bearer token, client assertion or secret is placed in that URL.

## Deterministic NDJSON partitioning

Slice 10.10 produced a single NDJSON object per resource type. Slice 10.11 partitions large result sets into deterministic files.

Default file bound:

- `BULK_EXPORT_MAX_RESOURCES_PER_FILE=1000`

Allowed configuration range:

- `1..5000`

New file names are deterministic:

- `Patient-00001.ndjson`
- `Patient-00002.ndjson`
- `Appointment-00001.ndjson`
- etc.

The manifest can therefore contain multiple `output` entries for the same FHIR resource type. Each entry includes the resource count for that file.

The download endpoint validates the exact job/file association before retrieving the private object and still verifies byte length plus SHA-256 before sending the NDJSON response.

For transient compatibility with jobs created by Slice 10.10, the parser also recognizes legacy `Patient.ndjson` and `Appointment.ndjson` artifact names while those Redis jobs remain alive.

## Export safety limits

Existing per-type protection remains:

- `BULK_EXPORT_MAX_RESOURCES_PER_TYPE`
- default `10000`
- hard maximum `50000`

Slice 10.11 additionally adds:

### Total resources

`BULK_EXPORT_MAX_TOTAL_RESOURCES`

- default `20000`
- hard maximum `100000`

The total limit is evaluated after supported `_typeFilter` narrowing. The existing per-type source safety limit is evaluated by the snapshot layer before serialization.

### Total NDJSON bytes

`BULK_EXPORT_MAX_TOTAL_BYTES`

- default `67108864` (64 MiB)
- hard maximum `536870912` (512 MiB)

If the limit would be exceeded, already-written artifacts for the job are removed and the job transitions to a safe failed state.

## Snapshot and asynchronous execution

The Slice 10.10 snapshot contract remains unchanged:

- PostgreSQL `REPEATABLE READ` transaction.
- consistent Patient/Appointment view for the job.
- `_since` is applied inside the database snapshot.
- `_typeFilter` then narrows the already-authorized FHIR resources before serialization.

Redis continues to hold transient job state and distributed processing locks. Polling a queued/running job can retrigger processing, while the lock prevents concurrent processors for the same job.

## Completed manifest

The completed response now includes the normalized `request` field in addition to the existing CarePoint compatibility properties.

Security properties remain:

- `requiresAccessToken: true`
- output URLs never contain bearer credentials
- status/download requires the originating SMART backend client
- the current token must still cover every resource type in the original job
- output artifacts expire with the job retention policy

## Storage

Production requirements from Slice 10.10 remain:

- production local storage is forbidden
- S3-compatible storage requires protected server-side encryption/KMS configuration
- `BULK_EXPORT_STORAGE_LIFECYCLE_CONFIRMED=true` is required so the deployment fails closed unless the export prefix is covered by an expiration lifecycle policy
- logical retention defaults to 24 hours and is capped at 7 days

## Audit

Existing audit events remain, including:

- `FHIR_BULK_EXPORT_KICKOFF`
- `FHIR_BULK_EXPORT_STATUS`
- `FHIR_BULK_EXPORT_COMPLETED`
- `FHIR_BULK_EXPORT_FILE_DOWNLOADED`
- `FHIR_BULK_EXPORT_CLIENT_DENIED`
- `FHIR_BULK_EXPORT_CANCELLED`
- `FHIR_BULK_EXPORT_FAILED`
- `FHIR_BULK_EXPORT_INTEGRITY_FAILURE`

Slice 10.11 completion metadata additionally records normalized type filters, deterministic file names, counts, byte lengths and SHA-256 values. Raw NDJSON and bearer credentials are not written to the audit log.

## Acceptance coverage

`services/api/scripts/slice1011-smoke.mjs` validates:

- CapabilityStatement version `slice-10.11`.
- explicit `_typeFilter` documentation.
- rejection of unsupported nested filter parameters.
- rejection of filter/resource-set mismatch.
- rejection of duplicate filters for one resource type.
- repeated top-level `_typeFilter` parsing.
- exact Patient `_id` subset.
- exact Appointment `patient` + `status` subset.
- normalized manifest `request` without bearer leakage.
- deterministic partition naming.
- maximum 1000 resources per default output file.
- full reconstruction of a >1000 Patient export from multiple protected NDJSON files.
- audit evidence.

The dedicated workflow continues to run all Slice 10.0–10.10 regression smoke tests before Slice 10.11.

## Explicit non-goals

Slice 10.11 does **not** add:

- arbitrary `_typeFilter` FHIR searches
- Group export
- Patient-level `$export`
- wildcard `system/*` scopes
- Encounter/Observation/MedicationRequest/ServiceRequest/DiagnosticReport bulk export
- DocumentReference or ImagingStudy bulk export
- Parquet or CSV output
- streaming multipart responses
- FHIR writes
- a formal HL7 certification/conformance claim

Clinical expansion should be implemented only through the existing encrypted domain-service boundaries rather than by reading encrypted persistence rows directly.
