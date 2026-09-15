# F3 - Unbooked-patient requests and in-app availability centre

Tracker: #143. PR: #141. Functional branch: `feature/functional-expansion-care-journeys`.
F2 baseline: `dbc8afa9137a5e92f2bb9daba8e6c2b37de8d4b3`.
This increment is not promotion to Release 1/main, a production deployment or go-live approval.

## Patient journey

A patient without an existing appointment selects a service/modality in discovery, opens its available times and selects **Request availability**. The request records a date interval and an explicit, initially unchecked agreement to in-app notices. It creates neither a booking, an invoice nor a payment. One active request is allowed per patient/service/modality; changing its interval requires an explicit withdrawal first. There are at most 20 active requests per patient, a maximum 62-day interval, and a one-year horizon.

The patient home screen opens **Availability centre**, with **My requests** and **Availability notices** views. Requests and the latest availability observation are stored on the server. The centre displays observation time, count, read/unread state and request status. Checking an unchanged result retains its notice ID, version and read state. A changed set of openings creates a new version of the same notice and resets its read marker. A stale read action cannot mark a newer version read.

**Checks are user initiated.** Select **Check availability** to obtain and persist a new observation. Merely opening the centre does not run a background matching job. There is no push/SMS/email delivery, background worker, exclusive offer, clinical triage, FIFO guarantee, slot hold or automatic booking in F3. Every notice explicitly states that availability may change and must be rechecked.

**Review available times** retrieves current matching slots for that request. Selecting a slot refreshes it and the current service/price/clinic details again before the existing contextual confirmation. Home visits still collect and validate address, coordinates, contact and coverage through the existing booking flow. Confirmation submits the original booking API with an optional request reference. An immutable in-memory retry keeps the original request ID, slot, body and idempotency key after an ambiguous result. Reconciliation for F3 replays this exact request rather than treating any booking in the same slot as success.

All labels support EN/AR/FR/ES, Arabic RTL, and dd/mm/yyyy display. Existing F1 discovery, contextual booking and provider agenda, and F2 rescheduling/earlier-appointment requests remain available. The F2 provider aggregate demand screen still reports F2 earlier-appointment demand; F3 is not claimed to expand that screen.

## Data and transaction boundaries

- `PatientAvailabilityRequest`: immutable patient/provider/service/modality/window/notice opt-in scope; WAITING, FULFILLED, WITHDRAWN or EXPIRED; private active-key and accepted-request fingerprints.
- `PatientAvailabilityNotice`: one persisted latest observation per request, bounded matching count, version and read time; no patient address, contact or clinical narrative.
- Both are added by migration `20260911161500_f3_availability_requests` with foreign keys, uniqueness, state/window constraints and lifecycle triggers.
- Identity is derived from the authenticated principal. The six request routes require patient permissions, separately enforce ownership and return no-store responses. Public DTOs omit internal patient IDs, keys and fingerprints.
- Matching is bounded to the first 100 results with a truncation indication, excludes full/blocked/past slots, active unavailability exceptions and overlapping patient appointments, and checks current service/provider/modality and clinic state. Matches are observations, not guaranteed reservations.
- Request-bound booking locks and validates the owned active request inside the same Serializable transaction as capacity, appointment, pricing/invoice triggers, visit context and audit/SIEM enqueue. If a later step fails, the request receipt and fulfilment are rolled back as well.
- An appointment trigger fulfils matching requests for ordinary bookings and date changes too. Cancellation does not reopen a fulfilled request. Withdrawal closes the request notice, not an appointment. Expiry is enforced at read/accept time even before a later join persists the EXPIRED state.
- F2 raw row-lock serialization/deadlock failures are now explicitly included in bounded whole-transaction retries. PostgreSQL integration tests exposed the P2010/SQLSTATE 40001 case which the earlier in-memory suite had not measured.

## API additions

| Method | Route | Meaning |
| --- | --- | --- |
| POST | `/availability-requests` | Explicitly create or replay an active request |
| GET | `/availability-requests?page=1&view=requests` | Paginated owned requests; use view=notices for active observations |
| POST | `/availability-requests/:id/refresh` | Check and persist the latest observation |
| GET | `/availability-requests/:id/matches` | Retrieve current matching times and contextual service information |
| POST | `/availability-requests/:id/read` | Mark exactly the supplied notice version read |
| POST | `/availability-requests/:id/withdraw` | Withdraw idempotently without cancelling a booking |

The existing `/bookings` accepts `availabilityRequestId` for an explicit request-bound booking. Existing clients without the field retain their original journey.

## Verification and rollout

The new **Availability Journeys PostgreSQL** workflow checks out the exact PR head, verifies the existing dependency graph, builds compiled services and applies migrations in an isolated PostgreSQL 16 database. It exercises real database constraints, concurrent requests, capacity races, rollback after an injected post-audit failure, history immutability, notice state and financial equality with non-empty synthetic payment/receipt/ledger rows. These are compiled-service integration tests against PostgreSQL, not full mobile-to-HTTP end-to-end tests or real gateway settlement tests. Injected audit failure is a test collaborator, not a production failure switch.

Flutter tests cover model immutability, shared authenticated transport, explicit request consent, invalid dates, ambiguous-result retries, fresh slot review, notice/read/withdrawal actions, stale response ordering and Arabic RTL. Existing CI/security/recovery/FHIR/container/native and evidence-contract workflows remain enabled. Exact-head outcomes and counts are recorded in the PR/issue only after execution; historical green results are not inherited.

Apply additive migrations before enabling these endpoints. Application rollback must preserve request/audit/history records; do not drop history tables or disable triggers to make a rollback pass. No dependency upgrades or production policy exceptions are introduced.

## Remaining scope

Physical-device UAT, signed publication, environment/provider acceptance and external/human launch approvals remain outstanding. Persistent mobile pending-booking recovery across process termination is not part of this increment; requests/notices/read state survive on the server. The new request/notice tables contain scheduling information and require explicit inclusion in the approved operational retention policy before production use; this increment does not assert a new statutory retention duration or automatically purge those records. Production configuration, performance at scale, independent security review and automatic notifications remain separate work.
