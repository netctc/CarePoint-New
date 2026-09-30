# Transport Location Services — Phase 3

## Objective

Phase 3 adds optional location-resolution services for Patient transport flows without making coordinates mandatory and without coupling Flutter directly to a map/geocoding vendor.

The Transport module remains usable with manual addresses only.

## Design principles

- Latitude and longitude remain optional.
- When coordinates are supplied, they must be supplied as a valid pair.
- Manual address entry remains available at all times.
- Emergency Ambulance must never be blocked by reverse-geocoding failure.
- External provider keys remain on the CarePoint API backend.
- Patient Flutter does not contain provider API keys.
- Provider-specific responses are normalized into the existing `TransportLocation` contract.
- Place search is explicit on user action; no per-keystroke autocomplete is used.
- No .env file is created or committed.

## Runtime provider configuration

The API supports:

```text
TRANSPORT_LOCATION_PROVIDER=manual
```

This is the default behavior. No external API calls are made.

Optional Google-backed mode:

```text
TRANSPORT_LOCATION_PROVIDER=google
GOOGLE_MAPS_API_KEY=<configured manually in the deployment platform>
```

These values must be configured manually in Dokploy or the target runtime. They must not be committed to the repository.

When `TRANSPORT_LOCATION_PROVIDER=google`, the Google Maps Platform project must have the required server-side APIs enabled for the configured key:

- Geocoding API v4 for reverse geocoding.
- Places API (New) for text-based place/address search.

The API key should be restricted to the required APIs and to the intended backend environment wherever the deployment platform permits it.

## Backend endpoints

Authenticated Patient transport users can call:

```text
GET  /transport/location/config
POST /transport/location/reverse-geocode
POST /transport/location/search
```

All endpoints require:

```text
PATIENT_TRANSPORT_REQUEST
```

### Config

The config endpoint exposes only non-secret capabilities:

```json
{
  "provider": "manual",
  "reverseGeocodingAvailable": false,
  "placeSearchAvailable": false,
  "mapPickerAvailable": false,
  "manualFallback": true
}
```

No provider key is returned.

### Reverse geocoding

Input:

```json
{
  "latitude": 33.0,
  "longitude": 35.0,
  "languageCode": "en"
}
```

Output is normalized to:

```json
{
  "resolved": true,
  "location": {
    "address": "Human-readable address",
    "latitude": 33.0,
    "longitude": 35.0,
    "placeId": "provider-place-id",
    "source": "GPS"
  }
}
```

If the provider is disabled or no address is resolved, the original coordinates remain usable and `resolved` is false.

### Place search

Search is triggered explicitly by the Patient.

The API returns at most eight normalized candidates. Optional location bias may be supplied as a complete latitude/longitude pair.

The backend requests only the place fields CarePoint uses:

- provider place ID;
- display name;
- formatted address;
- coordinates.

## Patient experience

### Emergency Ambulance

1. Patient confirms the emergency request.
2. Patient Mobile obtains current GPS coordinates.
3. If reverse geocoding is available, CarePoint attempts to resolve a readable pickup address.
4. If reverse geocoding fails, Emergency Ambulance continues with the GPS coordinates.
5. A resolved address is added when available, but is never required.

### Scheduled Medical Transport

For pickup/origin:

- manual address;
- optional manual coordinates;
- **Use current location**;
- **Search location**.

For destination:

- manual address;
- optional manual coordinates;
- **Search location**.

Selecting a search result fills the human-readable address and coordinates. The Patient may still edit the address before submitting.

## Normalized mobile contract

```dart
TransportLocation(
  address: optional,
  latitude: optional,
  longitude: optional,
  placeId: optional,
  source: GPS | ADDRESS_SEARCH | MAP_PICKER | MANUAL,
)
```

Valid examples:

```text
address only                         valid
latitude + longitude                 valid
address + latitude + longitude       valid
latitude only                        invalid
longitude only                       invalid
```

## Map picker

The provider-neutral contract already includes `MAP_PICKER`, but Phase 3 does not yet add a client map SDK.

This is intentional:

- no Google Maps SDK key is embedded in Flutter;
- no dependency on Google Play Services is introduced;
- devices without Google Mobile Services remain compatible;
- the project can later choose Google Maps, MapLibre, Mapbox, HERE, or another map rendering solution independently from backend geocoding.

A later map-picker slice should return the same `TransportLocation` structure and must retain manual fallback.

## Security and privacy

- API keys remain server-side.
- Provider errors are sanitized before returning to Patient Mobile.
- Search strings and raw coordinates are not written into application audit metadata by this module.
- Requests use a bounded provider timeout.
- Search results are bounded.
- Only Patient transport permission can access the endpoints.
- No clinical payload is sent to the location provider.

## Deployment variables

Add manually only when external geocoding/search is required:

```text
TRANSPORT_LOCATION_PROVIDER=google
GOOGLE_MAPS_API_KEY=<secret>
```

For environments that should remain offline/manual:

```text
TRANSPORT_LOCATION_PROVIDER=manual
```

No .env file is required or included in this phase.
