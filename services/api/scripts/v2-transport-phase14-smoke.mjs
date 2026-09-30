import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

const [
  runSchema,
  scheduleSchema,
  migration,
  executionModule,
  commandCenter,
  appModule,
  packageText,
  proxy,
  adminPage,
  panel,
  docs,
] = await Promise.all([
  read("prisma/v2_transport_management_report_run.prisma"),
  read("prisma/v2_transport_management_report_schedule.prisma"),
  read("prisma/migrations/20260930233000_v2_transport_report_execution_ledger/migration.sql"),
  read("src/modules/transport/transport-report-execution.module.ts"),
  read("src/modules/transport/transport-command-center.module.ts"),
  read("src/app.module.ts"),
  read("package.json"),
  read("../../admin/app/api/admin/transport/[...segments]/route.ts"),
  read("../../admin/app/transport-providers/page.tsx"),
  read("../../admin/components/TransportReportExecutionPanel.tsx"),
  read("../../docs/transport-report-execution-phase14.md"),
]);

const pkg = JSON.parse(packageText);

for (const text of [
  "model TransportManagementReportRun",
  "@@unique([scheduleId, scheduledFor])",
  "@@index([status, leaseExpiresAt])",
  "snapshotHash",
  "snapshotJson",
]) {
  assert.ok(runSchema.includes(text), `run schema must include: ${text}`);
}

assert.ok(
  scheduleSchema.includes("TransportManagementReportRun[]"),
  "report schedules must expose the run relation",
);

for (const text of [
  'CREATE TABLE "TransportManagementReportRun"',
  'TransportManagementReportRun_scheduleId_scheduledFor_key',
  'TransportManagementReportRun_status_leaseExpiresAt_idx',
  'TransportManagementReportRun_scheduleId_fkey',
]) {
  assert.ok(migration.includes(text), `migration must include: ${text}`);
}

for (const text of [
  "class TransportReportExecutionService",
  'status: "QUEUED"',
  'status: "RUNNING"',
  'status: "SUCCEEDED"',
  'status: "FAILED"',
  "LEASE_MS = 5 * 60_000",
  "MAX_ATTEMPTS = 5",
  "createHash(\"sha256\")",
  "skipDuplicates: true",
  'automaticDeliveryAvailable: false',
  'reportDeliveryPerformed: false',
  '@Post("report-runs/queue-due")',
  '@Post("report-runs/recover-stale")',
  '@Post("report-runs/:runId/execute")',
  '@Post("report-runs/:runId/retry")',
]) {
  assert.ok(executionModule.includes(text), `execution module must include: ${text}`);
}

assert.ok(
  !executionModule.includes("pickupAddress") &&
    !executionModule.includes("destinationAddress") &&
    !executionModule.includes("latitude") &&
    !executionModule.includes("longitude"),
  "durable execution snapshot must not add patient location data",
);

assert.ok(
  commandCenter.includes("exports: [TransportCommandCenterService]"),
  "command center service must be exported for scheduled sanitized report generation",
);
assert.ok(
  appModule.includes("TransportReportExecutionModule"),
  "AppModule must register Phase 14",
);
assert.equal(
  pkg.scripts["v2:transport-phase14"],
  "node scripts/v2-transport-phase14-smoke.mjs",
);
assert.ok(
  pkg.scripts.test.includes("npm run v2:transport-phase14"),
  "full API test chain must include Phase 14 smoke",
);

for (const text of [
  'path === "/admin/transport/report-runs"',
  '"QUEUED", "RUNNING", "SUCCEEDED", "FAILED"',
]) {
  assert.ok(proxy.includes(text), `Admin proxy must include: ${text}`);
}

assert.ok(
  adminPage.includes("TransportReportExecutionPanel"),
  "Transport Providers page must surface the execution ledger",
);
for (const text of [
  "PHASE 14 · DURABLE REPORT EXECUTION LEDGER",
  "/api/admin/transport/report-runs/queue-due",
  "/api/admin/transport/report-runs/recover-stale",
  "/execute",
  "/retry",
]) {
  assert.ok(panel.includes(text), `Admin Phase 14 panel must include: ${text}`);
}

for (const text of [
  "Durable Report Execution Ledger",
  "idempotent",
  "five-minute",
  "SHA-256",
  "automaticDeliveryAvailable: false",
  "reportDeliveryPerformed: false",
  "No new environment variables",
]) {
  assert.ok(docs.includes(text), `Phase 14 docs must include: ${text}`);
}

console.log("Transport Phase 14 durable report execution acceptance passed");
