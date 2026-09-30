# Transport Map Picker — Phase 4

## Objective

Phase 4 adds an optional interactive map picker to Patient Medical Transport without making maps, coordinates, or any specific map vendor mandatory.

The existing transport location choices remain authoritative:

- manual address entry;
- optional latitude/longitude;
- current GPS location;
- explicit place/address search;
- interactive map picker when configured.

## Architecture

The map picker is rendered in Patient Mobile using the existing Flutter SDK only. No Google Maps, Mapbox, HERE, MapLibre, or other client map SDK is introduced.

CarePoint renders standard raster slippy-map tiles from a backend-provided public URL template.

The backend never proxies map tiles and does not expose server-side geocoding keys.

## Runtime configuration

The map picker is disabled unless all required raster settings are valid.

Disabled/default mode:

```text
TRANSPORT_MAP_PROVIDER=none
```

Enabled raster mode:

```text
TRANSPORT_MAP_PROVIDER=raster
TRANSPORT_MAP_TILE_URL_TEMPLATE=https://public-tile-provider.example/{z}/{x}/{y}.png
TRANSPORT_MAP_ATTRIBUTION=<required visible attribution>
```

Optional tuning:

```text
TRANSPORT_MAP_MIN_ZOOM=2
TRANSPORT_MAP_MAX_ZOOM=18
TRANSPORT_MAP_INITIAL_ZOOM=14
TRANSPORT_MAP_DEFAULT_LATITUDE=<optional>
TRANSPORT_MAP_DEFAULT_LONGITUDE=<optional>
```

All values are configured manually in the deployment platform. No `.env` file is created or committed.

## Security boundary

`TRANSPORT_MAP_TILE_URL_TEMPLATE` is returned to Patient Mobile and therefore must contain only a public/client-safe tile URL.

Do not place:

- server secrets;
- private API keys;
- privileged bearer tokens;
- credentials intended to remain confidential

inside the tile URL template.

Server-only geocoding credentials remain controlled separately by the Phase 3 location-service configuration.

## Backend capability response

`GET /transport/location/config` continues to expose non-secret capabilities.

When raster maps are disabled:

```json
{
  "mapPickerAvailable": false,
  "map": null
}
```

When valid raster configuration is present:

```json
{
  "mapPickerAvailable": true,
  "map": {
    "provider": "raster",
    "tileUrlTemplate": "https://public-tile-provider.example/{z}/{x}/{y}.png",
    "attribution": "Required attribution",
    "minZoom": 2,
    "maxZoom": 18,
    "initialZoom": 14,
    "defaultLatitude": null,
    "defaultLongitude": null
  }
}
```

The map capability requires:

- HTTPS tile URLs;
- `{z}`, `{x}`, and `{y}` placeholders;
- non-empty visible attribution.

Invalid or incomplete configuration disables the map picker instead of breaking transport booking.

## Patient experience

### Pickup

The Patient can choose:

- **Use current location**
- **Search location**
- **Pick on map** when map capability is enabled
- manual address and optional coordinates

### Destination

The Patient can choose:

- **Search location**
- **Pick on map** when map capability is enabled
- manual address and optional coordinates

The map button is hidden when the map provider is disabled or invalid.

## Picker behavior

The interactive picker supports:

- drag/pan;
- tap to recenter;
- zoom in/out;
- fixed central location pin;
- visible provider attribution;
- coordinate preview;
- reverse geocoding on confirmation when available.

The selected map coordinate remains authoritative. Reverse geocoding may enrich it with an address/place ID but does not replace the selected coordinate.

If reverse geocoding is disabled or fails, the Patient can still confirm the coordinate-only location.

## Initial center

The picker chooses its initial center in this order:

1. existing coordinates already entered for the selected field;
2. pickup coordinates when choosing a destination;
3. current device location when permission is available;
4. configured default map center;
5. world overview.

GPS permission remains optional.

## Compatibility

The implementation:

- does not require Google Mobile Services;
- does not introduce a new Flutter dependency;
- preserves Android, iOS, and web compatibility;
- keeps the existing Patient dependency lock unchanged;
- preserves manual fallback.

This is particularly important for devices without Google services.

## Tile-provider policy

CarePoint does not hard-code the OpenStreetMap standard tile server or any other provider.

Operators are responsible for selecting a tile service whose terms permit the intended production traffic and for supplying the required visible attribution.

If OpenStreetMap Foundation standard tiles are configured manually, the deployment must comply with the OSM tile usage policy, including attribution, identification/caching requirements, and the prohibition on bulk/offline prefetching.

Phase 4 does not implement tile prefetching or offline map downloads.

## Acceptance criteria

Phase 4 is complete when:

1. map picker is disabled by default;
2. invalid map configuration falls back to search/GPS/manual entry;
3. map controls appear only when valid configuration is returned;
4. map selection returns a normalized `TransportLocation` with `MAP_PICKER` source;
5. latitude and longitude remain optional in transport requests;
6. attribution remains visible on the map;
7. no client map SDK or secret is added;
8. existing Transport and Emergency smoke tests remain green.
