# F4 - Automatic availability detection and consent-scoped in-app alerts

Tracker: #144. Functional lane: `feature/functional-expansion-care-journeys`. F3 validated baseline: `ab1e90643855ad808821ea3cfc916c449d21eddb`. No merge or production deployment.

## Functional behaviour

F4 turns the existing F3 availability request into a periodically evaluated request. A bounded worker finds active, unexpired requests with the exact F3 in-app consent version and runs the same F3 matching/observation service used by manual **Check availability**. It therefore inherits service/provider/modality state, availability exceptions, patient/provider overlap exclusion, clinic-context requirements, home/telemedicine rules and the 100-result bound instead of defining a second matching engine.

When an observation first becomes available, or its actual set of matching slot identifiers/times materially changes while still available, the persisted F3 notice version changes. F4 creates one durable notification for each available semantic version. If the observation is unchanged, it does not duplicate the event and does not reset the F3 read marker. An available-to-empty transition persists the new inactive observation but does not send a positive availability alert. If availability later returns, the new version can alert once again.

A manual refresh may discover availability before the automatic worker. `lastNotifiedVersion` is separate from `version`, so the next scan can notify that already-observed available version exactly once. This is also the recovery path after a process failure between observation and alerting.

The notification is classified in the existing notification subsystem as `CARE_COORDINATION` with entity type `AVAILABILITY_REQUEST` and availability-specific safe template keys. This deliberately avoids widening the shared cross-client event enum merely for transport; product clients can distinguish it by entity type/template. The request ID is an opaque scheduling identifier, and no patient name/contact/address/clinical narrative is put in the notification payload.

## Consent and delivery boundary

F3 consent `IN_APP_AVAILABILITY_V1` authorises **only IN_APP availability notification** in F4. The worker reuses `NotificationsService.enqueueAccountInTransaction` so deduplication, notification storage and the existing outbox remain canonical, then deletes PUSH/EMAIL/SMS delivery rows inside the same uncommitted transaction. Consequently an external row can never become visible to the outbox, even if the user's general notification preferences enable external channels. This is intentionally stronger than relying on external-channel preferences being off by default.

No background process books or reserves a slot. A notification is an observation, not an offer or guarantee. The patient still opens the existing F3 centre, obtains current matches, reviews current service/price/context and explicitly confirms through the request-bound booking transaction. There is no FIFO/clinical priority, exclusive hold, automatic booking, SMS, email or push availability alert in this increment.

## Concurrency and durability

The worker scan is bounded and deterministic. Each selected request is refreshed through the existing F3 Serializable/row-lock boundary. Event creation, removal of external delivery rows and advancement of `lastNotifiedVersion` occur together in a second Serializable transaction that locks the current request and notice and rechecks request status, expiry and consent. A deterministic dedupe key (`availability-request:<request>:v<version>`, namespaced by account in NotificationsService) provides an additional uniqueness boundary.

If the observation transaction succeeds but event creation fails, `lastNotifiedVersion` remains behind and the next scan retries that available version. If the request becomes FULFILLED, WITHDRAWN or expired before the alert transaction, no event is produced. F3 booking/withdrawal triggers continue to close active notice state.

Migration `20260911185000_f4_automatic_availability_notifications` adds only `lastNotifiedVersion`, its integrity constraint and worker scan indexes. It does not rewrite F3 history. `lastNotifiedVersion` must remain between zero and the semantic notice version.

## Configuration

The worker is disabled unless `AVAILABILITY_NOTIFICATION_WORKER_ENABLED=true`. This keeps an unapproved background workload from becoming an accidental production policy. When production activation is later approved, both `AVAILABILITY_NOTIFICATION_SCAN_INTERVAL_MS` and `AVAILABILITY_NOTIFICATION_BATCH_SIZE` are mandatory explicit settings. Source defaults exist for non-production/test use only; engineering does not claim they are an approved KSA/GCC service level. Scan interval is bounded to 1 second through 24 hours and batch size to 1 through 200.

## Acceptance

The dedicated PostgreSQL acceptance extends the existing Availability Journeys workflow without removing the F2/F3 suite. It verifies no-alert empty observations, available-version alerts, unchanged deduplication/read preservation, changed-set re-alerting, available-to-none silence and later return; explicit IN_APP-only rows even when general external preferences are enabled; manual-refresh handoff; concurrent workers; enqueue rollback/retry; terminal/expired suppression; production configuration validation; bounded scan execution; and the database notified-version constraint.

Exact commit/run identifiers and observed pass counts are recorded only after GitHub Actions executes the candidate. Committed tests are not themselves pass evidence.

## Deferred blockers

Production cadence/batch capacity, approved notification copy, scheduling-data retention treatment, signed mobile publication, physical-device/deployed E2E, external delivery-channel consent and provider contracts, performance sizing, independent security/regulatory acceptance and go-live approval remain later readiness work. F4 does not weaken or relabel those blockers.
