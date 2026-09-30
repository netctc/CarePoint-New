# Transport Phase 16 — Secure Report Artifact Storage + Delivery Handoff

Branch: `feature/transport-report-artifact-phase16-20260930`

## Objective

Phase 16 turns a successful Transport management-report execution into a durable,
sanitized CSV artifact stored in private object storage and prepares an auditable handoff
descriptor for an external delivery mechanism.

It remains layered on Phase 15.

## Artifact generation

A Transport report run is marked `SUCCEEDED` only after:

1. the Phase 12 sanitized management report is generated;
2. the report rows are encoded as UTF-8 CSV;
3. spreadsheet formula-injection prefixes are neutralized;
4. the artifact SHA-256 and byte length are calculated;
5. the CSV is stored in private object storage;
6. artifact metadata is persisted to `TransportManagementReportRun`.

The PostgreSQL ledger stores only metadata and the existing sanitized summary snapshot.
The complete CSV bytes live in object storage.

## Object-storage domain

New provider-neutral domain:

`transport-management-reports`

Production storage reuses the already approved document bucket and customer-managed KMS
key, but uses the isolated prefix:

`carepoint/transport-management-reports`

No new bucket/key environment configuration is introduced.

Supported production runtimes:

- GCP Cloud Storage via attached service-account metadata identity
- OCI Object Storage via instance principal

Non-production uses a private local directory under `/tmp` with restrictive file modes.

## Persisted artifact metadata

Phase 16 adds:

- `artifactObjectKey`
- `artifactSha256`
- `artifactBytes`
- `artifactContentType`
- `artifactStorageProvider`
- `artifactStoredAt`
- `deliveryStatus`
- `deliveryHandoffPreparedAt`
- `deliveryHandoffPreparedByAccountId`

Initial successful artifact state:

`ARTIFACT_READY`

## Delivery handoff

Endpoint:

`POST /admin/transport/report-runs/:runId/prepare-delivery-handoff`

The endpoint is idempotent and requires a successful run with a stored artifact.

It moves the ledger to:

`READY_FOR_EXTERNAL_DELIVERY`

and returns an auditable descriptor containing:

- run/schedule ID
- private object key
- SHA-256
- byte length
- content type
- storage provider
- stored-at timestamp

It explicitly does not:

- create a public URL
- create a signed URL
- send email
- send SMS
- upload the artifact to a third-party recipient
- claim that report delivery occurred

Response boundaries remain:

- `externalDeliveryRequired: true`
- `automaticDeliveryAvailable: false`
- `reportDeliveryPerformed: false`
- `publicUrlIssued: false`

## Privacy

The artifact is built from the Phase 12 sanitized management-report dataset.

It does not contain:

- patient identity
- patient contact
- pickup address
- destination address
- coordinates

The artifact may contain non-clinical operational request/provider/timing/SLA evidence.

## Security

The object-storage domain inherits production controls already required by CarePoint:

- public access disabled
- customer-managed encryption
- approved KSA region
- attached/instance workload identity
- no static cloud credentials
- no endpoint override in production
- Cache-Control: no-store

No public artifact link is produced in Phase 16.

## CSV safety

Every cell is quoted.

Values starting with:

- `=`
- `+`
- `-`
- `@`
- tab
- carriage return

are prefixed with an apostrophe before CSV quoting to mitigate spreadsheet formula injection.

## Environment

No new environment variables.

No `.env` file is added.

Phase 16 reuses the existing approved production object-storage configuration.

## Database migration

`20260930234500_v2_transport_report_artifact_handoff`

## Validation

`npm run v2:transport-phase16`

The smoke contract verifies:

- artifact fields and migration
- dedicated object-storage domain
- GCP/OCI runtime label support
- no new environment variables
- private CSV storage service
- formula-injection mitigation
- artifact generation before run success
- artifact hash/bytes/storage metadata
- delivery-handoff endpoint and states
- no public/signed URL claim
- Admin handoff UI
- storage contract test updates
