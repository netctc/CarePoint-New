# Transport Provider Split — Phase 2

## Scope

Phase 2 turns the Transport Provider split into an operational administration boundary while preserving the existing transport lifecycle and historical data.

Implemented in this phase:

- Admin transport operations protected by `TRANSPORT_OPERATE`.
- Dedicated transport-provider operational directory.
- Dispatch-readiness calculation.
- Fleet / transport-unit administration.
- Active transport-job counts.
- Recent crew-assignment visibility.
- Transport Company administration with provider/fleet grouping.
- Transport Crew administration with role, optional provider linkage, license metadata and assignment-readiness calculation.
- Unified Dispatch Board for scheduled medical transport and emergency ambulance work.
- Admin dispatch assignment reusing the existing scheduled/emergency lifecycle endpoints.
- Company-aware emergency ambulance fleet and crew assignment with independent revision history.
- Optional latitude/longitude across transport location contracts.
- Nullable transport coordinates in PostgreSQL with a non-destructive migration.

## Dispatch readiness

A Transport Provider is considered `dispatchReady` only when all of the following are true:

1. The provider is active.
2. The linked account is active.
3. The transport provider category is active.
4. All required current credentials are present.
5. At least one active transport unit exists in the mode required by the provider family.

Mode rules:

- `MEDICAL_TRANSPORT_GROUND` → `GROUND`
- `EMERGENCY_AMBULANCE` → `GROUND`
- `MEDICAL_TRANSPORT_AIR` → `AIR`

## Location contract

Latitude and longitude are optional everywhere in the Transport domain.

A location is valid when it has either:

- a non-empty address, or
- a complete latitude/longitude pair, or
- both an address and a complete latitude/longitude pair.

A partial coordinate pair is invalid. Latitude without longitude, or longitude without latitude, is rejected.

This rule applies to:

- scheduled transport pickup;
- scheduled transport destination;
- emergency ambulance pickup;
- provider destination changes.

Existing coordinate data is preserved. The database migration only removes `NOT NULL` constraints.

## Future location experience

The next location enhancement should use a provider-neutral location abstraction instead of hard-wiring one map vendor.

### Origin

The Patient app should be able to:

1. Request device location permission.
2. Read the phone GPS coordinates when permission is granted.
3. Reverse-geocode coordinates into a human-readable origin address.
4. Allow the patient to review or correct the resolved address.
5. Fall back to manual address entry when GPS is unavailable, denied or inaccurate.

GPS must remain optional.

### Destination

The Patient app should provide a location picker that supports:

- address search;
- map selection;
- saved healthcare locations;
- manual address entry;
- optional latitude/longitude.

Selecting a place should resolve both the address and coordinates when available.

### Geocoding boundary

Introduce a backend/mobile abstraction such as:

- `LocationResolver`
- `GeocodingProvider`
- `PlaceSearchProvider`

The application contract should expose normalized location data rather than vendor-specific payloads.

Suggested normalized structure:

```ts
type TransportLocation = {
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  placeId?: string | null;
  source?: "GPS" | "ADDRESS_SEARCH" | "MAP_PICKER" | "MANUAL";
};
```

No latitude or longitude property becomes mandatory under this future design.

## Transport Company and Crew boundary

Transport Company is an additive organizational layer over the existing Provider and TransportUnit records.

A company stores the IDs of the Transport Providers and fleet units it governs. Existing Provider, TransportUnit, MedicalTransportRequest, EmergencyAmbulanceRequest and CrewAssignment records are not rewritten.

Crew members are managed under a Transport Company and support:

- a required operational role;
- an optional link to an existing Provider identity;
- optional license number and issuer;
- optional license expiry;
- active/inactive status;
- derived license-current and assignment-ready status.

A linked Provider must already belong to the company. This preserves compatibility with the current CrewAssignment model, which records provider IDs.

## Provider company context

The dedicated Transport Provider application now resolves its active Transport Company context after access validation.

When a company exists, the workspace shows the company name/code and uses company-scoped fleet and crew options for resource assignment.

When no company exists yet, the provider remains operational in `LEGACY_PROVIDER_SCOPE`. This allows existing providers to migrate gradually without breaking current jobs.

Company-scoped resource-assignment rules:

- scheduled transport uses `CrewAssignment`;
- emergency ambulance uses `EmergencyCrewAssignment`;
- both keep independent revision and idempotency histories;
- fleet options are limited to units listed by the active Transport Company;
- crew options are limited to active company crew with a linked Provider identity;
- license-required roles must have a license number and a non-expired license;
- existing Provider credential validity and transport-family compatibility checks still apply;
- providers not yet assigned to a company retain the legacy compatibility behavior.

## Dispatch Board

Admin now has a single operational board containing:

- active scheduled medical transport requests;
- active emergency ambulance requests;
- current status and timing;
- pickup/destination address when available;
- assigned Transport Provider;
- resolved Transport Company;
- current ETA.

For unassigned jobs, Admin can select a compatible dispatch-ready provider and an optional ETA. The Admin proxy routes assignment to the existing Medical Transport or Emergency operations endpoint, so concurrency protection, eligibility checks, lifecycle transitions, audit events and notifications remain authoritative in the existing domain services.

## Next Phase 2 slices

Remaining work should be split into small reviewable slices:

1. GPS + place search + geocoding abstraction.
2. Transport-specific analytics and operational audit views.
