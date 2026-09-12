# Release 1 — Discovery, scheduling and visit-context closure (#75)

Status: **IMPLEMENTATION CANDIDATE / EXACT-SHA VALIDATION REQUIRED / MOBILE-NATIVE + MAP/ADDRESS PROVIDER UAT REMAIN RELEASE GATES**

Canonical branch: `release/release-1-integration-go-live-readiness`
Tracker: #75, R2 #74, master #70

## Approved Release 1 P0 baseline

This work closes four requirements already present in the approved CarePoint specification rather than adding post-MVP ranking or recommendation features:

- FR-SRC-001: patient search by specialty, provider type, service, modality and location.
- FR-SCH-001: recurring availability with exceptions, blocks and buffers.
- FR-CLN-001: clinic appointment location and arrival instructions.
- FR-HOM-001: home visit validated address, approximate coordinates, instructions and contact.

FR-SRC-002 ranking by next availability, distance, price or quality remains P1 and is intentionally not implemented as part of this blocker.

## Structured discovery

`GET /api/v1/services/discovery` adds an explicit deterministic Release 1 contract:

- `q`
- `specialty` — specialty ID or code
- `providerClass` — `DOCTOR` or `OTHER_PROVIDER`
- `providerCategory` — Other Provider category ID or slug
- `service` — service ID or service-name text
- `modality` — `CLINIC`, `TELEMEDICINE` or `HOME_VISIT`
- `location` — provider business/clinic location text
- `page` / `limit`

Ordering is deterministic by provider display name, service name and service ID. The implementation is conventional search/filtering only; it does not introduce P1 quality/ranking/recommendation logic.

A CLINIC modality is Release-1-discovery-ready only when it has an active provider location with recorded address-validation evidence and non-empty arrival instructions. This prevents structured discovery from advertising a clinic visit for which FR-CLN-001 cannot be fulfilled.

The legacy `/services/search` endpoint remains available for backward compatibility during the release integration period. Release 1 clients should adopt `/services/discovery` for the approved structured filter contract.

## Provider locations and clinic context

Providers can manage structured physical locations through `/provider/locations`. A location captures address fields, ISO-style country code, coordinates, arrival instructions and an `addressValidatedAt` timestamp. The API requires `addressValidated=true` when the provider creates the location; this is evidence that validation occurred, not a claim that CarePoint itself supplies a geocoding/address-verification provider.

Clinic service delivery context binds a CLINIC service modality to one active validated provider location and arrival instructions. On booking, the location and instructions are copied into immutable appointment visit context so a later provider-location edit does not silently rewrite historical appointment instructions.

A navigation handoff is represented by latitude/longitude in the service/appointment response. Selection and production activation of an external mapping/navigation provider remain R4 #80 / product-deployment concerns and are not invented by this implementation.

## Home-visit context and coverage

HOME_VISIT booking requires:

- address line and city;
- country code;
- approximate latitude/longitude;
- address-validation evidence (`addressValidated=true`);
- contact phone and explicit contact confirmation;
- optional visit instructions.

The resulting `AppointmentVisitContext` snapshots the submitted address/coordinates/instructions/contact evidence. A service may optionally configure a center/radius coverage constraint. When configured, the API applies a server-side great-circle distance check before slot inventory is consumed; outside-coverage requests fail. No market coverage radius is hard-coded.

## Scheduling buffers, exceptions and vacations

Recurring availability remains the existing `AvailabilityRule` model. `AvailabilityRulePolicy` adds explicit before/after buffers. A rule is rejected if its interval cannot reserve service duration plus both buffers.

`AvailabilityException` adds explicit `UNAVAILABLE` and `VACATION` intervals, optionally scoped to service and modality. Creation/activation is rejected when it overlaps an active REQUESTED/CONFIRMED appointment. Active exceptions block overlapping unbooked slots after generation. Deactivating an exception deliberately does not silently reopen slots; the provider must use the explicit slot-unblock action, which itself refuses to reopen a slot still covered by another active exception.

Existing manual slot blocking remains supported.

## Booking integrity and compatibility

The contextual booking path preserves the existing serializable transaction, conditional slot-capacity update, retry-on-serialization-conflict and idempotency-key semantics. Appointment and visit context are written in the same transaction.

HOME_VISIT context is always required. For CLINIC, Release 1 production (`NODE_ENV=production`) fails booking if the service does not have a valid clinic delivery context. Non-production integration environments retain a compatibility fallback for historical tests/data that predate the Release 1 context model; structured discovery never treats such a clinic modality as Release-1-ready.

Patient and provider appointment lists now expose the persisted visit context when one exists.

## Mobile acceptance boundary

`packages/mobile_core/lib/release1_scheduling.dart` provides a shared Flutter client for structured discovery, provider location/context configuration, availability exceptions and contextual booking. Unit acceptance verifies structured search query propagation, authenticated provider operations and HOME_VISIT request shape.

This is shared-client acceptance, not native-device UAT. Android/iOS native runners, permissions, signed builds, real-device navigation/location behavior and Patient/Doctor/Other Provider UX acceptance remain owned by R5 #81 and R7 #87.

## Automated acceptance

`services/api/scripts/release1-scheduling-context-smoke.mjs` is intended to prove on the exact candidate SHA:

- validated provider-location creation and navigation coordinates;
- structured discovery across specialty/provider type/service/modality/location;
- deterministic pagination and exclusion of unready clinic services;
- buffer validation/persistence;
- vacation/exception blocking and explicit unblock behavior;
- rejection of exceptions that overlap active appointments;
- clinic visit-context snapshot with instructions/navigation;
- HOME_VISIT validated address, coordinates, instructions and confirmed contact;
- optional home-visit coverage rejection/success;
- booking idempotency and single-capacity concurrency invariants;
- Patient and Provider appointment surfaces including visit context.

The shared Flutter test `release1_scheduling_test.dart` covers the corresponding Release 1 client request contracts.

## Remaining release evidence

Code success is not production certification. #75 can move to code-complete/conditional once exact-SHA CI/security/recovery/interoperability validation is green. Final production acceptance still depends on R4 #80 if an external geocoding/mapping/routing provider is selected, R5 #81 for native app packaging/device behavior, and R7 #87 for role-based workflow UAT. No external provider, country-specific address authority, coverage radius or navigation vendor is selected by this code.

`main` remains unchanged until Release Candidate Go/No-Go.
