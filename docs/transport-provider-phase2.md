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
- Unified read-only Dispatch Board for scheduled medical transport and emergency ambulance work.
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

## Dispatch Board

Admin now has a single read-only operational board containing:

- active scheduled medical transport requests;
- active emergency ambulance requests;
- current status and timing;
- pickup/destination address when available;
- assigned Transport Provider;
- resolved Transport Company;
- current ETA.

The board is intentionally read-only in this slice. Assignment must reuse the existing Medical Transport and Emergency lifecycle invariants through a dedicated adapter rather than duplicating state-transition logic.

## Next Phase 2 slices

Remaining work should be split into small reviewable slices:

1. Dispatch assignment adapter that reuses existing lifecycle services without forcing Emergency enablement.
2. Crew-to-job selection using TransportCrewMember readiness and existing CrewAssignment revisions.
3. Transport Provider mobile company/crew context.
4. GPS + place search + geocoding abstraction.
5. Transport-specific analytics and operational audit views.
