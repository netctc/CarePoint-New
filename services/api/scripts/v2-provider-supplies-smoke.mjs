import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const schema = read("../prisma/v2_provider_supplies.prisma");
const migration = read("../prisma/migrations/20260924043000_v2_provider_supplies/migration.sql");
const moduleSource = read("../src/modules/provider-supplies/provider-supplies.module.ts");
const capabilities = read("../src/modules/providers/provider-category-capabilities.ts");
const app = read("../src/app.module.ts");
const api = read("../../../packages/mobile_core/lib/carepoint_api.dart");
const mobile = read("../../../packages/mobile_core/lib/provider_supplies.dart");
const providerMain = read("../../../apps/provider-mobile/lib/main.dart");
const taxonomy = read("../../../apps/admin/app/providers/taxonomy/page.tsx");

assert.match(capabilities, /"SUPPLY_TRACKING"/);
assert.match(taxonomy, /"SUPPLY_TRACKING"/);
assert.match(moduleSource, /assertWorkflowCapability\(principal, "SUPPLY_TRACKING"\)/);

assert.match(schema, /model SupplyItem/);
assert.match(schema, /model SupplyUsage/);
assert.match(schema, /idempotencyKey\s+String\s+@unique/);
assert.match(schema, /quantity\s+Decimal/);
assert.doesNotMatch(schema, /diagnosis|symptom|clinicalNote|freeText/i);
assert.match(migration, /SupplyUsage_quantity_ck/);
assert.match(migration, /SupplyUsage_immutable_trigger/);
assert.match(migration, /BEFORE UPDATE OR DELETE/);
assert.match(migration, /REVOKE UPDATE, DELETE ON "SupplyUsage"/);
assert.doesNotMatch(migration, /DROP TABLE|DROP COLUMN/);

assert.match(moduleSource, /@Controller\("admin\/supplies\/catalog"\)/);
assert.match(moduleSource, /RequirePermissions\("CATALOG_MANAGE"\)/);
assert.match(moduleSource, /@Controller\("provider"\)/);
assert.match(moduleSource, /@Get\("supplies\/catalog"\)/);
assert.match(moduleSource, /@Get\("jobs\/:jobId\/supplies"\)/);
assert.match(moduleSource, /@Post\("jobs\/:jobId\/supplies"\)/);
assert.match(moduleSource, /RequirePermissions\("OTHER_PROVIDER_WORKFLOW_EXECUTE"\)/);
assert.match(moduleSource, /where: \{ id: sourceId, providerId, modality: "HOME_VISIT" \}/);
assert.match(moduleSource, /where: \{ id: sourceId, assignedProviderId: providerId \}/);
assert.match(moduleSource, /source\.status !== "CONFIRMED"/);
assert.match(moduleSource, /WRITABLE_TRANSPORT/);
assert.match(moduleSource, /An active supply catalog item is required/);
assert.match(moduleSource, /unitCode must match the supply item's canonical unit/);
assert.match(moduleSource, /quantity supports at most three decimal places/);
assert.match(moduleSource, /TransactionIsolationLevel\.Serializable/);
assert.match(moduleSource, /FOR UPDATE/);
assert.match(moduleSource, /SUPPLY_USAGE_RECORDED/);
assert.match(moduleSource, /clinicalDataIncluded: false/);
assert.match(app, /ProviderSuppliesModule/);

assert.match(api, /providerSupplyCatalog/);
assert.match(api, /providerJobSupplies/);
assert.match(api, /recordProviderJobSupply/);
assert.match(api, /Uri\.encodeComponent\(jobId\)/);
assert.match(mobile, /workflowCapabilities\.contains\('SUPPLY_TRACKING'\)/);
assert.match(mobile, /ProviderSuppliesPage/);
assert.match(mobile, /providerFieldJobs/);
assert.match(mobile, /unitCode: item\['unitCode'\]\.toString\(\)/);
assert.match(providerMain, /ProviderSuppliesLauncher/);
for (const locale of ["CarePointLocale.en","CarePointLocale.ar","CarePointLocale.fr","CarePointLocale.es"]) {
  assert.ok(mobile.includes(locale), `Missing supplies locale ${locale}`);
}

console.log("PRV-092 capability-bound Provider job supplies acceptance passed");

function read(relative) {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}
