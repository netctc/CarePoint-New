import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

const transport = readFileSync(
  new URL("../src/modules/transport/transport.module.ts", import.meta.url),
  "utf8",
);
const patientUi = readFileSync(
  new URL("../../../packages/mobile_core/lib/patient_medical_transport.dart", import.meta.url),
  "utf8",
);
const doc = readFileSync(
  new URL("../../../docs/transport-patient-trip-timeline-phase8.md", import.meta.url),
  "utf8",
);
const migrations = readdirSync(
  new URL("../prisma/migrations/", import.meta.url),
  { withFileTypes: true },
).map((entry) => entry.name);

// Patient tracking is a read model over existing sources.
assert.match(transport, /medicalTransportEvent\.findMany/);
assert.match(transport, /transportRouteRevision\.findMany/);
assert.match(transport, /patientTripTimeline/);
assert.match(transport, /trackingMode:\s*"MILESTONE_ONLY"/);
assert.match(transport, /liveGpsTrackingAvailable:\s*false/);
assert.match(transport, /kind:\s*"STATUS"/);
assert.match(transport, /kind:\s*"ROUTE_UPDATED"/);

// The patient route timeline exposes safe operational metadata only.
const timelineHelper =
  transport.match(/private patientTripTimeline[\s\S]*?\n  }\n\n  private async presentOperational/m)?.[0] ?? "";
assert.match(timelineHelper, /etaMinutes/);
assert.match(timelineHelper, /reasonCode/);
assert.match(timelineHelper, /source/);
assert.doesNotMatch(
  timelineHelper,
  /pickupLatitude|pickupLongitude|destinationLatitude|destinationLongitude|previousDestinationLatitude|previousDestinationLongitude/,
);

// Existing lifecycle remains authoritative.
for (const status of [
  "REQUESTED",
  "ASSIGNED",
  "EN_ROUTE",
  "ARRIVED",
  "TRANSPORTING",
  "COMPLETED",
]) {
  assert.ok(patientUi.includes(status), `missing Patient milestone ${status}`);
}
assert.match(transport, /notifyPatientById/);

// Patient UI surfaces milestone-only tracking and consolidated timeline.
assert.match(patientUi, /tripTracking/);
assert.match(patientUi, /timelineItems/);
assert.match(patientUi, /_tripProgress/);
assert.match(patientUi, /milestoneTrackingOnly/);
assert.match(patientUi, /Route \/ ETA updated/);
assert.doesNotMatch(patientUi, /background location|live vehicle location|location stream/i);

// Phase 8 is additive and migration-free.
assert.equal(
  migrations.some((name) => /phase8|trip.?timeline/i.test(name)),
  false,
  "Phase 8 must not add a Prisma migration.",
);

assert.match(doc, /MILESTONE_ONLY/);
assert.match(doc, /liveGpsTrackingAvailable = false/);
assert.match(doc, /Latitude and longitude remain optional/i);
assert.match(doc, /No Phase 8 database migration is required/i);

console.log("V2 Transport Phase 8 patient trip timeline acceptance passed");
