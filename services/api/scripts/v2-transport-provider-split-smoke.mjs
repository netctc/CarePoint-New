import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const adminPage = readFileSync(
  new URL("../../../apps/admin/app/transport-providers/page.tsx", import.meta.url),
  "utf8",
);
const adminScope = readFileSync(
  new URL("../../../apps/admin/lib/transport-provider-scope.ts", import.meta.url),
  "utf8",
);
const adminRuntime = readFileSync(
  new URL("../../../apps/admin/lib/runtime-features.ts", import.meta.url),
  "utf8",
);
const patientRuntime = readFileSync(
  new URL("../../../apps/patient-mobile/lib/runtime_features.dart", import.meta.url),
  "utf8",
);
const patientTransport = readFileSync(
  new URL("../../../apps/patient-mobile/lib/patient_transport.dart", import.meta.url),
  "utf8",
);
const patientLocation = readFileSync(
  new URL("../../../apps/patient-mobile/lib/patient_transport_location.dart", import.meta.url),
  "utf8",
);
const mobileLocation = readFileSync(
  new URL("../../../packages/mobile_core/lib/transport_location.dart", import.meta.url),
  "utf8",
);
const mobileWorkspace = readFileSync(
  new URL("../../../packages/mobile_core/lib/transport_workspace.dart", import.meta.url),
  "utf8",
);
const mobileApi = readFileSync(
  new URL("../../../packages/mobile_core/lib/transport_api.dart", import.meta.url),
  "utf8",
);
const companySchema = readFileSync(
  new URL("../prisma/v2_transport_company.prisma", import.meta.url),
  "utf8",
);
const resourceSchema = readFileSync(
  new URL("../prisma/v2_transport_resources.prisma", import.meta.url),
  "utf8",
);
const companyModule = readFileSync(
  new URL("../src/modules/transport/admin-transport-company.module.ts", import.meta.url),
  "utf8",
);
const resourceModule = readFileSync(
  new URL("../src/modules/transport/transport-resources.module.ts", import.meta.url),
  "utf8",
);
const transportContracts = readFileSync(
  new URL("../../../packages/contracts/src/transport.ts", import.meta.url),
  "utf8",
);

// Feature flag remains presentation/configuration only and defaults off.
assert.match(adminRuntime, /TRANSPORT_MODULE_ENABLED/);
assert.match(adminRuntime, /transportModuleEnabled:\s*enabled/);
assert.match(patientRuntime, /TRANSPORT_MODULE_ENABLED/);
assert.match(patientRuntime, /defaultValue:\s*false/);
assert.match(adminPage, /adminRuntimeFeatures\(\)\.transportModuleEnabled/);
assert.match(adminPage, /notFound\(\)/);

// Canonical transport families are kept separate from generic Other Providers.
for (const family of [
  "MEDICAL_TRANSPORT_GROUND",
  "MEDICAL_TRANSPORT_AIR",
  "EMERGENCY_AMBULANCE",
]) {
  assert.ok(adminScope.includes(family), `missing transport family ${family}`);
}

// Company + crew are additive organization layers.
assert.match(companySchema, /model TransportCompany/);
assert.match(companySchema, /providerIds\s+String\[\]/);
assert.match(companySchema, /unitIds\s+String\[\]/);
assert.match(companySchema, /model TransportCrewMember/);
assert.match(companySchema, /providerId\s+String\?/);
assert.match(companySchema, /licenseValidUntil\s+DateTime\?/);
assert.match(companyModule, /ADMIN_TRANSPORT_COMPANY_CREATED/);
assert.match(companyModule, /ADMIN_TRANSPORT_CREW_CREATED/);
assert.match(companyModule, /A Transport Provider or fleet unit can belong to only one Transport Company/);
assert.match(companyModule, /already linked to another crew member in this company/);

// Dispatch assignment reuses existing lifecycle endpoints rather than duplicating state changes.
const adminProxy = readFileSync(
  new URL("../../../apps/admin/app/api/admin/transport/[...segments]/route.ts", import.meta.url),
  "utf8",
);
assert.match(adminProxy, /\/operations\/medical-transport\//);
assert.match(adminProxy, /\/operations\/emergency\/ambulance\//);

// Scheduled and emergency resources keep independent immutable-style revision histories.
assert.match(resourceSchema, /model CrewAssignment/);
assert.match(resourceSchema, /model EmergencyCrewAssignment/);
assert.match(resourceSchema, /@@unique\(\[emergencyRequestId, revision\]\)/);
assert.match(resourceModule, /MEDICAL_TRANSPORT_RESOURCES_CHANGED/);
assert.match(resourceModule, /EMERGENCY_TRANSPORT_RESOURCES_CHANGED/);
assert.match(resourceModule, /TransactionIsolationLevel\.Serializable/);
assert.match(resourceModule, /FOR UPDATE/);
assert.match(resourceModule, /activeCompanyForProvider/);
assert.match(resourceModule, /LEGACY_PROVIDER_SCOPE/);

// Transport Provider mobile supports company context and both resource domains.
assert.match(mobileApi, /providerTransportCompanyContext/);
assert.match(mobileApi, /providerEmergencyAmbulanceResources/);
assert.match(mobileApi, /updateProviderEmergencyAmbulanceResources/);
assert.match(mobileWorkspace, /emergency-transport-resources-/);
assert.match(mobileWorkspace, /providerEmergencyAmbulanceResources/);

// Location coordinates remain optional as a pair.
assert.match(transportContracts, /pickupLatitude\?:/);
assert.match(transportContracts, /pickupLongitude\?:/);
assert.match(transportContracts, /destinationLatitude\?:/);
assert.match(transportContracts, /destinationLongitude\?:/);
assert.match(patientTransport, /Latitude and longitude are optional/);
assert.match(patientTransport, /pickupAddressValue\.isEmpty && pickupLat == null/);
assert.match(patientTransport, /destinationAddressValue\.isEmpty && destinationLat == null/);

// GPS is abstracted; scheduled pickup may reuse current device location.
assert.match(mobileLocation, /class TransportLocation/);
assert.match(mobileLocation, /abstract interface class CurrentDeviceTransportLocationProvider/);
assert.match(mobileLocation, /abstract interface class TransportGeocodingProvider/);
assert.match(patientLocation, /implements CurrentDeviceTransportLocationProvider/);
assert.match(patientTransport, /useCurrentLocation/);
assert.match(patientTransport, /_currentTransportLocation/);

// No map/geocoding vendor is hard-wired by Phase 2.
for (const vendor of ["google_maps_flutter", "mapbox", "here_sdk"]) {
  assert.doesNotMatch(patientTransport.toLowerCase(), new RegExp(vendor));
  assert.doesNotMatch(mobileLocation.toLowerCase(), new RegExp(vendor));
}

// Admin operational analytics remain non-clinical by contract.
assert.match(companyModule, /ADMIN_TRANSPORT_ANALYTICS_READ/);
assert.match(companyModule, /ADMIN_TRANSPORT_AUDIT_READ/);
assert.doesNotMatch(companyModule, /clinicalNote|diagnosis|prescriptionText|medicalHistory/i);

console.log("V2 Transport Provider split Phase 2 contract acceptance passed");
