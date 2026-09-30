import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const milestones = readFileSync(
  new URL("../src/modules/transport/transport-trip-milestones.module.ts", import.meta.url),
  "utf8",
);
const telemetry = readFileSync(
  new URL("../src/modules/transport/transport-telemetry.module.ts", import.meta.url),
  "utf8",
);
const realtime = readFileSync(
  new URL("../src/modules/realtime/realtime.service.ts", import.meta.url),
  "utf8",
);
const realtimeModule = readFileSync(
  new URL("../src/modules/realtime/realtime.module.ts", import.meta.url),
  "utf8",
);
const schema = readFileSync(
  new URL("../prisma/v2_transport_trip_milestones.prisma", import.meta.url),
  "utf8",
);
const migration = readFileSync(
  new URL("../prisma/migrations/20260930195000_v2_transport_trip_milestones/migration.sql", import.meta.url),
  "utf8",
);
const transportApi = readFileSync(
  new URL("../../../packages/mobile_core/lib/transport_api.dart", import.meta.url),
  "utf8",
);
const patient = readFileSync(
  new URL("../../../packages/mobile_core/lib/patient_medical_transport.dart", import.meta.url),
  "utf8",
);
const workspace = readFileSync(
  new URL("../../../packages/mobile_core/lib/transport_workspace.dart", import.meta.url),
  "utf8",
);
const adminPanel = readFileSync(
  new URL("../../../apps/admin/components/TransportFleetTelemetryPanel.tsx", import.meta.url),
  "utf8",
);
const docs = readFileSync(
  new URL("../../../docs/transport-realtime-milestones-phase9.md", import.meta.url),
  "utf8",
);

// Persistence is milestone-only and does not duplicate exact coordinates.
assert.match(schema, /model TransportTripMilestone/);
assert.match(schema, /@@unique\(\[transportRequestId, code\]\)/);
assert.match(schema, /distanceMeters\s+Int\?/);
assert.match(schema, /telemetryCapturedAt\s+DateTime\?/);
assert.doesNotMatch(schema, /latitude/i);
assert.doesNotMatch(schema, /longitude/i);
assert.match(migration, /CREATE TABLE "TransportTripMilestone"/);
assert.match(
  migration,
  /TransportTripMilestone_transportRequestId_code_key/,
);

// Automated milestone vocabulary.
for (const code of [
  "TRACKING_STARTED",
  "FIRST_POSITION_RECEIVED",
  "NEAR_PICKUP",
  "PICKUP_ARRIVAL_DETECTED",
  "NEAR_DESTINATION",
  "DESTINATION_ARRIVAL_DETECTED",
  "TRACKING_STOPPED",
]) {
  assert.match(milestones, new RegExp(code));
}

// Telemetry creates milestones, while milestone detection never changes lifecycle.
assert.match(telemetry, /TransportTripMilestoneService/);
assert.match(telemetry, /recordTrackingStarted/);
assert.match(telemetry, /detectFromHeartbeat/);
assert.match(telemetry, /recordTrackingStopped/);
assert.match(milestones, /automaticLifecycleMutation:\s*false/);
assert.doesNotMatch(milestones, /medicalTransportRequest\.update/);
assert.doesNotMatch(milestones, /medicalTransportRequest\.updateMany/);

