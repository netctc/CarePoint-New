# Transport Phase 19 — One-Time Secure Admin Download Grants

Branch: `feature/transport-report-secure-download-phase19-20260930`

## Objective

Phase 19 allows an authenticated CarePoint ADMIN to retrieve a successful Transport
management-report CSV while the artifact remains in private CarePoint object storage.

No public URL or cloud signed URL is created.

## Download grant

Endpoint:

`POST /admin/transport/report-runs/:runId/download-grant`

Requirements:

- caller has `TRANSPORT_OPERATE`
- report run is `SUCCEEDED`
- private artifact metadata exists

The API generates 256 bits of random token material.

Only the SHA-256 token hash is stored in PostgreSQL.

Grant properties:

- bound to one report run
- bound to the requesting ADMIN account
- expires after five minutes
- one-time use
- prior active grants for the same run/account are invalidated
- token is returned once in the JSON response
- token is not placed in a URL or query string

Persisted model:

`TransportManagementReportDownloadGrant`

## Download endpoint

`POST /admin/transport/report-runs/:runId/download`

Body:

`{ "grantToken": "..." }`

The grant must:

- match the report run
- belong to the authenticated ADMIN
- be unconsumed
- be unexpired

Grant consumption is atomic.

After grant consumption the server reads the private artifact and verifies:

- SHA-256
- byte length, when persisted

Only after integrity validation are the CSV bytes returned.

## Admin proxy

The Admin application reuses its bounded binary backend proxy.

Phase 19 extends it to support:

- authenticated POST binary forwarding
- same-origin enforcement
- JSON grant-token request body
- bounded backend bytes
- private/no-store response headers
- content-disposition forwarding

The grant token never appears in the browser URL.

## Browser flow

The Admin UI performs:

1. POST download-grant
2. receive one-time token
3. POST token to binary download endpoint
4. receive CSV blob
5. trigger a local browser download
6. revoke the temporary browser blob URL

The browser blob URL is local process memory only and is not an object-storage,
public, or cloud signed URL.

## Security boundaries

Phase 19 does not:

- issue public artifact URLs
- issue cloud signed URLs
- expose object-storage credentials
- store plaintext grant tokens
- place grant tokens in query strings
- allow grant reuse
- bypass ADMIN session authentication
- bypass `TRANSPORT_OPERATE`

## Integrity failure

If private storage content does not match persisted artifact SHA-256/byte evidence:

- bytes are not returned
- the one-time grant remains consumed
- an audit failure event is written
- the caller must request a new grant after the storage issue is resolved

## Audit evidence

Events include:

- `ADMIN_TRANSPORT_REPORT_DOWNLOAD_GRANT_ISSUED`
- `ADMIN_TRANSPORT_REPORT_DOWNLOADED`
- `ADMIN_TRANSPORT_REPORT_DOWNLOAD_FAILED`
- `ADMIN_TRANSPORT_REPORT_DOWNLOAD_INTEGRITY_FAILED`

Audit metadata never contains the plaintext grant token.

## Environment

No new environment variables.

No `.env` file is added.

Phase 19 reuses the existing private object-storage configuration and ADMIN session
authentication.

## Database migration

`20261001002000_v2_transport_report_download_grants`

## Validation

`npm run v2:transport-phase19`

The smoke contract verifies:

- one-time grant model
- token hash uniqueness
- five-minute TTL
- 256-bit token generation
- no plaintext token persistence
- account/run binding
- atomic consumption
- SHA-256 and byte-length validation
- POST same-origin binary forwarding
- no token query parameter
- Admin secure-download UI
- no public/signed URL generation
