import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const model = readFileSync(
  new URL("../prisma/transport_saved_locations.prisma", import.meta.url),
  "utf8",
);
const migration = readFileSync(
  new URL("../prisma/migrations/20260930135000_transport_saved_locations/migration.sql", import.meta.url),
  "utf8",
);
const backend = readFileSync(
  new URL("../src/modules/transport/transport-saved-locations.module.ts", import.meta.url),
  "utf8",
);
const appModule = readFileSync(
  new URL("../src/app.module.ts", import.meta.url),
  "utf8",
);
const mobileApi = readFileSync(
  new URL("../../../packages/mobile_core/lib/transport_api.dart", import.meta.url),
  "utf8",
);
const locationModel = readFileSync(
  new URL("../../../packages/mobile_core/lib/transport_location.dart", import.meta.url),
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
const phase5Doc = readFileSync(
  new URL("../../../docs/transport-saved-locations-route-phase5.md", import.meta.url),
  "utf8",
);

// Saved locations persist without forcing coordinates.
assert.match(model, /model TransportSavedLocation/);
assert.match(model, /address\s+String\?/);
assert.match(model, /latitude\s+Decimal\?/);
assert.match(model, /longitude\s+Decimal\?/);
assert.match(model, /patientId\s+String/);
assert.match(migration, /CREATE TABLE "TransportSavedLocation"/);

// Phase 5 stays isolated in its own API module.
assert.match(appModule, /TransportSavedLocationsModule/);
assert.match(backend, /@Get\("saved"\)/);
assert.match(backend, /@Post\("saved"\)/);
assert.match(backend, /@Patch\("saved\/:locationId"\)/);
assert.match(backend, /@Delete\("saved\/:locationId"\)/);
assert.match(backend, /patientId:\s*patient\.id/);

// Coordinates remain optional but partial pairs are rejected.
assert.match(backend, /requires an address or an optional complete latitude\/longitude pair/);
assert.match(backend, /are optional, but must be provided together/);
assert.doesNotMatch(model, /latitude\s+Decimal\s+/);
assert.doesNotMatch(model, /longitude\s+Decimal\s+/);

// Healthcare centers reuse existing validated clinic locations.
assert.match(backend, /serviceDeliveryContext\.findMany/);
assert.match(backend, /providerLocation\.findMany/);
assert.match(backend, /addressValidatedAt:\s*\{\s*not:\s*null\s*\}/);
assert.match(backend, /@Get\("healthcare-centers"\)/);
assert.match(backend, /HEALTHCARE_CENTER/);

// Route preview is optional and server-side.
assert.match(backend, /TRANSPORT_ROUTE_PROVIDER/);
assert.match(backend, /return value === "google" \? "google" : "none"/);
assert.match(backend, /GOOGLE_MAPS_SERVER_API_KEY/);
assert.match(backend, /routes\.googleapis\.com\/directions\/v2:computeRoutes/);
assert.match(backend, /Booking remains available/);
assert.match(backend, /AIR_NOT_SUPPORTED/);
assert.match(backend, /@Post\("route-preview"\)/);

// Address-only route preview remains valid.
assert.match(backend, /if \(!address && !pair\)/);
assert.match(backend, /return \{ address: location\.address \}/);

// Mobile surfaces support save/select/reuse for both endpoints.
assert.match(mobileApi, /savedTransportLocations/);
assert.match(mobileApi, /createSavedTransportLocation/);
assert.match(mobileApi, /transportHealthcareCenters/);
assert.match(mobileApi, /previewTransportRoute/);
assert.match(patientTransport, /_selectSavedLocation\(pickup: true\)/);
assert.match(patientTransport, /_selectSavedLocation\(pickup: false\)/);
assert.match(patientTransport, /_selectHealthcareCenter\(pickup: true\)/);
assert.match(patientTransport, /_selectHealthcareCenter\(pickup: false\)/);
assert.match(patientTransport, /_saveCurrentLocation\(pickup: true\)/);
assert.match(patientTransport, /_saveCurrentLocation\(pickup: false\)/);
assert.match(patientTransport, /routePreviewAvailable && mode == 'GROUND'/);
assert.match(patientTransport, /_previewRoute/);
assert.match(locationModel, /savedLocation/);
assert.match(locationModel, /healthcareCenter/);

// Phase 5 introduces no client mapping dependency and commits no environment file.
assert.doesNotMatch(patientPubspec, /google_maps_flutter|mapbox|here_sdk|maplibre/i);
assert.match(phase5Doc, /Coordinates remain optional/i);
assert.match(phase5Doc, /No `\.env` file/i);

console.log("V2 Transport Phase 5 saved locations + route preview contract acceptance passed");
