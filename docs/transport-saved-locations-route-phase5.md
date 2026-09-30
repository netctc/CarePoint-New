# Transport — Phase 5: Saved Locations + Route/Dispatch Enhancements

## Objective

Phase 5 builds on the optional location and map work from Phases 3–4.

It adds:

- Patient saved/frequent transport locations;
- reusable healthcare-center locations derived from active validated clinic locations;
- optional ground-route preview and estimated travel time;
- reuse of saved or healthcare locations as either pickup or destination;
- continued support for address-only transport requests.

Coordinates remain optional. A transport request is still valid when each endpoint has a usable address without latitude/longitude.

## Branch

`feature/transport-saved-locations-route-phase5-20260930`

The branch starts from:

`feature/transport-map-picker-phase4-20260930`

It does not modify `main`.

## Saved locations

Patient-owned saved locations are persisted in `TransportSavedLocation`.

Kinds:

- `HOME`
- `WORK`
- `HEALTHCARE`
- `OTHER`

A saved location contains:

- label;
- kind;
- optional address;
- optional latitude/longitude pair;
- optional provider place ID/source metadata.

Validation follows the existing Transport rule:

- address alone is valid;
- latitude/longitude are optional;
- if coordinates are supplied, both must be supplied and valid;
- a coordinate-only location is also valid.

### API

- `GET /transport/location/saved`
- `POST /transport/location/saved`
- `PATCH /transport/location/saved/:locationId`
- `DELETE /transport/location/saved/:locationId`

All saved-location operations are scoped to the authenticated Patient profile.

## Healthcare centers

Phase 5 does not create a duplicate healthcare-facility master table.

`GET /transport/location/healthcare-centers` reuses active validated `ProviderLocation` rows that are currently referenced by active clinic delivery contexts.

This preserves one source of truth for clinic addresses and navigation coordinates.

Optional query:

`GET /transport/location/healthcare-centers?q=<text>`

The response exposes a normalized transport location that can be reused as pickup or destination.

## Route preview / ETA

Route preview is optional and disabled by default.

Default:

```text
TRANSPORT_ROUTE_PROVIDER=none
```

Google Routes mode:

```text
TRANSPORT_ROUTE_PROVIDER=google
GOOGLE_MAPS_SERVER_API_KEY=<server-side key>
```

The existing `GOOGLE_MAPS_API_KEY` fallback remains supported by the backend for compatibility, but production should prefer the server-only key.

No `.env` file is added. Deployment variables must be configured manually.

### Endpoints

Patient preview from entered/saved locations:

`POST /transport/location/route-preview`

Dispatch/Operations preview from an existing medical-transport request:

`POST /operations/medical-transport/:requestId/route-preview`

The operations endpoint reuses the request's address and optional coordinates, so Dispatch does not need to copy location data into a second payload.

Example address-only request:

```json
{
  "mode": "GROUND",
  "pickup": {
    "address": "Patient home address"
  },
  "destination": {
    "address": "Hospital address"
  },
  "languageCode": "en"
}
```

Coordinates are not required.

When coordinates are present, a complete latitude/longitude pair may be used for higher precision.

A successful response contains:

- distance in meters;
- route duration in seconds;
- ETA in minutes;
- optional encoded overview polyline.

If routing is not configured, the endpoint returns a non-blocking unavailable response. Booking remains available.

Air transport deliberately does not use a road-route ETA and returns `AIR_NOT_SUPPORTED`.

## Patient Mobile

The booking form now supports, for both pickup and destination:

- manual address;
- optional coordinates;
- current GPS location for pickup;
- address/place search;
- map picker when configured;
- saved locations;
- healthcare centers;
- saving the current entered location.

When route preview is configured and the mode is `GROUND`, the Patient can request a preview showing:

- approximate route distance;
- estimated travel time.

The route preview does not become part of booking validation and never blocks submission.

## Security and privacy

- Saved locations are Patient-scoped.
- Route and location operations require `PATIENT_TRANSPORT_REQUEST`.
- Google routing/geocoding credentials remain server-side.
- No secret is returned in route/location capability responses.
- Healthcare-center data is sourced only from active validated clinic locations.
- Saved-location create/update/delete and route-preview operations are audited.

## Database

Migration:

`20260930135000_transport_saved_locations`

New model:

`TransportSavedLocation`

The Phase 5 model intentionally follows the existing Transport persistence style and does not make coordinates mandatory.

## Compatibility

Phase 5 preserves:

- existing medical-transport request contracts;
- manual fallback;
- address-only pickup/destination;
- optional GPS;
- optional map picker;
- devices without Google Mobile Services;
- existing Flutter dependency set;
- no committed environment files.

## Acceptance criteria

Phase 5 is complete when:

1. a Patient can save a valid location with address-only data;
2. partial coordinate pairs are rejected;
3. saved locations are scoped to the authenticated Patient;
4. saved locations can be reused as pickup or destination;
5. active validated clinic locations can be selected as healthcare centers;
6. route preview is disabled by default;
7. route preview can use address-only origin and destination;
8. route preview failure never prevents transport booking;
9. Dispatch can request a route preview for an existing medical-transport request without requiring coordinates;
10. route ETA is limited to supported ground routing;
11. no Google/client map SDK or new Flutter dependency is introduced;
12. existing Transport map/location smoke contracts remain intact;
13. Phase 5 smoke checks cover persistence, API surfaces, optional-coordinate behavior, Dispatch routing and Patient UI wiring.
