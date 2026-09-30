import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const moduleSource = readFileSync(
  new URL("../src/modules/transport/transport-executive-kpi.module.ts", import.meta.url),
  "utf8",
);
const appModule = readFileSync(
  new URL("../src/app.module.ts", import.meta.url),
  "utf8",
);
const model = readFileSync(
  new URL("../prisma/v2_transport_management_report_schedule.prisma", import.meta.url),
  "utf8",
);
const migration = readFileSync(
  new URL(
    "../prisma/migrations/20260930230000_v2_transport_management_report_schedule/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const panel = readFileSync(
  new URL("../../../apps/admin/components/TransportExecutiveKpiPanel.tsx", import.meta.url),
  "utf8",
);
const page = readFileSync(
  new URL("../../../apps/admin/app/transport-providers/page.tsx", import.meta.url),
  "utf8",
);
const proxy = readFileSync(
  new URL("../../../apps/admin/app/api/admin/transport/[...segments]/route.ts", import.meta.url),
  "utf8",
);
const docs = readFileSync(
  new URL("../../../docs/transport-executive-kpi-phase13.md", import.meta.url),
  "utf8",
);

assert.match(appModule, /TransportExecutiveKpiModule/);
assert.match(moduleSource, /@RequirePermissions\("TRANSPORT_OPERATE"\)/);
assert.match(moduleSource, /@Get\("executive-kpis"\)/);
assert.match(moduleSource, /@Get\("report-schedules"\)/);
assert.match(moduleSource, /@Post\("report-schedules"\)/);
assert.match(moduleSource, /@Patch\("report-schedules\/:scheduleId"\)/);
assert.match(moduleSource, /@Post\("report-schedules\/:scheduleId\/mark-run"\)/);

assert.match(model, /model TransportManagementReportSchedule/);
assert.match(model, /nextRunAt\s+DateTime/);
assert.match(model, /deliveryMode\s+String\s+@default\("EXTERNAL_SCHEDULER"\)/);
assert.match(model, /@@index\(\[enabled, nextRunAt\]\)/);
assert.match(migration, /CREATE TABLE "TransportManagementReportSchedule"/);
assert.match(migration, /EXTERNAL_SCHEDULER/);

assert.match(moduleSource, /EQUAL_PREVIOUS_PERIOD/);
assert.match(moduleSource, /automatedRating:\s*false/);
assert.match(moduleSource, /providerRanking:\s*false/);
assert.match(moduleSource, /machineLearning:\s*false/);
assert.match(moduleSource, /patientIdentityIncluded:\s*false/);
assert.match(moduleSource, /patientLocationIncluded:\s*false/);
assert.match(moduleSource, /bucketDays = windowDays <= 31 \? 1 : 7/);
assert.match(moduleSource, /current:\s*current\[key\]/);
assert.match(moduleSource, /previous:\s*previous\[key\]/);
assert.match(moduleSource, /absolute:/);

for (const cadence of ["DAILY", "WEEKLY", "MONTHLY"]) {
  assert.match(moduleSource, new RegExp('"' + cadence + '"'));
}
assert.match(moduleSource, /dayOfMonth[\s\S]*1,[\s\S]*28/);
assert.match(moduleSource, /weekday[\s\S]*0,[\s\S]*6/);
assert.match(moduleSource, /hourUtc[\s\S]*0,[\s\S]*23/);
assert.match(moduleSource, /minuteUtc[\s\S]*0,[\s\S]*59/);
assert.match(moduleSource, /windowDays[\s\S]*7,[\s\S]*365/);

assert.match(moduleSource, /automaticDeliveryAvailable:\s*false/);
assert.match(moduleSource, /executionMode:\s*"EXTERNAL_SCHEDULER_REQUIRED"/);
assert.match(moduleSource, /reportDeliveryPerformed:\s*false/);
assert.match(moduleSource, /EXTERNAL_SCHEDULER/);

assert.doesNotMatch(moduleSource, /medicalTransportRequest\.update/);
assert.doesNotMatch(moduleSource, /medicalTransportRequest\.updateMany/);
assert.doesNotMatch(moduleSource, /assignedProviderId:\s*provider/);

assert.match(moduleSource, /ADMIN_TRANSPORT_EXECUTIVE_KPI_READ/);
assert.match(moduleSource, /ADMIN_TRANSPORT_REPORT_SCHEDULE_CREATED/);
assert.match(moduleSource, /ADMIN_TRANSPORT_REPORT_SCHEDULE_UPDATED/);
assert.match(moduleSource, /ADMIN_TRANSPORT_REPORT_SCHEDULE_RUN_RECORDED/);

assert.match(proxy, /path === "\/admin\/transport\/executive-kpis"/);
assert.match(proxy, /query\.set\("windowDays", value\)/);

assert.match(page, /TransportExecutiveKpiPanel/);
assert.match(panel, /PHASE 13 · EXECUTIVE KPI \/ PERIOD COMPARISON/);
assert.match(panel, /EQUAL_PREVIOUS_PERIOD/);
assert.match(panel, /Automatic generation[\s\S]*not active/i);
assert.match(panel, /Create schedule/);
assert.match(panel, /Record external run/);

assert.match(docs, /Automatic email\/report delivery is \*\*not active\*\*/i);
assert.match(docs, /No new environment variables are required/i);
assert.match(docs, /No `\.env` file is added or modified/i);

console.log(
  "V2 Transport Phase 13 executive KPI + report schedule contract acceptance passed",
);
