import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const service = read("../src/modules/terminology/terminology.service.ts");
const moduleSource = read("../src/modules/terminology/terminology.module.ts");
const page = read("../../../apps/admin/app/medication-catalog/page.tsx");
const proxy = read("../../../apps/admin/app/api/admin/medication-catalog/status/route.ts");
const nav = read("../../../apps/admin/components/AppShell.tsx");

assert.match(moduleSource, /@Controller\("admin\/medication-catalog"\)/);
assert.match(moduleSource, /@Get\("status"\)/);
assert.match(moduleSource, /RequirePermissions\("CATALOG_MANAGE"\)/);
assert.match(moduleSource, /Cache-Control", "no-store/);

assert.match(service, /async medicationCatalogStatus/);
assert.match(service, /codingSystem\.findMany/);
assert.match(service, /terminologyConcept\.count/);
assert.match(service, /terminologyConceptVersion\.findFirst/);
assert.match(service, /externalCatalogMapping\.count/);
assert.match(service, /externalCatalogMapping\.findFirst/);
assert.match(service, /distinct: \["sourceSystem"\]/);
assert.match(service, /MEDICATION_CODING_SYSTEM_NOT_CONFIGURED/);
assert.match(service, /NO_ACTIVE_MEDICATION_CONCEPTS/);
assert.match(service, /NO_ACTIVE_EXTERNAL_MAPPINGS/);
assert.match(service, /syncMode: "VERSIONED_LOCAL_MAPPING"/);
assert.match(service, /externalSyncConfigured: false/);
assert.match(service, /lastExternalSyncAt: null/);
assert.match(service, /secretsExposed: false/);
assert.match(service, /credentialValuesIncluded: false/);
assert.match(service, /clinicalDataIncluded: false/);
assert.match(service, /externalCatalogSeparateFromClinicalData: true/);
assert.match(service, /MEDICATION_CATALOG_STATUS_READ/);
assert.doesNotMatch(service, /fetch\(/);
assert.doesNotMatch(service, /axios/);
assert.doesNotMatch(service, /patientProfile|clinicalRecord|clinicalEncounter/i);

assert.match(proxy, /forwardAdminJson\(request, "\/admin\/medication-catalog\/status"\)/);
assert.doesNotMatch(proxy, /POST|PATCH|DELETE/);

assert.match(page, /P2 · ADM-085/);
assert.match(page, /lastExternalSyncAt/);
assert.match(page, /externalSourceSystems/);
assert.match(page, /clinicalDataIncluded/);
assert.match(page, /secretsExposed/);
assert.match(nav, /href="\/medication-catalog"/);
for (const text of ["Medication Catalog","كتالوج الأدوية","Catalogue des médicaments","Catálogo de medicamentos"]) {
  assert.ok(nav.includes(text), `Missing medication catalog navigation translation: ${text}`);
}

console.log("ADM-085 medication catalog status acceptance passed");

function read(relative) {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}
