# Phase C7 - Durable Notification Outbox

## Purpose

Phase C7 closes the notification reliability gap that remained after Slice 7 and the production-readiness phases C1-C6.

C7 starts from the fully documented and validated Phase C6 head `69eb14164b1db145ae3fc04ba74dd40ac2b9e353`.

Before C7, CarePoint persisted PHI-neutral `NotificationEvent` rows, but external delivery still happened inline in the API request. More importantly, secure-message and care-participant business writes committed before notification creation. A process failure in that interval could persist the clinical/care-coordination action while permanently losing its notification event. Partial channel delivery also had no durable retry engine.

C7 makes PostgreSQL the durable source of truth for notification work and removes external notification delivery from the request critical path.

## Transactional boundary

For secure messages, the application now performs the following in one PostgreSQL transaction:

```text
CareMessage + attachments + sender receipt + conversation timestamp
                         |
                         +--> NotificationEvent per recipient
                         |       |
                         |       +--> IN_APP delivery work item
                         |       +--> PUSH delivery work item
                         |       +--> EMAIL delivery work item
                         |       +--> SMS delivery work item
                         |
                         +--> COMMIT
```

If the transaction rolls back, neither the message nor its notification work is visible. If it commits, every recipient has a durable event and four channel work items before the request can return.

Care-team participant admission uses the same pattern: participant persistence and the target/patient coordination notification work are committed atomically.

Conversation creation with an initial message delegates to the same secure-message path, so the initial message receives the same transactional guarantee.

## Event and delivery model

`NotificationEvent` remains PHI-neutral and stores only:

- recipient account identifier;
- account-scoped idempotency/dedupe key;
- safe notification type;
- internal entity type/reference;
- safe title template key; and
- safe body template key.

C7 materializes four `NotificationDelivery` rows for every event:

- `IN_APP`;
- `PUSH`;
- `EMAIL`; and
- `SMS`.

Each delivery now has durable processing state:

- `status`;
- `attemptCount`;
- `availableAt`;
- `leaseOwner`;
- `leaseUntil`;
- `attemptedAt`;
- `sentAt`;
- `providerRef`; and
- sanitized `lastErrorCode`.

The unique `(notificationId, channel)` constraint prevents duplicate work-item creation when idempotent business requests are replayed.

## Delivery-time routing

Preferences and external endpoint references are resolved when the worker processes a delivery, rather than copied into the outbox row.

This keeps the durable outbox PHI-minimal and means current user preferences govern an undelivered item:

- `IN_APP` defaults enabled;
- `PUSH`, `EMAIL` and `SMS` default disabled unless the user enabled them;
- email destinations come from the current CarePoint account email;
- push/SMS destinations come from the current active opaque endpoint reference.

A disabled channel or an enabled external channel with no current destination becomes `SKIPPED`, not a retry failure.

## Leased worker

`NotificationOutboxWorkerService` is an in-process durable worker in C7. It polls PostgreSQL for due `PENDING` deliveries and atomically claims work with a lease.

Key properties:

- only one worker instance can hold a valid lease for a delivery at a time;
- `attemptCount` increments on successful claim;
- expired leases make abandoned work recoverable after a process crash;
- work is processed in bounded batches;
- an immediate wake-up is requested after a transaction commits, while periodic polling remains the durability fallback; and
- worker-loop failures do not terminate the API process or delete durable work.

C7 requires a minimum lease of 60 seconds. The notification gateway permits at most a 30-second external request timeout, leaving a safety margin before another worker may reclaim the same delivery.

## Retry and terminal failure

External delivery failures keep the row `PENDING` until the configured maximum number of attempts is reached.

Retry delay uses bounded exponential backoff:

```text
retryBaseSeconds * 2^(attemptCount - 1)
```

with a maximum delay of 15 minutes.

After `NOTIFICATION_MAX_ATTEMPTS`, the delivery becomes terminal `FAILED` and CarePoint writes a PHI-neutral `NOTIFICATION_DELIVERY_EXHAUSTED` audit event.

The outbox stores only a sanitized error class/code such as `BadGatewayException` or `Error`; raw provider response bodies, transport messages, tokens or endpoint values are not persisted.

## Idempotency semantics

