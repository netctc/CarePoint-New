# Transport Phase 20 — Recipient Report Inbox + Download Receipts

Branch: `feature/transport-report-recipient-inbox-phase20-20260930`

## Objective

Phase 20 gives each authorized ADMIN recipient a private management-report inbox and
records durable evidence when that recipient retrieves a report through the Phase 19
one-time secure download flow.

## Recipient inbox

Endpoint:

`GET /admin/transport/report-inbox`

The inbox is scoped to:

`destination.recipientAccountId = current principal.accountId`

Only delivery records with notification status:

`SENT`

are returned.

The response includes operational report metadata needed by the recipient:

- delivery ID
- notification timestamp
- destination label/channel
- run ID
- scheduled timestamp
- report filename
- row count
- artifact SHA-256/byte evidence
- artifact stored-at timestamp
- prior download receipt

The response does not include:

- object-storage key
- patient identity
- patient contact
- pickup address
- destination address
- coordinates

## Download receipt

`TransportManagementReportDelivery` adds:

- `downloadedAt`
- `downloadedByAccountId`

After Phase 19 successfully:

1. consumes the one-time grant;
2. reads the private artifact;
3. verifies SHA-256;
4. verifies byte length;

the service records a receipt only for SENT delivery records whose destination belongs to
the authenticated ADMIN account.

A download performed by another authorized Transport administrator does not create a
recipient receipt for someone else.

## Durable receipt semantics

The first successful recipient download sets:

- `downloadedAt`
- `downloadedByAccountId`

Subsequent downloads may issue new one-time grants but do not overwrite the original
receipt timestamp.

Audit metadata records the number of recipient delivery receipts written for the
successful download.

## Admin UI

The report-delivery panel now includes:

`My Report Inbox`

It shows only report-ready deliveries addressed to the current ADMIN account.

Each inbox row provides:

- notified timestamp
- report filename
- row count
- download receipt state
- Secure download action

The action reuses the Phase 19 flow:

1. request one-time grant
2. POST grant token same-origin
3. receive verified CSV bytes
4. create temporary local browser blob
5. download
6. revoke blob URL
7. reload inbox receipt state

## Privacy

The inbox explicitly reports:

- `patientIdentityIncluded: false`
- `patientLocationIncluded: false`
- `objectStorageKeyIncluded: false`

## Environment

No new environment variables.

No `.env` file is added.

## Database migration

`20261001003500_v2_transport_report_recipient_inbox`

## Validation

`npm run v2:transport-phase20`

The smoke contract verifies:

- durable receipt fields and index
- recipient-scoped inbox query
- SENT-only inbox
- object-storage key exclusion
- patient/location exclusion
- download receipt update after integrity validation
- current recipient account scoping
- original receipt timestamp preservation
- Admin My Report Inbox
- one-time secure download reuse
- package test-chain registration
