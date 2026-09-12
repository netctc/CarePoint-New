# F3.1 - Provider availability demand and HTTP acceptance

Continuation of #143 and PR #141 on `feature/functional-expansion-care-journeys`.
Baseline: `6b30ecd5d738c3a1081a53d237c151618c38049a`.
No merge, deployment, external notification, new migration or dependency upgrade.

## Functional completion

The Doctor and Other Provider action menus now retain **Waiting demand** (F2: an existing appointment requested earlier) and separately offer **Availability requests** (F3: a request without a matching booking). The new page groups active F3 requests by the professional's own service and modality, showing request counts, the earliest/latest requested dates and the last refresh time. Counts represent requests, not unique people; the same person may request different services or modalities. EN/AR/FR/ES, Arabic RTL, dd/mm/yyyy and inclusive end-date display are retained.

Withdrawn, fulfilled and expired requests are excluded. A WAITING row past its end time is excluded even before a cleanup has persisted EXPIRED. Requests for a service or modality deactivated after the request remain visible, with an inactive warning, so demand is not silently lost. This flag is configuration status, not a claim that any slot is currently bookable. The page reads demand only; it neither runs patient matching nor generates notices, bookings, invoices or payments.

The read-only GET `/provider/availability-demand?page=1` accepts only bounded pagination. There is no client-supplied provider/patient/date filter. Ownership comes from the validated bearer principal. The global operational guard continues to require an ACTIVE provider, the expected provider class, current verified credentials and an active Other Provider category. The service separately enforces owner/class/status. Results have `Cache-Control: no-store` and omit patient names, IDs, contacts, request/appointment IDs and private fingerprints. Aggregation is data minimisation, not a claim of statistical anonymity in small groups.

Pagination returns 50 service/modality groups per page, with deterministic ordering and a next-page indication; a request uses a consistent Repeatable Read database snapshot. Separate page requests are live observations, not a retained cross-page snapshot, so a refresh is needed when demand changes. The mobile client deduplicates groups and discards stale responses, clears displayed data on access denial, and handles loading, empty, error and retry states.

## Verification

The CI Node job adds a real HTTP suite against the running API and PostgreSQL after the existing acceptance steps. It verifies real patient registration/login/session validation, anonymous/role/ownership denial, explicit request opt-in, idempotent request creation, notice/read versions, request-bound booking and a sanitised overlap conflict. It also verifies owned aggregate counts, withdrawal/fulfilment/expiry, inactive configuration, invalid pagination/owner injection, 51-group pagination, current licences and Other Provider category enforcement. Provider fixtures have actual VERIFIED credential records; the tests do not use the legacy zero-credential compatibility path.

Synthetic setup provisions providers/services and bulk rows directly in the isolated CI database; it is not an onboarding acceptance test. Operational patient actions travel through HTTP and production controllers/services/guards. The fixture refuses non-test environments, non-loopback API/database addresses and unexpected database names. No real medical data, external gateways or notifications are used.

New Flutter tests exercise authenticated pagination, read-only displays, all role boundaries, refresh/error/retry handling, duplicate and stale responses, Arabic narrow-screen layout and both provider menu entry points. The existing 35-case PostgreSQL suite, existing Flutter tests and all release/security/native checks remain mandatory and unchanged.

Exact commit/run identifiers and observed pass counts are recorded in PR #141 and #143 after execution. Test source is not evidence of a successful run. CI may check a virtual merge; its tree must match the feature head before attributing it to the head.

## Remaining production boundary

No automatic availability alerts, slot holds, FIFO or clinical priority claims, automatic bookings or external delivery were added. Full mobile-to-live-API end-to-end tests, physical devices, signed releases, independent security review, approved retention treatment for F3 scheduling data and human/environment go-live acceptance remain separate. Passing these automated checks does not approve production use.
