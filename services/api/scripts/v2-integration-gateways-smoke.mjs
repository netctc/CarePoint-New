import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const schema = read("../prisma/v2_integration_gateways.prisma");
const migration = read("../prisma/migrations/20260925010000_v2_integration_gateways/migration.sql");
const moduleSource = read("../src/modules/integration-gateways/integration-gateways.module.ts");
const app = read("../src/app.module.ts");
const orders = read("../src/modules/orders/orders.service.ts");
const center = read("../src/modules/admin-b6-operations/integration-center.service.ts");
const proxy = read("../../../apps/admin/app/api/admin/b6/[...segments]/route.ts");
const consoleUi = read("../../../apps/admin/components/IntegrationGatewayConsole.tsx");
const fhirPage = read("../../../apps/admin/app/integrations/fhir/page.tsx");
const labsPage = read("../../../apps/admin/app/integrations/labs/page.tsx");
const fhirRuntime = read("../src/modules/fhir/fhir.module.ts");

// BE-040 / ADM-103 — external gateway config + immutable versioned mappings.
assert.match(schema, /model FhirGatewayConfig/);
assert.match(schema, /model FhirResourceMapping/);
assert.match(schema, /@@unique\(\[configId, resourceType, direction, version\]\)/);
assert.match(migration, /FhirResourceMapping_status_check/);
assert.match(moduleSource, /@Controller\("admin\/integrations\/fhir"\)/);
assert.match(moduleSource, /FHIR_RESOURCE_MAPPING_CREATED/);
assert.match(moduleSource, /FHIR_RESOURCE_MAPPING_PUBLISHED/);
assert.match(moduleSource, /Only a DRAFT FHIR mapping can be published/);
assert.match(moduleSource, /status: "RETIRED"/);
assert.match(moduleSource, /mapping\.fields must contain between 1 and 100 entries/);
assert.match(moduleSource, /DIRECT/);
assert.match(moduleSource, /CODE_MAP/);
assert.match(moduleSource, /INTEGRATION_EGRESS_ALLOWLIST/);
assert.match(moduleSource, /Production activation requires a successful SANDBOX connectivity test/);
assert.match(moduleSource, /CapabilityStatement/);
assert.match(moduleSource, /FHIR_GATEWAY_CONNECTIVITY_TESTED/);
assert.match(moduleSource, /prisma\.integrationExchange\.create/);
assert.match(fhirRuntime, /@Controller\("fhir\/R4"\)/);
assert.match(fhirRuntime, /FhirService/);
assert.doesNotMatch(fhirRuntime, /FhirGatewayConfig|FhirResourceMapping/);

// BE-041 / ADM-104 — signed idempotent staging, versioned test mappings and professional release.
assert.match(schema, /model LabIntegrationConfig/);
assert.match(schema, /model LabTestMapping/);
assert.match(schema, /model ExternalLabResult/);
assert.match(schema, /@@unique\(\[configId, externalEventId\]\)/);
assert.match(moduleSource, /@Controller\("integrations\/labs"\)/);
assert.match(moduleSource, /@Public\(\)/);
assert.match(moduleSource, /x-carepoint-event-id/);
assert.match(moduleSource, /x-carepoint-signature/);
assert.match(moduleSource, /asymmetricKeyType !== "ed25519"/);
assert.match(moduleSource, /verifySignature\(null, message, key, signature\)/);
assert.match(moduleSource, /payloadDigest/);
assert.match(moduleSource, /duplicate: true/);
assert.match(moduleSource, /UNMAPPED_TEST_CODE/);
assert.match(moduleSource, /QUARANTINED/);
assert.match(moduleSource, /OrdersEnvelopeService/);
assert.match(moduleSource, /status: "IMPORTED"/);
assert.match(moduleSource, /@Controller\("provider\/external-lab-results"\)/);
assert.match(moduleSource, /@RequirePermissions\("LAB_RESULT_ENTER"\)/);
assert.match(moduleSource, /this\.orders\.enterLabResult/);
assert.match(moduleSource, /releaseState: "ENTERED"/);
assert.match(moduleSource, /patientVisible: false/);
assert.match(orders, /sourceType: "EXTERNAL_LAB"/);
assert.match(orders, /externalResultId/);
assert.match(orders, /externalOrderId/);
assert.match(orders, /status: "ENTERED"/);
assert.match(orders, /Only a validated laboratory result can be released/);

// Integration Center exposes governed state but never secret values.
assert.match(center, /governedGatewayConfigs/);
assert.match(center, /stagingEncrypted: true/);
assert.match(center, /professionalReleaseRequired: true/);
assert.match(center, /credentialReference/);
assert.doesNotMatch(center, /webhookPublicKeyPem/);

// Admin routes + UI exist in all product locales and expose sandbox/test/publish lifecycle.
assert.match(proxy, /integrations\/fhir/);
assert.match(proxy, /integrations\/labs/);
assert.match(fhirPage, /ADM-103 \/ BE-040/);
assert.match(labsPage, /ADM-104 \/ BE-041/);
assert.match(consoleUi, /IntegrationGatewayConsole/);
assert.match(consoleUi, /SANDBOX/);
assert.match(consoleUi, /PRODUCTION/);
assert.match(consoleUi, /webhookPublicKeyPem/);
assert.match(consoleUi, /mappings/);
assert.match(consoleUi, /\/publish/);
for (const locale of ["en","ar","fr","es"]) assert.match(consoleUi, new RegExp(locale + ":\\{"));

assert.match(app, /IntegrationGatewaysModule/);
assert.doesNotMatch(migration, /DROP TABLE|DROP COLUMN/);

console.log("V2 C2 FHIR + external laboratory gateways acceptance passed: BE-040/BE-041/ADM-103/ADM-104");

function read(relative) {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}
