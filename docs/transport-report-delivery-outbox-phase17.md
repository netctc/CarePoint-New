# Transport Phase 17 — Delivery Destinations + Durable Delivery Outbox

Branch: `feature/transport-report-delivery-outbox-phase17-20260930`

## Objective

Phase 17 adds explicit management-report destinations and a durable delivery outbox on
top of the private Phase 16 report artifacts.

It does not yet send an artifact to an external provider.

## Destination model

`TransportManagementReportDestination`

Each destination is bound to:

- one report schedule
- one active CarePoint ADMIN account
- one channel

Phase 17 supports:

`EMAIL`

The destination stores the recipient account ID, not a duplicated email address.

This keeps destination identity tied to the authoritative CarePoint account record and
allows a later delivery adapter to resolve the current approved destination.

Unique key:

`(scheduleId, recipientAccountId, channel)`

Re-adding an inactive destination reactivates the existing record instead of creating a
duplicate.

## Recipient authorization boundary

A destination may reference only a user whose:

- role is `ADMIN`
- account status is `ACTIVE`

This matches the management-report authorization domain protected by
`TRANSPORT_OPERATE`.

Patients, doctors, Other Providers and support-only accounts cannot be configured as
Transport management-report recipients in Phase 17.

## Delivery outbox model

`TransportManagementReportDelivery`

Important fields:

- runId
- destinationId
- status
- attemptCount
- availableAt
- leaseOwner
- leaseUntil
- attemptedAt
- sentAt
- failedAt
- providerRef
- lastErrorCode

Unique key:

`(runId, destinationId)`

This makes repeated handoff preparation idempotent.

Initial status:

`PENDING`

## Handoff integration

Phase 16 endpoint:

`POST /admin/transport/report-runs/:runId/prepare-delivery-handoff`

now:

1. validates that the private artifact exists;
2. finds active destinations for the report schedule;
3. creates missing outbox records using `skipDuplicates`;
4. records the handoff-prepared timestamp;
5. updates run delivery status.

If one or more destinations exist:

`DELIVERY_OUTBOX_READY`

If none exist:

`READY_FOR_EXTERNAL_DELIVERY`

The endpoint returns:

- configured destination count
- newly queued delivery count
- artifact handoff descriptor
- `reportDeliveryPerformed: false`

## API

### List destinations

`GET /admin/transport/report-destinations`

### Create/reactivate destination

`POST /admin/transport/report-destinations`

Body:

- scheduleId
- label
- recipientAccountId
- channel = EMAIL

### Deactivate destination

`POST /admin/transport/report-destinations/:destinationId/deactivate`

### Read durable outbox

`GET /admin/transport/report-deliveries`

Outbox read state explicitly reports:

`executionMode: EXTERNAL_DELIVERY_ADAPTER_REQUIRED`

## Admin UI

The Transport administration page now includes a dedicated report-delivery panel for:

- selecting an existing schedule
- adding an active ADMIN account as a destination
- deactivating destinations
- viewing the durable delivery outbox
- viewing pending attempt counts

No "Send now" action is exposed because Phase 17 does not contain a delivery adapter.

## Delivery boundary

Phase 17 does not:

- resolve or copy recipient email into the destination model
- call the notification gateway
- send email
- send SMS
- create a public URL
- create a signed URL
- mark a delivery SENT

Those actions remain for a later secure delivery-adapter phase.

Explicit contract:

- `EXTERNAL_DELIVERY_ADAPTER_REQUIRED`
- `reportDeliveryPerformed: false`

## Database migration

`20261001000500_v2_transport_report_delivery_outbox`

## Environment

No new environment variables.

No `.env` file is added.

## Validation

`npm run v2:transport-phase17`

The smoke contract verifies:

- destination model and unique key
- durable outbox model and idempotency key
- lease/retry-ready fields
- active ADMIN recipient restriction
- no duplicated recipient email storage
- handoff outbox enqueue integration
- no provider send path
- Admin destination/outbox panel
- package test-chain registration
