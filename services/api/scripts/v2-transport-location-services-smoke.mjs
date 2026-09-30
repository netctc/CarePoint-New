import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const backend = readFileSync(
  new URL("../src/modules/transport/transport-location.module.ts", import.meta.url),
  "utf8",
);
const appModule = readFileSync(
  new URL("../src/app.module.ts", import.meta.url),
  "utf8",
);
const transportApi = readFileSync(
  new URL("../../../packages/mobile_core/lib/transport_api.dart", import.meta.url),
  "utf8",
);
const transportLocation = readFileSync(
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
const phase3Doc = readFileSync(
  new URL("../../../docs/transport-location-services-phase3.md", import.meta.url),
  "utf8",
);

// Backend-only provider configuration defaults safely to manual operation.
assert.match(backend, /TRANSPORT_LOCATION_PROVIDER/);
assert.match(backend, /process\.env\.TRANSPORT_LOCATION_PROVIDER \?\? "manual"/);
assert.match(backend, /GOOGLE_MAPS_SERVER_API_KEY/);
assert.match(backend, /GOOGLE_MAPS_API_KEY/);
assert.match(backend, /TRANSPORT_LOCATION_REGION_CODE/);
assert.match(backend, /reverseGeocodingAvailable/);
assert.match(backend, /placeSearchAvailable/);
assert.match(backend, /manualFallback:\s*true/);

// Google integrations use server-side REST endpoints with bounded fields/results.
assert.match(backend, /https:\/\/geocode\.googleapis\.com\/v4\/geocode/);
assert.match(backend, /https:\/\/places\.googleapis\.com\/v1\/places:searchText/);
assert.match(backend, /X-Goog-Api-Key/);
assert.match(backend, /X-Goog-FieldMask/);
assert.match(backend, /pageSize:\s*8/);
assert.match(backend, /PROVIDER_TIMEOUT_MS\s*=\s*6_000/);
assert.match(backend, /TRANSPORT_LOCATION_SEARCH/);
assert.match(backend, /TRANSPORT_LOCATION_REVERSE/);
assert.match(backend, /resultCount/);
const auditOperation = backend.match(/private async auditOperation[\s\S]*?\n  }/m)?.[0] ?? "";
assert.doesNotMatch(auditOperation, /query|latitude|longitude|address/i);

// Patient-only authorization is required for location-service calls.
assert.match(backend, /RequirePermissions\("PATIENT_TRANSPORT_REQUEST"\)/);
assert.match(backend, /Controller\("transport\/location"\)/);
assert.match(appModule, /TransportLocationModule/);

// Keys and provider SDKs are not embedded in Flutter.
assert.doesNotMatch(transportApi, /GOOGLE_MAPS_API_KEY/);
assert.doesNotMatch(patientTransport, /GOOGLE_MAPS_API_KEY/);
assert.doesNotMatch(patientPubspec, /google_maps_flutter|mapbox|here_sdk/i);

// Mobile contract preserves provider-neutral locations and manual fallback.
assert.match(transportLocation, /enum TransportLocationSource/);
assert.match(transportLocation, /addressSearch/);
assert.match(transportLocation, /mapPicker/);
assert.match(transportLocation, /abstract interface class TransportMapPickerProvider/);
assert.match(transportLocation, /manual/);
assert.match(transportLocation, /factory TransportLocation\.fromJson/);
assert.match(transportApi, /reverseGeocodeTransportLocation/);
assert.match(transportApi, /searchTransportLocations/);

// Emergency dispatch must not be blocked by reverse-geocoding failure.
assert.match(patientTransport, /Future<TransportLocation> _resolveTransportLocation/);
assert.match(patientTransport, /catch \(_\) \{\s*return location;/s);
assert.match(patientTransport, /pickupAddress:\s*location\.address/);

// Scheduled transport supports explicit place search, not per-keystroke autocomplete.
assert.match(patientTransport, /_TransportLocationSearchDialog/);
assert.match(patientTransport, /textInputAction:\s*TextInputAction\.search/);
assert.match(patientTransport, /onSubmitted:\s*\(_\) => search\(\)/);
assert.doesNotMatch(patientTransport, /onChanged:\s*\([^)]*\)\s*=>\s*search\(/);
assert.match(patientTransport, /searchTransportLocations/);

// Coordinates remain optional and manual address entry remains authoritative.
assert.match(patientTransport, /pickupAddressValue\.isEmpty && pickupLat == null/);
assert.match(patientTransport, /destinationAddressValue\.isEmpty && destinationLat == null/);
assert.match(phase3Doc, /Latitude and longitude remain optional/i);
assert.match(phase3Doc, /manual/i);
assert.match(phase3Doc, /No \.env file/i);

console.log("V2 Transport Location Services Phase 3 contract acceptance passed");