// Accuracy and optional-coordinate gates.
assert.match(milestones, /TRANSPORT_GEOFENCE_MAX_ACCURACY_METERS/);
assert.match(milestones, /TRANSPORT_GEOFENCE_NEAR_PICKUP_METERS/);
assert.match(milestones, /TRANSPORT_GEOFENCE_PICKUP_ARRIVAL_METERS/);
assert.match(milestones, /TRANSPORT_GEOFENCE_NEAR_DESTINATION_METERS/);
assert.match(milestones, /TRANSPORT_GEOFENCE_DESTINATION_ARRIVAL_METERS/);
assert.match(milestones, /SKIPPED_LOW_ACCURACY/);
assert.match(milestones, /if \(latitudeRaw == null \|\| longitudeRaw == null\) return null/);
assert.match(milestones, /distanceMeters\(/);
assert.match(milestones, /Math\.sin/);

// Milestone audit and notifications contain no exact coordinate values.
assert.match(milestones, /coordinateValuesExcludedFromAudit:\s*true/);
assert.match(milestones, /notifyPatient:\s*true/);
assert.doesNotMatch(milestones, /metadata:\s*\{[^}]*latitude/s);
assert.doesNotMatch(milestones, /metadata:\s*\{[^}]*longitude/s);

// Timeline surfaces are scoped by the existing transport permissions.
assert.match(milestones, /@RequirePermissions\("PATIENT_TRANSPORT_REQUEST"\)/);
assert.match(milestones, /@RequirePermissions\("TRANSPORT_RESPOND"\)/);
assert.match(milestones, /@RequirePermissions\("TRANSPORT_OPERATE"\)/);
assert.match(milestones, /@Get\(":requestId\/timeline"\)/);
assert.match(milestones, /AUTHORITATIVE_LIFECYCLE/);
assert.match(milestones, /AUTOMATED_DETECTION/);

// Existing realtime infrastructure is reused with request-scoped transport topics.
for (const topic of [
  "TRANSPORT_TRACKING",
  "TRANSPORT_MILESTONES",
  "TRANSPORT_LIFECYCLE",
]) {
  assert.match(realtime, new RegExp(topic));
}
assert.match(realtime, /transportRequestId\?: string/);
assert.match(realtime, /subjectType:\s*"PATIENT" \| "PROVIDER" \| "TRANSPORT_REQUEST"/);
assert.match(realtime, /PATIENT_TRANSPORT_REQUEST/);
assert.match(realtime, /TRANSPORT_RESPOND/);
assert.match(realtime, /TRANSPORT_OPERATE/);
assert.match(realtime, /request\.assignedProviderId !== provider\.id/);
assert.match(realtime, /TELEMETRY_UPDATED/);
assert.match(realtime, /TRANSPORT_MILESTONE_DETECTED/);
assert.match(realtime, /TRANSPORT_LIFECYCLE_CHANGED/);
assert.match(realtime, /TRANSPORT_TELEMETRY/);
assert.match(realtime, /TRANSPORT_TRIP_MILESTONE/);
assert.match(realtime, /MEDICAL_TRANSPORT_EVENT/);
assert.doesNotMatch(realtime, /latitude/i);
assert.doesNotMatch(realtime, /longitude/i);
assert.match(realtimeModule, /transportCoordinatesInStream:\s*false/);
assert.match(realtimeModule, /STRUCTURAL_METADATA_ONLY/);

// Mobile receives SSE structural events and retains bounded polling fallback.
assert.match(transportApi, /transportRealtimeEvents/);
assert.match(transportApi, /text\/event-stream/);
assert.match(transportApi, /transportRequestId/);
assert.match(transportApi, /medicalTransportTimeline/);
assert.match(transportApi, /providerMedicalTransportTimeline/);
assert.match(patient, /TRANSPORT_TRACKING/);
assert.match(patient, /TRANSPORT_MILESTONES/);
assert.match(patient, /TRANSPORT_LIFECYCLE/);
assert.match(patient, /Timer\.periodic/);
assert.match(patient, /Duration\(seconds: 15\)/);
assert.match(patient, /AUTOMATED_DETECTION/);
assert.match(patient, /detectedNotStatus/);

// Provider and Admin make the advisory boundary visible.
assert.match(workspace, /providerMedicalTransportTimeline/);
assert.match(workspace, /milestoneAdvisory/);
assert.match(adminPanel, /Latest detected milestone/);
assert.match(adminPanel, /never change lifecycle status automatically/);
assert.match(adminPanel, /10_000/);

// Documentation preserves the Phase 8 privacy and booking boundaries.
assert.match(docs, /does \*\*not\*\* perform that transition/i);
assert.match(docs, /Address-only bookings remain valid/i);
assert.match(docs, /does not add background location/i);
assert.match(docs, /does not make booking coordinates mandatory/i);
assert.match(docs, /No `\.env` file is added or modified/i);

console.log(
  "V2 Transport Phase 9 realtime delivery + automated milestone contract acceptance passed",
);
