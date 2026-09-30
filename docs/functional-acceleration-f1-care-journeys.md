# Functional acceleration F1 - Patient and Provider care journeys

Tracker: #140. Development branch: `feature/functional-expansion-care-journeys`.
Base: `cdfe736bd75aae27f6564215c0af0db832f5ff3d`.

## Scope and sequencing

Product direction dated 11/09/2026 prioritises pending user-facing functionality before external go-live acceptance. F1 is a separate functional lane; it does not change `main` or the validated Release 1 branch. Existing authentication, MFA, provider capability, consent, clinical-data and production preflight controls remain in place.

## Patient functionality

- Structured discovery uses `/services/discovery`, not the legacy text-only search: provider name/text, medical specialty, non-doctor category, provider class, service, modality and location.
- Specialty and provider-category selections come from existing live catalogs. Incompatible doctor/non-doctor filters are cleared deliberately.
- Results support pagination and ignore stale responses after newer searches or route disposal.
- Each service exposes selectable supported modalities and the corresponding price/currency.
- Clinic booking shows the configured location and arrival instructions; home booking collects address, country, coordinates, contact and explicit address/contact confirmations.
- The final confirmation names the service, provider, modality, date/time, price and applicable physical context.
- One booking intent captures an immutable request and random idempotency key. Network/timeout/5xx ambiguity preserves the intent for retry or appointment reconciliation, rather than silently issuing a new booking.
- Visit lists separate upcoming, history and cancelled visits, support local service/provider filtering, show persisted visit context and retain telehealth entry and confirmed cancellation.
- Emergency and scheduled transport entry points, clinical timeline, account/consent and finance workspaces remain accessible.

## Provider functionality

Doctor and Other Provider apps expose a labelled workspace-action menu. It preserves finance, communications, account/security and transport navigation and adds an agenda workspace after existing credential/capability gates.

The agenda supports:

1. Listing, creating, activating and deactivating provider locations.
2. Linking a clinic service to an owned active location and arrival instructions.
3. Configuring centre/radius coverage for home visits.
4. Listing and creating recurring rules with explicit IANA time zone, weekday, effective dates, capacity and before/after buffers.
5. Explicit slot generation over a bounded date range.
6. Listing, creating, activating and deactivating unavailability/vacation exceptions.
7. Browsing paginated owned slots, including blocked slots, and invoking the existing explicit block/unblock operations.

Disabling an exception does not automatically reopen slots. Existing server-side conflicts, ownership and capability enforcement remain authoritative.

## New backend surface

`GET /api/v1/provider/availability/inventory` requires `PROVIDER_MANAGE_AVAILABILITY` and an active Doctor/Other Provider identity. The provider ID is derived only from the authenticated account; clients cannot select another provider. Date range and pagination are bounded. The projection returns operational slot fields and service name only, never appointments, patients, clinical content or credential records. No database migration is introduced.

## Engineering acceptance

New Node controller tests cover role denial, inactive/missing provider denial, owner binding, Other Provider binding, invalid ranges/pages, bounded deterministic pagination and PHI-neutral selection.

New Flutter tests cover date/time parsing, visit classification, immutable booking intents, stale-request ordering, all four translation columns, structured discovery transport, contextual booking retry identity, shared session refresh, provider routes, patient denial, unapproved confirmations and Arabic RTL forms. They run in the existing shared-mobile test job. Node tests are included in the permanent API test command.

Exact-SHA CI/native compatibility outcomes must be recorded on #140 / its PR. Source delivery is not asserted to be complete until those checks finish.

## Deliberate boundaries

This increment does not implement every post-MVP feature. Family/dependent accounts, waitlist automation, advanced care plans and other new product families require subsequent increments. It adds functional screens rather than new external-provider contracts.

Coordinates are displayed as selectable text; no unapproved mapping/geocoding provider is selected. Address confirmation is a user assertion, not certification by a third-party address authority.

Booking retry intent is retained in memory for the current route, not persisted with home-address/contact data to device preferences. Forced app termination requires checking existing visits before creating another request. Signed builds, physical-device UAT and external acceptance remain separate tasks, not prerequisites for continuing this functional branch.

This change does not authorise a production deployment, clinical certification or merge into the release branch/main.
