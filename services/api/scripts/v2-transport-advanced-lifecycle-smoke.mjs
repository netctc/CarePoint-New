import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/modules/transport/transport-advanced-lifecycle.module.ts", import.meta.url), "utf8");
const schema = readFileSync(new URL("../prisma/v2_transport_advanced_lifecycle.prisma", import.meta.url), "utf8");
const migration = readFileSync(new URL("../prisma/migrations/20260922190000_v2_transport_advanced_lifecycle/migration.sql", import.meta.url), "utf8");
const appModule = readFileSync(new URL("../src/app.module.ts", import.meta.url), "utf8");

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
assert.doesNotMatch(schema, /latitude|longitude|address|callbackPhone/i);

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
assert.doesNotMatch(source, /pickupAddress\s*:/);
assert.doesNotMatch(source, /destinationAddress\s*:/);
assert.doesNotMatch(source, /pickupLatitude\s*:/);
assert.doesNotMatch(source, /destinationLatitude\s*:/);
assert.doesNotMatch(source, /callbackPhone\s*:/);

assert.match(appModule, /TransportAdvancedLifecycleModule/);

console.log("BE-032 advanced transport equipment checks and route revisions acceptance passed");
