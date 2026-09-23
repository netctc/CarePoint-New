import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const moduleSource = read("../src/modules/observation/observation.module.ts");
const service = read("../src/modules/observation/observation.service.ts");
const page = read("../../../apps/admin/app/clinical-config/observations/page.tsx");
const manager = read("../../../apps/admin/components/ClinicalMetricsManager.tsx");
const shell = read("../../../apps/admin/components/AppShell.tsx");
const root = read("../../../apps/admin/app/api/admin/clinical-metrics/route.ts");
const unit = read("../../../apps/admin/app/api/admin/clinical-metrics/units/route.ts");
const conversion = read("../../../apps/admin/app/api/admin/clinical-metrics/unit-conversions/route.ts");
const version = read("../../../apps/admin/app/api/admin/clinical-metrics/[metricId]/versions/route.ts");
const activate = read("../../../apps/admin/app/api/admin/clinical-metrics/[metricId]/versions/[version]/activate/route.ts");

// ADM-078/079 reuse the versioned Observation domain.
assert.match(moduleSource, /@Controller\("admin\/clinical-metrics"\)/);
assert.match(moduleSource, /@Post\("units"\)/);
assert.match(moduleSource, /@Post\("unit-conversions"\)/);
assert.match(moduleSource, /@Post\(":metricId\/versions"\)/);
assert.match(moduleSource, /@Post\(":metricId\/versions\/:version\/activate"\)/);
assert.match(moduleSource, /CATALOG_MANAGE/);

assert.match(service, /adminCatalog/);
assert.match(service, /measurementUnit\.findMany/);
assert.match(service, /unitConversion\.findMany/);
assert.match(service, /observationType\.findMany/);
assert.match(service, /Unit conversion dimensions must match/);
assert.match(service, /allowedUnitCodes must include canonicalUnitCode/);
assert.match(service, /status: "RETIRED"/);
assert.match(service, /status: "ACTIVE"/);
assert.match(service, /originalValue/);

// BFF mutations must stay same-origin and authenticated through forwardAdminJson.
for (const source of [root, unit, conversion, version, activate]) {
  assert.match(source, /forwardAdminJson/);
}
for (const source of [root, unit, conversion, version, activate]) {
  if (/export async function POST/.test(source)) assert.match(source, /requireSameOrigin: true/);
}

// Admin surface exposes the full governed workflow and multilingual labels.
assert.match(page, /ClinicalMetricsManager/);
assert.match(shell, /\/clinical-config\/observations/);
assert.match(manager, /\/api\/admin\/clinical-metrics/);
assert.match(manager, /unit-conversions/);
assert.match(manager, /createVersion/);
assert.match(manager, /activate/);
assert.match(manager, /allowedUnitCodes/);
for (const locale of ["en:", "ar:", "fr:", "es:"]) assert.match(manager, new RegExp(locale));

console.log("ADM-078/ADM-079 clinical metrics and units Admin UI acceptance passed");

function read(relative) {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}
