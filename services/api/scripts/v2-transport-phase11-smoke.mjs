import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const moduleSource = readFileSync(
  new URL("../src/modules/transport/transport-performance-analytics.module.ts", import.meta.url),
  "utf8",
);
const appModule = readFileSync(
  new URL("../src/app.module.ts", import.meta.url),
  "utf8",
);
const panel = readFileSync(
  new URL("../../../apps/admin/components/TransportPerformanceAnalyticsPanel.tsx", import.meta.url),
  "utf8",
);
const adminPage = readFileSync(
  new URL("../../../apps/admin/app/transport-providers/page.tsx", import.meta.url),
  "utf8",
);
const proxy = readFileSync(
  new URL("../../../apps/admin/app/api/admin/transport/[...segments]/route.ts", import.meta.url),
  "utf8",
);
const docs = readFileSync(
  new URL("../../../docs/transport-capacity-analytics-phase11.md", import.meta.url),
  "utf8",
);

// Module registration and permission.
assert.match(appModule, /TransportPerformanceAnalyticsModule/);
assert.match(
  moduleSource,
  /@Controller\("admin\/transport\/performance-analytics"\)/,
);
assert.match(moduleSource, /@RequirePermissions\("TRANSPORT_OPERATE"\)/);
assert.match(moduleSource, /@Query\("windowDays"\)/);
assert.match(moduleSource, /@Query\("forecastDays"\)/);

// Query bounds.
assert.match(
  moduleSource,
  /boundedInteger\(windowDaysRaw, 90, 7, 365, "windowDays"\)/,
);
assert.match(
  moduleSource,
  /boundedInteger\([\s\S]*forecastDaysRaw,[\s\S]*14,[\s\S]*1,[\s\S]*30,[\s\S]*"forecastDays"/,
);

// No Phase 11 persistence/migration.
assert.equal(
  existsSync(
    new URL("../prisma/v2_transport_capacity_analytics.prisma", import.meta.url),
  ),
  false,
);
assert.equal(
  existsSync(
    new URL(
      "../prisma/migrations/20260930220000_v2_transport_capacity_analytics/migration.sql",
      import.meta.url,
    ),
  ),
  false,
);

// SLA semantics keep pending requests out of breach denominators.
assert.match(moduleSource, /assignmentPendingWithinSla \+= 1/);
assert.match(moduleSource, /assignmentEvaluated \+= 1/);
assert.match(moduleSource, /assignmentBreached \+= 1/);
assert.match(moduleSource, /resourceReadyEvaluated \+= 1/);
assert.match(moduleSource, /resourceReadyBreached \+= 1/);
assert.match(moduleSource, /departurePendingWithinGrace \+= 1/);
assert.match(moduleSource, /departureEvaluated \+= 1/);
assert.match(moduleSource, /departureBreached \+= 1/);
assert.match(
  moduleSource,
  /compliancePercent:\s*this\.rate\(\s*assignmentWithinSla,\s*assignmentEvaluated/,
);
assert.match(
  moduleSource,
  /compliancePercent:\s*this\.rate\(\s*resourceReadyWithinSla,\s*resourceReadyEvaluated/,
);
assert.match(
  moduleSource,
  /compliancePercent:\s*this\.rate\(\s*departureWithinSla,\s*departureEvaluated/,
);

// Current active jobs and capacity horizon are independent of historical/forecast selectors.
assert.match(
  moduleSource,
  /status:\s*\{ in: \["ASSIGNED", "EN_ROUTE", "ARRIVED", "TRANSPORTING"\] \}/,
);
assert.match(moduleSource, /for \(const request of activeCurrent\)/);
assert.match(
  moduleSource,
  /Math\.max\(forecastDays, 7\) \* 24 \* 60 \* 60 \* 1000/,
);
assert.match(moduleSource, /upcoming24h:/);
assert.match(moduleSource, /upcoming72h:/);
assert.match(moduleSource, /upcoming7d:/);

// Deterministic planning only.
assert.match(
  moduleSource,
  /forecastMethod:\s*"SAME_WEEKDAY_HISTORICAL_AVERAGE"/,
);
assert.match(moduleSource, /machineLearning:\s*false/);
assert.match(moduleSource, /capacityGuarantee:\s*false/);
assert.match(moduleSource, /providerRanking:\s*false/);
for (const signal of [
  "NO_ACTIVE_UNITS",
  "BOOKED_ABOVE_HISTORICAL_WEEKDAY_AVERAGE",
  "BOOKED_NEAR_OR_ABOVE_HISTORICAL_AVERAGE",
  "WITHIN_HISTORICAL_RANGE",
]) {
  assert.match(moduleSource, new RegExp(signal));
}

// Provider evidence is volume-sorted, not quality-ranked.
assert.match(moduleSource, /historicalByProvider/);
assert.match(
  moduleSource,
  /b\.requests - a\.requests \|\|\s*a\.displayName\.localeCompare\(b\.displayName\)/,
);
assert.match(moduleSource, /completionRatePercent/);
assert.match(moduleSource, /onTimeDepartureRatePercent/);
assert.match(moduleSource, /incidents:/);
assert.match(moduleSource, /escalations:/);

// Read-only analytics: no lifecycle mutation or assignment.
assert.doesNotMatch(moduleSource, /medicalTransportRequest\.update/);
assert.doesNotMatch(moduleSource, /medicalTransportRequest\.updateMany/);
assert.doesNotMatch(moduleSource, /assignedProviderId:\s*provider/);
assert.doesNotMatch(moduleSource, /transportOperationalEscalation\.(create|update|upsert)/);

// Performance safeguards.
assert.match(moduleSource, /take:\s*20_000/);
assert.match(moduleSource, /take:\s*10_000/);
assert.match(moduleSource, /firstReadyAssignmentByRequest/);
assert.match(moduleSource, /routesByRequest/);
assert.match(moduleSource, /historicalByProvider/);

// Audit evidence.
assert.match(
  moduleSource,
  /ADMIN_TRANSPORT_PERFORMANCE_ANALYTICS_READ/,
);
assert.match(moduleSource, /analyticsWindowDays:/);
assert.match(moduleSource, /forecastDays,/);
assert.match(moduleSource, /machineLearning:\s*false/);
assert.match(moduleSource, /capacityGuarantee:\s*false/);

// Admin proxy forwards only known analytics query params.
assert.match(proxy, /transportQueryPath\(request, path\)/);
assert.match(
  proxy,
  /path === "\/admin\/transport\/performance-analytics"/,
);
assert.match(proxy, /\["windowDays", "forecastDays"\]/);
assert.match(proxy, /\^\\d\{1,3\}\$/);

// Admin UI.
assert.match(adminPage, /TransportPerformanceAnalyticsPanel/);
assert.match(panel, /PHASE 11 · CAPACITY \/ SLA \/ PERFORMANCE INTELLIGENCE/);
assert.match(panel, /performance-analytics\?windowDays=/);
assert.match(panel, /forecastDays=/);
assert.match(panel, /This table is not a quality ranking/);
assert.match(panel, /capacity guarantee/);
assert.match(panel, /Same-weekday historical averages/);

// Documentation boundaries.
assert.match(docs, /adds \*\*no new Prisma model and no database migration\*\*/i);
assert.match(docs, /machine learning/i);
assert.match(docs, /not a provider quality ranking/i);
assert.match(docs, /No `\.env` file is added or modified/i);
assert.match(docs, /planning load proxy/i);

console.log(
  "V2 Transport Phase 11 capacity planning + SLA analytics contract acceptance passed",
);
