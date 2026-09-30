import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const backend = readFileSync(
  new URL("../src/modules/transport/transport-location.module.ts", import.meta.url),
  "utf8",
);
const patientTransport = readFileSync(
  new URL("../../../apps/patient-mobile/lib/patient_transport.dart", import.meta.url),
  "utf8",
);
const patientPubspec = readFileSync(
  new URL("../../../apps/patient-mobile/pubspec.yaml", import.meta.url),
  "utf8",
);
const localization = readFileSync(
  new URL("../../../packages/mobile_core/lib/transport_localization.dart", import.meta.url),
  "utf8",
);
const phase4Doc = readFileSync(
  new URL("../../../docs/transport-map-picker-phase4.md", import.meta.url),
  "utf8",
);

// Map rendering is opt-in and requires a complete public raster configuration.
assert.match(backend, /TRANSPORT_MAP_PROVIDER/);
assert.match(backend, /provider !== "raster"/);
assert.match(backend, /TRANSPORT_MAP_TILE_URL_TEMPLATE/);
assert.match(backend, /TRANSPORT_MAP_ATTRIBUTION/);
assert.match(backend, /startsWith\("https:\/\/"\)/);
assert.match(backend, /includes\("\{z\}"\)/);
assert.match(backend, /includes\("\{x\}"\)/);
assert.match(backend, /includes\("\{y\}"\)/);
assert.match(backend, /mapPickerAvailable:\s*map != null/);

// Zoom/default-center tuning stays optional and bounded.
assert.match(backend, /TRANSPORT_MAP_MIN_ZOOM/);
assert.match(backend, /TRANSPORT_MAP_MAX_ZOOM/);
assert.match(backend, /TRANSPORT_MAP_INITIAL_ZOOM/);
assert.match(backend, /TRANSPORT_MAP_DEFAULT_LATITUDE/);
assert.match(backend, /TRANSPORT_MAP_DEFAULT_LONGITUDE/);

// No production tile provider is hard-coded in source.
assert.doesNotMatch(backend, /tile\.openstreetmap\.org/i);
assert.doesNotMatch(patientTransport, /tile\.openstreetmap\.org/i);
assert.doesNotMatch(patientTransport, /google_maps_flutter|mapbox|here_sdk|maplibre/i);
assert.doesNotMatch(patientPubspec, /flutter_map|google_maps_flutter|mapbox|here_sdk|maplibre/i);

// The Patient UI only exposes map actions after capability validation.
assert.match(patientTransport, /payload\['mapPickerAvailable'\] == true/);
assert.match(patientTransport, /if \(mapConfig != null\)/);
assert.match(patientTransport, /_pickOnMap\(pickup: true\)/);
assert.match(patientTransport, /_pickOnMap\(pickup: false\)/);
assert.match(localization, /'pickOnMap'/);

// Interactive map behavior is implemented without changing transport request contracts.
assert.match(patientTransport, /class _TransportRasterMapPickerDialog/);
assert.match(patientTransport, /onPanUpdate:/);
assert.match(patientTransport, /onTapDown:/);
assert.match(patientTransport, /_changeZoom\(1\)/);
assert.match(patientTransport, /_changeZoom\(-1\)/);
assert.match(patientTransport, /widget\.config\.attribution/);
assert.match(patientTransport, /TransportLocationSource\.mapPicker/);
assert.match(patientTransport, /_resolveTransportLocation/);

// Existing optional-coordinate/manual fallback remains intact.
assert.match(patientTransport, /pickupAddressValue\.isEmpty && pickupLat == null/);
assert.match(patientTransport, /destinationAddressValue\.isEmpty && destinationLat == null/);
assert.match(phase4Doc, /No `\.env` file/i);
assert.match(phase4Doc, /manual fallback/i);

console.log("V2 Transport Map Picker Phase 4 contract acceptance passed");
