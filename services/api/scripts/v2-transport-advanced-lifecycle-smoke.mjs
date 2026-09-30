import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/modules/transport/transport-advanced-lifecycle.module.ts", import.meta.url), "utf8");
const schema = readFileSync(new URL("../prisma/v2_transport_advanced_lifecycle.prisma", import.meta.url), "utf8");
const migration = readFileSync(new URL("../prisma/migrations/20260922190000_v2_transport_advanced_lifecycle/migration.sql", import.meta.url), "utf8");
const destinationMigration = readFileSync(new URL("../prisma/migrations/20260924043000_v2_transport_destination_change/migration.sql", import.meta.url), "utf8");
const appModule = readFileSync(new URL("../src/app.module.ts", import.meta.url), "utf8");
const transportApi = readFileSync(new URL("../../../packages/mobile_core/lib/transport_api.dart", import.meta.url), "utf8");
const transportWorkspace = readFileSync(new URL("../../../packages/mobile_core/lib/transport_workspace.dart", import.meta.url), "utf8");
const transportLocalization = readFileSync(new URL("../../../packages/mobile_core/lib/transport_localization.dart", import.meta.url), "utf8");

// Exact assigned-provider scope and controlled routes.
assert.match(source, /@Controller\("provider\/transport\/jobs"\)/);
assert.match(source, /@Get\(":id\/advanced-lifecycle"\)/);
assert.match(source, /@Post\(":id\/equipment-checks"\)/);
assert.match(source, /@Post\(":id\/route-revisions"\)/);
assert.match(source, /RequirePermissions\("TRANSPORT_RESPOND"\)/);
assert.match(source, /assignedProviderId: responder\.id/);
assert.match(source, /MEDICAL_TRANSPORT_GROUND/);
assert.match(source, /MEDICAL_TRANSPORT_AIR/);

// Equipment readiness derives requirements from the canonical transport request/unit.
assert.match(source, /requiredEquipment\(request\.assistance, request\.equipment\)/);
assert.match(source, /WHEELCHAIR/);
assert.match(source, /STRETCHER/);
assert.match(source, /currentCrew\.transportUnitId/);
assert.match(source, /unit\.capabilities/);
assert.match(source, /missingEquipment\.length === 0 \? "PASS" : "FAIL"/);
assert.match(source, /Equipment readiness can only be checked before patient transport starts/);

// Route revisions are bounded operational updates, not duplicate location records.
assert.match(source, /TRAFFIC/);
assert.match(source, /DIVERSION/);
assert.match(source, /ROAD_CLOSURE/);
assert.match(source, /WEATHER/);
assert.match(source, /FACILITY_DELAY/);
assert.match(source, /OPERATIONAL_UPDATE/);
assert.match(source, /etaMinutes must be an integer between 0 and 1440/);
assert.match(source, /medicalTransportRequest\.update\(\{ where: \{ id: request\.id \}, data: \{ etaMinutes \} \}\)/);
// Immutable route evidence may persist destination coordinates/address for controlled changes,
 // while pickup/contact data remain outside this lifecycle evidence model. Runtime projections below
 // remain the privacy boundary for responders.
 assert.doesNotMatch(schema, /pickupLatitude|pickupLongitude|pickupAddress|callbackPhone/i);

// Retry/concurrency safety and append-only evidence.
assert.match(source, /idempotencyKey/);
assert.match(source, /requestDigest/);
assert.match(source, /TransactionIsolationLevel\.Serializable/);
assert.match(source, /FOR UPDATE/);
assert.match(source, /MEDICAL_TRANSPORT_EQUIPMENT_CHECK_RECORDED/);
assert.match(source, /MEDICAL_TRANSPORT_ROUTE_REVISION_RECORDED/);
assert.match(schema, /model TransportEquipmentCheck/);
assert.match(schema, /model TransportRouteRevision/);
assert.match(schema, /@@unique\(\[transportRequestId, revision\]\)/);
assert.match(migration, /TransportEquipmentCheck_immutable_trigger/);
assert.match(migration, /TransportRouteRevision_immutable_trigger/);
assert.match(migration, /BEFORE UPDATE OR DELETE/);
assert.match(migration, /REVOKE UPDATE, DELETE ON "TransportEquipmentCheck"/);
assert.match(migration, /REVOKE UPDATE, DELETE ON "TransportRouteRevision"/);
assert.match(migration, /MedicalTransportRequest/);
assert.match(migration, /CrewAssignment/);
assert.match(migration, /TransportUnit/);

// Operational projection intentionally excludes patient/location/contact data.
assert.match(source, /patientIdentityReturned: false/);
assert.match(source, /pickupCoordinatesReturned: false/);
assert.match(source, /destinationCoordinatesReturned: false/);
assert.match(source, /addressesReturned: false/);
assert.match(source, /callbackPhoneReturned: false/);
const routeProjection = source.match(
  /routeRevisions:\s*revisions\.map\(\(revision\) => \(\{[\s\S]*?\}\)\),\s*privacyBoundary:/,
)?.[0] ?? "";
assert.ok(routeProjection, "advanced lifecycle route projection must remain explicit");
assert.doesNotMatch(source, /pickupAddress\s*:/);
assert.doesNotMatch(source, /pickupLatitude\s*:/);
assert.doesNotMatch(source, /callbackPhone\s*:/);
assert.doesNotMatch(routeProjection, /destinationAddress\s*:/);
assert.doesNotMatch(routeProjection, /destinationLatitude\s*:/);
assert.doesNotMatch(routeProjection, /destinationLongitude\s*:/);

// PRV-086 controlled destination change extends the immutable route revision rather than overwriting history.
assert.match(source, /@Post\(":id\/destination-change"\)/);
assert.match(source, /async destinationChange/);
assert.match(source, /DESTINATION_REASONS/);
assert.match(source, /FACILITY_UNAVAILABLE/);
assert.match(source, /DISPATCH_REDIRECT/);
assert.match(source, /PATIENT_REQUEST/);
assert.match(source, /OPERATIONAL_CHANGE/);
assert.match(source, /previousDestinationLatitude: locked\.destinationLatitude/);
assert.match(source, /previousDestinationLongitude: locked\.destinationLongitude/);
assert.match(source, /previousDestinationAddress: locked\.destinationAddress/);
assert.match(source, /destinationLatitude,/);
assert.match(source, /destinationLongitude,/);
assert.match(source, /etaMinutes: null/);
assert.match(source, /MEDICAL_TRANSPORT_DESTINATION_CHANGED/);
assert.match(source, /destinationAddressPresent: destinationAddress !== null/);
assert.match(source, /New destination must differ from the current destination/);
assert.match(schema, /previousDestinationLatitude/);
assert.match(schema, /previousDestinationLongitude/);
assert.match(schema, /destinationLatitude/);
assert.match(schema, /destinationLongitude/);
assert.match(destinationMigration, /previous_destination_pair_check/);
assert.match(destinationMigration, /destination_pair_check/);
assert.match(transportApi, /changeProviderTransportDestination/);
assert.match(transportWorkspace, /transport-destination-change-/);
assert.match(transportWorkspace, /changeProviderTransportDestination/);
assert.match(transportLocalization, /changeDestination/);
for (const token of ["CarePointLocale.en","CarePointLocale.ar","CarePointLocale.fr","CarePointLocale.es"]) {
  assert.ok(transportLocalization.includes(token));
}

assert.match(appModule, /TransportAdvancedLifecycleModule/);

console.log("BE-032 / PRV-086 advanced transport lifecycle and controlled destination change acceptance passed");
