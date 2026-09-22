import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const transportResourcesSource = readFileSync(
  new URL("../src/modules/transport/transport-resources.module.ts", import.meta.url),
  "utf8",
);
assert.match(transportResourcesSource, /@Get\(":id\/resources"\)/);
assert.match(transportResourcesSource, /@Patch\(":id\/resources"\)/);
assert.match(transportResourcesSource, /RequirePermissions\("TRANSPORT_RESPOND"\)/);
assert.match(transportResourcesSource, /assignedProviderId:\s*responder\.id/);
assert.match(transportResourcesSource, /active:\s*true/);
assert.match(transportResourcesSource, /unitCompatible/);
assert.match(transportResourcesSource, /missingCurrentCredentialTypes/);
assert.match(transportResourcesSource, /MEDICAL_TRANSPORT_RESOURCES_CHANGED/);
assert.match(transportResourcesSource, /TransactionIsolationLevel\.Serializable/);
assert.match(transportResourcesSource, /idempotencyKey/);
assert.match(transportResourcesSource, /crewProviderIds/);
assert.match(transportResourcesSource, /WHEELCHAIR/);
assert.match(transportResourcesSource, /STRETCHER/);

const transportResourceSchema = readFileSync(
  new URL("../prisma/v2_transport_resources.prisma", import.meta.url),
  "utf8",
);
assert.match(transportResourceSchema, /model TransportUnit/);
assert.match(transportResourceSchema, /model CrewAssignment/);
assert.match(transportResourceSchema, /crewProviderIds\s+String\[\]/);
assert.match(transportResourceSchema, /payloadHash/);
assert.match(transportResourceSchema, /idempotencyKey/);

const transportResourceMigration = readFileSync(
  new URL("../prisma/migrations/20260922003000_v2_transport_resources/migration.sql", import.meta.url),
  "utf8",
);
assert.match(transportResourceMigration, /TransportUnit_capabilities_ck/);
assert.match(transportResourceMigration, /CrewAssignment_immutable_trigger/);
assert.match(transportResourceMigration, /REVOKE UPDATE, DELETE ON "CrewAssignment"/);
assert.match(transportResourceMigration, /MedicalTransportRequest/);
assert.match(transportResourceMigration, /Provider/);

const transportApiSource = readFileSync(
  new URL("../../../packages/mobile_core/lib/transport_api.dart", import.meta.url),
  "utf8",
);
assert.match(transportApiSource, /providerMedicalTransportResources/);
assert.match(transportApiSource, /updateProviderMedicalTransportResources/);
assert.match(transportApiSource, /'PATCH', '\/provider\/medical-transport\/\$requestId\/resources'/);

const transportMobileSource = readFileSync(
  new URL("../../../packages/mobile_core/lib/transport_workspace.dart", import.meta.url),
  "utf8",
);
assert.match(transportMobileSource, /_TransportResourcesSheet/);
assert.match(transportMobileSource, /crewProviderIds:/);
assert.match(transportMobileSource, /transportUnitId:/);
assert.match(transportMobileSource, /selectedCrewIds\.isNotEmpty/);
assert.match(transportMobileSource, /resourcesLocked/);

const transportLocalizationSource = readFileSync(
  new URL("../../../packages/mobile_core/lib/transport_localization.dart", import.meta.url),
  "utf8",
);
assert.match(transportLocalizationSource, /'crewUnit': 'Crew & unit'/);
assert.match(transportLocalizationSource, /'crewUnit': 'الطاقم والمركبة'/);
assert.match(transportLocalizationSource, /'crewUnit': 'Équipe et véhicule'/);
assert.match(transportLocalizationSource, /'crewUnit': 'Tripulación y unidad'/);

console.log("V2 PRV-082 transport resources acceptance passed");
