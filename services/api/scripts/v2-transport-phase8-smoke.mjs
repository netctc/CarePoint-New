import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const telemetry = readFileSync(
  new URL("../src/modules/transport/transport-telemetry.module.ts", import.meta.url),
  "utf8",
);
const appModule = readFileSync(
  new URL("../src/app.module.ts", import.meta.url),
  "utf8",
);
const schema = readFileSync(
  new URL("../prisma/v2_transport_telemetry.prisma", import.meta.url),
  "utf8",
);
const migration = readFileSync(
  new URL("../prisma/migrations/20260930173000_v2_transport_telemetry/migration.sql", import.meta.url),
  "utf8",
);
const transportApi = readFileSync(
  new URL("../../../packages/mobile_core/lib/transport_api.dart", import.meta.url),
  "utf8",
);
const workspace = readFileSync(
  new URL("../../../packages/mobile_core/lib/transport_workspace.dart", import.meta.url),
  "utf8",
);
const patient = readFileSync(
  new URL("../../../packages/mobile_core/lib/patient_medical_transport.dart", import.meta.url),
  "utf8",
);
const location = readFileSync(
  new URL("../../../packages/mobile_core/lib/transport_location.dart", import.meta.url),
  "utf8",
);
const providerMain = readFileSync(
  new URL("../../../apps/transport-provider-mobile/lib/main.dart", import.meta.url),
  "utf8",
);
const providerPubspec = readFileSync(
  new URL("../../../apps/transport-provider-mobile/pubspec.yaml", import.meta.url),
  "utf8",
);
const providerLock = readFileSync(
  new URL("../../../apps/transport-provider-mobile/pubspec.lock", import.meta.url),
  "utf8",
);
const nativeWorkflow = readFileSync(
  new URL("../../../.github/workflows/mobile-native-compatibility.yml", import.meta.url),
  "utf8",
);
const adminPanel = readFileSync(
  new URL("../../../apps/admin/components/TransportFleetTelemetryPanel.tsx", import.meta.url),
  "utf8",
);
const adminPage = readFileSync(
  new URL("../../../apps/admin/app/transport-providers/page.tsx", import.meta.url),
  "utf8",
);
const docs = readFileSync(
  new URL("../../../docs/transport-fleet-telemetry-phase8.md", import.meta.url),
  "utf8",
);

// Persistence is separate from the transport request itself.
assert.match(schema, /model TransportTrackingSession/);
assert.match(schema, /transportRequestId\s+String\s+@unique/);
assert.match(schema, /shareWithPatient\s+Boolean/);
assert.match(schema, /expiresAt\s+DateTime/);
assert.match(schema, /model TransportUnitTelemetry/);
assert.match(schema, /clientEventId\s+String\s+@unique/);
assert.match(schema, /latitude\s+Decimal/);
assert.match(schema, /longitude\s+Decimal/);
assert.match(migration, /CREATE TABLE "TransportTrackingSession"/);
assert.match(migration, /CREATE TABLE "TransportUnitTelemetry"/);

// Module registration and access surfaces.
assert.match(appModule, /TransportTelemetryModule/);
assert.match(telemetry, /@RequirePermissions\("TRANSPORT_RESPOND"\)/);
assert.match(telemetry, /@RequirePermissions\("PATIENT_TRANSPORT_REQUEST"\)/);
assert.match(telemetry, /@RequirePermissions\("TRANSPORT_OPERATE"\)/);
assert.match(telemetry, /@Post\(":requestId\/tracking\/start"\)/);
assert.match(telemetry, /@Post\(":requestId\/tracking\/heartbeat"\)/);
assert.match(telemetry, /@Post\(":requestId\/tracking\/stop"\)/);
assert.match(telemetry, /@Get\(":requestId\/tracking"\)/);
assert.match(telemetry, /@Controller\("admin\/transport\/telemetry"\)/);

// Explicit opt-in, lifecycle and assigned-unit binding.
assert.match(telemetry, /shareWithPatient !== true/);
assert.match(telemetry, /TRACKING_STATUSES = new Set\(\["EN_ROUTE", "ARRIVED", "TRANSPORTING"\]\)/);
assert.match(telemetry, /Assign an active compatible transport unit/);
assert.match(telemetry, /The assigned transport unit changed/);
assert.match(telemetry, /capturedAt cannot predate the active tracking session/);

