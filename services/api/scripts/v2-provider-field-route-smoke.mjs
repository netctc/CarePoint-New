import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { FieldRouteMapsAdapter } = require("../dist/modules/other-provider-workspace/provider-field-route.maps.js");

const source = readFileSync(new URL("../src/modules/other-provider-workspace/provider-field-route.module.ts", import.meta.url), "utf8");
const maps = readFileSync(new URL("../src/modules/other-provider-workspace/provider-field-route.maps.ts", import.meta.url), "utf8");
const schema = readFileSync(new URL("../prisma/v2_field_route.prisma", import.meta.url), "utf8");
const migration = readFileSync(new URL("../prisma/migrations/20260922214500_v2_field_route/migration.sql", import.meta.url), "utf8");
const appModule = readFileSync(new URL("../src/app.module.ts", import.meta.url), "utf8");
const mobile = readFileSync(new URL("../../../packages/mobile_core/lib/provider_field_route.dart", import.meta.url), "utf8");
const queue = readFileSync(new URL("../../../packages/mobile_core/lib/provider_work_queue.dart", import.meta.url), "utf8");

// PRV-074: assigned HOME_VISIT route/ETA over the validated booking destination.
assert.match(source, /@Controller\("provider\/jobs\/:jobId\/route"\)/);
assert.match(source, /@Get\(\)/);
assert.match(source, /@Post\("estimate"\)/);
assert.match(source, /appointmentVisitContext\.findUnique/);
assert.match(source, /visit\.modality !== "HOME_VISIT"/);
assert.match(source, /visit\.addressValidatedAt/);
assert.match(source, /serviceDeliveryContext\.findUnique/);
assert.match(source, /homeCoverageCenterLatitude/);
assert.match(source, /homeCoverageCenterLongitude/);
assert.match(source, /enabledModalities/);
assert.match(source, /HOME_VISIT/);

// Provider current coordinates are accepted only as ephemeral input. They are never put in the
// persistence model, evidence payload, patient projection, or route history.
assert.match(source, /currentLatitude/);
assert.match(source, /currentLongitude/);
assert.match(source, /PROVIDER_CURRENT_EPHEMERAL/);
assert.match(source, /Deliberately excludes provider coordinates/);
assert.match(source, /providerLocationPersisted:\s*false/);
assert.match(source, /providerLocationHistoryPersisted:\s*false/);
assert.match(source, /routeGeometryPersisted:\s*false/);
assert.doesNotMatch(schema, /latitude|longitude|origin|geometry/i);
assert.match(schema, /model FieldRouteEstimate/);
assert.match(schema, /etaMinutes\s+Int/);
assert.match(schema, /distanceMeters\s+Int/);
assert.match(schema, /idempotencyKey\s+String\s+@unique/);

// Estimates are idempotent, ordered, serializable and append-only.
assert.match(source, /idempotencyKey/);
assert.match(source, /requestDigest/);
assert.match(source, /TransactionIsolationLevel\.Serializable/);
assert.match(source, /FOR UPDATE/);
assert.match(source, /revision:\s*\(prior\?\.revision \?\? 0\) \+ 1/);
assert.match(migration, /FieldRouteEstimate_immutable_trigger/);
assert.match(migration, /BEFORE UPDATE OR DELETE/);
assert.match(migration, /REVOKE UPDATE, DELETE ON "FieldRouteEstimate"/);
assert.match(migration, /source_ck.*MAPBOX.*DIRECT_DISTANCE_V1/s);

// External routing obeys the repository egress boundary and degrades without blocking care.
assert.match(maps, /^const MAPBOX_HOST = "api\\.mapbox\\.com";$/m);
assert.match(maps, /url\.hostname !== MAPBOX_HOST/);
assert.match(maps, /url\.protocol !== "https:"/);
assert.match(maps, /url\.port !== ""/);
assert.match(maps, /toFixed\(6\)/);
assert.match(maps, /redirect:\s*"error"/);
assert.match(maps, /AbortController/);
assert.match(maps, /readBoundedProviderJsonObject/);
assert.match(maps, /discardProviderResponseBody/);
assert.match(maps, /DIRECT_DISTANCE_V1/);
assert.match(maps, /providerState:\s*"DEGRADED"/);
assert.match(maps, /FIELD_ROUTE_MAPS_PROVIDER/);
assert.match(maps, /MAPBOX_ACCESS_TOKEN/);

const priorProvider = process.env.FIELD_ROUTE_MAPS_PROVIDER;
try {
  process.env.FIELD_ROUTE_MAPS_PROVIDER = "DISABLED";
  const direct = await new FieldRouteMapsAdapter().estimate(
    { latitude: 33.89, longitude: 35.50 },
    { latitude: 33.91, longitude: 35.55 },
  );
  assert.equal(direct.source, "DIRECT_DISTANCE_V1");
  assert.equal(direct.providerState, "DISABLED");
  assert.ok(direct.distanceMeters > 0);
  assert.ok(direct.etaMinutes > 0);
  assert.equal(direct.geometry, null);
} finally {
  if (priorProvider == null) delete process.env.FIELD_ROUTE_MAPS_PROVIDER;
  else process.env.FIELD_ROUTE_MAPS_PROVIDER = priorProvider;
}

// Patient projection is deliberately narrower than the provider route view.
assert.match(source, /@Controller\("patient\/appointments"\)/);
assert.match(source, /@Get\(":appointmentId\/eta"\)/);
assert.match(source, /providerLocation:\s*null/);
assert.match(source, /providerLocationHistory:\s*\[\]/);
assert.match(source, /routeGeometry:\s*null/);
assert.match(source, /destinationCoordinatesExposed:\s*false/);
assert.match(source, /providerLocationExposed:\s*false/);
assert.match(source, /patientProjection:\s*\["STATUS", "ETA_MINUTES", "ESTIMATED_AT"\]/);

// Provider Mobile exposes route assistance from the existing prioritized HOME_VISIT queue.
assert.match(mobile, /class ProviderFieldRoutePage/);
assert.match(mobile, /ProviderFieldRouteApi/);
assert.match(mobile, /\/provider\/jobs\/.*\/route/);
assert.match(mobile, /geo:/);
assert.match(mobile, /LaunchMode\.externalApplication/);
assert.match(mobile, /Provider location is not stored/);
assert.match(queue, /ProviderFieldRoutePage/);
assert.match(queue, /kind == 'HOME_VISIT'/);
assert.match(queue, /openRoute/);
assert.match(appModule, /ProviderFieldRouteModule/);

console.log("V2 PRV-074 privacy-safe home visit route and ETA acceptance passed");