The external gateway already sends an idempotency key formed from:

```text
notificationId:channel
```

A retry therefore uses the same provider idempotency key for the same durable delivery.

The application provides at-least-once delivery attempts. Exactly-once side effects require the external notification provider to honor this idempotency key. Provider idempotency behavior must be part of production integration acceptance.

## Gateway hardening

C7 adds a startup/configuration boundary for the notification gateway:

- production forbids the mock gateway;
- production external delivery requires an API key;
- production gateway URLs require HTTPS;
- loopback production targets are rejected;
- embedded URL credentials are rejected;
- API keys containing CR/LF or excessive length are rejected;
- `NOTIFICATION_GATEWAY_TIMEOUT_MS` is bounded between 100 ms and 30 seconds; and
- network/transport failures are surfaced to the worker as generic exceptions without provider response content.

The real API key remains a runtime secret and must never be committed to the repository.

## Worker configuration

C7 supports:

```text
NOTIFICATION_WORKER_ENABLED=true
NOTIFICATION_WORKER_POLL_MS=1000
NOTIFICATION_WORKER_LEASE_SECONDS=60
NOTIFICATION_WORKER_BATCH_SIZE=25
NOTIFICATION_MAX_ATTEMPTS=5
NOTIFICATION_RETRY_BASE_SECONDS=5
NOTIFICATION_GATEWAY_TIMEOUT_MS=10000
```

Production forbids `NOTIFICATION_WORKER_ENABLED=false` while C7 uses the in-process worker architecture.

A future dedicated worker deployment may separate API and worker processes, but that change must introduce an explicit deployment/ownership mode rather than silently disabling notification processing.

## Deterministic C7 acceptance

`services/api/scripts/c7-notification-outbox-smoke.mjs` validates the worker without a database or external network dependency. It covers:

- worker defaults and environment bounds;
- production rejection when the in-process worker is disabled;
- lease minimum enforcement;
- IN_APP local completion without an external gateway call;
- disabled channels becoming `SKIPPED`;
- missing destinations becoming `SKIPPED`;
- successful external delivery and provider-reference persistence semantics;
- transient failures being requeued with future availability;
- terminal failure after max attempts;
- raw provider error text not being persisted or audited;
- production mock-gateway rejection;
- missing external gateway credentials/configuration;
- HTTPS and loopback enforcement;
- embedded gateway-URL credential rejection;
- bounded gateway timeout; and
- valid safe external configuration.

The C7 smoke is chained after C3-C6 in the API workspace test gate.

## Slice 7 integration acceptance

The existing Slice 7 integration smoke is updated for asynchronous delivery. It no longer assumes that an external push completes before the message request returns.

For the secure provider reply it waits within a bounded acceptance window until all four durable channel rows leave `PENDING`, then verifies:

- exactly one recipient notification exists despite message replay;
- exactly four durable channel rows exist;
- `IN_APP` and the enabled mock `PUSH` channel reach `SENT`;
- disabled `EMAIL` and `SMS` channels reach `SKIPPED`;
- every processed row records at least one attempt;
- terminal rows have no active lease;
- the mock push provider reference is persisted in PostgreSQL;
- destination endpoint references remain absent from API presentation; and
- notification persistence contains no secure-message or attachment plaintext.

## Production operational evidence still required

C7 makes notification work durable inside CarePoint, but production launch still requires evidence outside the application code:

- provider-side idempotency guarantees for the `notificationId:channel` key;
- provider SLA, regional availability and failover behavior;
- API-key issuance, secret rotation and revocation;
- APNs/FCM token lifecycle, invalid-token deactivation and device replacement handling;
- SMS sender registration and country-specific regulatory approval;
- email sender-domain authentication and reputation controls;
- dashboards for pending age, retry volume and terminal failures;
- alerts on `FAILED` deliveries and abnormal queue age;
- SIEM routing for terminal-delivery security/operational events;
- load/soak tests for expected notification fan-out and provider latency;
- disaster-recovery validation showing PostgreSQL outbox rows survive failover/restore; and
- data-residency/compliance review for notification providers used in KSA/GCC markets.

C7 deliberately does not claim that external notification-provider infrastructure or SIEM integrations are deployed.