// Telemetry is short-lived and replay-safe.
assert.match(telemetry, /clientEventId/);
assert.match(telemetry, /transportUnitTelemetry\.findUnique/);
assert.match(telemetry, /transportUnitTelemetry\.deleteMany/);
assert.match(telemetry, /TRANSPORT_TRACKING_SESSION_TTL_MINUTES/);
assert.match(telemetry, /TRANSPORT_TELEMETRY_RETENTION_HOURS/);
assert.match(telemetry, /TRANSPORT_TELEMETRY_FRESH_SECONDS/);
assert.match(telemetry, /TRANSPORT_TELEMETRY_MAX_CAPTURE_AGE_MINUTES/);

// Patient gets latest-only visibility and ETA remains separate.
assert.match(telemetry, /orderBy: \[\{ capturedAt: "desc" \}, \{ receivedAt: "desc" \}\]/);
assert.match(telemetry, /trackingPositionIsRouteEta:\s*false/);
assert.match(telemetry, /routeEtaMinutes/);
assert.match(telemetry, /visible:\s*false/);
assert.match(telemetry, /visible:\s*true/);

// Audit metadata excludes exact coordinates.
assert.match(telemetry, /coordinateValuesExcludedFromAudit:\s*true/);
assert.doesNotMatch(telemetry, /metadata:\s*\{[^}]*latitude/s);
assert.doesNotMatch(telemetry, /metadata:\s*\{[^}]*longitude/s);

// Mobile API and foreground tracking.
assert.match(transportApi, /medicalTransportTracking/);
assert.match(transportApi, /startProviderMedicalTransportTracking/);
assert.match(transportApi, /sendProviderMedicalTransportHeartbeat/);
assert.match(transportApi, /stopProviderMedicalTransportTracking/);
assert.match(location, /TransportTelemetryPositionProvider/);
assert.match(workspace, /Timer\.periodic/);
assert.match(workspace, /Duration\(seconds: 30\)/);
assert.match(workspace, /shareWithPatient:\s*true/);
assert.match(workspace, /APP_SIGN_OUT/);
assert.match(patient, /patient-vehicle-tracking/);
assert.match(patient, /etaSeparateNotice/);

// Transport Provider resolves a foreground device position.
assert.match(providerPubspec, /geolocator:\s*\^14\.0\.2/);
assert.match(providerLock, /geolocator:/);
assert.match(providerLock, /version:\s*"14\.0\.2"/);
assert.match(providerMain, /Geolocator\.getCurrentPosition/);
assert.match(providerMain, /LocationAccuracy\.high/);
assert.match(providerMain, /TransportTelemetryPosition/);

// Native validation is explicitly foreground-only and includes transport-provider on iOS.
assert.match(nativeWorkflow, /ACCESS_FINE_LOCATION/);
assert.match(nativeWorkflow, /ACCESS_BACKGROUND_LOCATION/);
assert.match(nativeWorkflow, /NSLocationWhenInUseUsageDescription/);
assert.match(nativeWorkflow, /NSLocationAlways/);
const iosSection = nativeWorkflow.split("  ios:")[1] ?? "";
assert.match(iosSection, /app: transport-provider-mobile/);

// Admin telemetry view is wired and keeps ETA distinct.
assert.match(adminPage, /TransportFleetTelemetryPanel/);
assert.match(adminPanel, /Transport Fleet Telemetry/);
assert.match(adminPanel, /\/api\/admin\/transport\/telemetry/);
assert.match(adminPanel, /route ETA are intentionally separate/);

// Documentation preserves optional booking coordinates and avoids committed env files.
assert.match(docs, /Booking coordinates remain optional/i);
assert.match(docs, /No background location service is implemented or claimed/i);
assert.match(docs, /No `\.env` file is added or modified/i);

console.log("V2 Transport Phase 8 fleet telemetry + patient tracking contract acceptance passed");
