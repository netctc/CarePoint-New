# Transport Phase 18 — Secure Report-Ready Notification Worker

Branch: `feature/transport-report-delivery-worker-phase18-20260930`

## Objective

Phase 18 processes the durable Phase 17 delivery outbox using the existing CarePoint
Notification Gateway and the same Cloud Run Job introduced in Phase 15.

The notification tells an authorized ADMIN that a Transport management report is ready.

The private CSV artifact itself is not sent to the notification provider in this phase.

## Worker flow

Each Cloud Run Job invocation now:

1. executes the Phase 15 report worker cycle;
2. recovers/queues/generates private report artifacts through Phases 14–16;
3. processes up to 25 report-delivery outbox items;
4. resolves the current recipient email from the authoritative CarePoint User record;
5. validates that the recipient remains ACTIVE and ADMIN;
6. sends a PHI-neutral report-ready EMAIL notification through NotificationGatewayService;
7. marks the outbox record SENT, SKIPPED, PENDING-for-retry, or FAILED.

## Notification payload boundary

The Notification Gateway receives only:

- notificationId = delivery outbox ID
- channel = EMAIL
- destinationRef = current ADMIN account email
- locale = en
- safeTitleKey = transport.report.ready.title
- safeBodyKey = transport.report.ready.body
- entityType = TRANSPORT_REPORT_RUN
- entityId = run ID

It does not receive:

- artifactObjectKey
- artifactSha256
- artifact bytes
- CSV content
- patient identity
- patient location
- report row data

## Delivery semantics

Phase 18 distinguishes two concepts:

### Notification delivery

Outbox status:

`SENT`

means the PHI-neutral "report ready" notification was accepted by the Notification Gateway.

### Artifact delivery

Still false:

`artifactDeliveryPerformed: false`

The private CSV remains in CarePoint-controlled object storage.

No public URL or signed URL is generated.

## Retry and lease behavior

The delivery worker uses:

- lease: 60 seconds
- maximum attempts: 5
- batch size: 25
- exponential retry base: 5 seconds
- maximum retry delay: 15 minutes

Failed work remains durable in PostgreSQL.

If maximum attempts are exhausted:

- delivery status becomes FAILED
- run delivery status becomes DELIVERY_ATTENTION_REQUIRED
- an audit event is written

When all deliveries for a run are terminal and none failed:

`DELIVERY_NOTIFICATION_COMPLETE`

## Recipient freshness

The destination table stores only recipientAccountId.

Every delivery attempt resolves the current User record and revalidates:

- role = ADMIN
- status = ACTIVE

An inactive/non-ADMIN destination is skipped rather than sent.

## Existing Notification Gateway

Phase 18 reuses the existing gateway and its existing production controls:

- external secret resolver
- bounded provider responses
- egress validation
- retry-safe idempotency
- mock provider outside production/private-pilot paths
- production mock prohibition

No new notification provider is introduced.

## Cloud Run Job

Existing command remains:

`node dist/scripts/run-transport-report-scheduler.js`

The same job now emits combined structured results:

- report generation cycle
- delivery-notification cycle
- `artifactDeliveryPerformed: false`

## Admin UI

The Phase 17 Delivery Outbox panel now states:

`REPORT_READY_NOTIFICATION_WORKER`

and clarifies that SENT refers only to the readiness notification.

## Environment

No new environment variables.

No `.env` file is added.

Phase 18 reuses the existing Notification Gateway configuration.

## Validation

`npm run v2:transport-phase18`

The smoke contract verifies:

- NotificationGatewayService is reused
- delivery worker lease/retry limits
- ACTIVE ADMIN revalidation
- PHI-neutral template keys
- gateway payload does not include artifact metadata/bytes
- Cloud Run Job invokes both report and delivery workers
- artifactDeliveryPerformed remains false
- Admin semantics are explicit
- package test-chain registration
