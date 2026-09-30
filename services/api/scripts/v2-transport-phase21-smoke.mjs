import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

const [
  scheduleSchema,
  runSchema,
  migration,
  executiveModule,
  artifactStorage,
  retentionModule,
  executionModule,
  deliveryModule,
  worker,
  schedulePanel,
  executionPanel,
  packageText,
  docs,
] = await Promise.all([
  read("prisma/v2_transport_management_report_schedule.prisma"),
  read("prisma/v2_transport_management_report_run.prisma"),
  read("prisma/migrations/20261001005000_v2_transport_report_artifact_retention/migration.sql"),
  read("src/modules/transport/transport-executive-kpi.module.ts"),
  read("src/modules/transport/transport-report-artifact-storage.service.ts"),
  read("src/modules/transport/transport-report-retention.module.ts"),
  read("src/modules/transport/transport-report-execution.module.ts"),
  read("src/modules/transport/transport-report-delivery.module.ts"),
  read("src/scripts/run-transport-report-scheduler.ts"),
  read("../../apps/admin/components/TransportExecutiveKpiPanel.tsx"),
  read("../../apps/admin/components/TransportReportExecutionPanel.tsx"),
  read("package.json"),
  read("../../docs/transport-report-retention-phase21.md"),
]);

const pkg = JSON.parse(packageText);

assert.ok(scheduleSchema.includes("artifactRetentionDays Int"));
assert.ok(scheduleSchema.includes("@default(90)"));
assert.ok(runSchema.includes("artifactDeletedAt"));

for (const text of [
  'ADD COLUMN "artifactRetentionDays"',
  'ADD COLUMN "artifactDeletedAt"',
]) {
  assert.ok(migration.includes(text), `migration must include: ${text}`);
}

for (const text of [
  "artifactRetentionDays?: unknown",
  "existing?.artifactRetentionDays ?? 90",
  "3650",
  "artifactRetentionDays: row.artifactRetentionDays",
  "const timingChanged =",
  ": existing.nextRunAt",
]) {
  assert.ok(executiveModule.includes(text), `schedule retention must include: ${text}`);
}

for (const text of [
  "async deleteCsv(",
  "await unlink(this.localPath(objectKey))",
  'error.code !== "ENOENT"',
  '.delete(',
  '"transport-management-reports"',
]) {
  assert.ok(artifactStorage.includes(text), `artifact purge storage must include: ${text}`);
}

for (const text of [
  "class TransportReportRetentionService",
  'status: "SUCCEEDED"',
  "artifactObjectKey: { not: null }",
  "artifactDeletedAt: null",
  "row.schedule.artifactRetentionDays * 86_400_000",
  "await this.artifacts.deleteCsv(row.artifactObjectKey)",
  "artifactObjectKey: null",
  "artifactDeletedAt: purgedAt",
  "transportManagementReportDownloadGrant.updateMany",
  'action: "SYSTEM_TRANSPORT_REPORT_ARTIFACT_PURGED"',
  'action: "SYSTEM_TRANSPORT_REPORT_ARTIFACT_PURGE_FAILED"',
  'purpose: "DATA_RETENTION"',
  "databaseMarkedPurged: false",
  "hashEvidenceRetained: true",
]) {
  assert.ok(retentionModule.includes(text), `retention worker must include: ${text}`);
}

const deleteIndex = retentionModule.indexOf("await this.artifacts.deleteCsv");
const dbPurgeIndex = retentionModule.indexOf("artifactObjectKey: null");
assert.ok(
  deleteIndex >= 0 && dbPurgeIndex > deleteIndex,
  "private object deletion must happen before database purge evidence",
);

assert.ok(executionModule.includes("artifactDeletedAt: row.artifactDeletedAt"));
assert.ok(
  deliveryModule.includes(
    "item.run.artifactSha256 && !item.run.artifactDeletedAt",
  ),
  "recipient inbox must mark purged artifacts unavailable",
);

for (const text of [
  "TransportReportRetentionService",
  "retentionWorker.runOnce(principal, 100)",
  "retention: retentionResult",
  "retentionResult.failed > 0",
]) {
  assert.ok(worker.includes(text), `Cloud Run worker must include: ${text}`);
}

for (const text of [
  "artifactRetentionDays: number",
  "artifactRetentionDays: 90",
  "Artifact retention",
  "updateRetention(",
  "schedule.artifactRetentionDays",
]) {
  assert.ok(schedulePanel.includes(text), `schedule Admin UI must include: ${text}`);
}

for (const text of [
  "artifactDeletedAt: string | null",
  "<strong>PURGED</strong>",
  "!run.artifactDeletedAt",
]) {
  assert.ok(executionPanel.includes(text), `execution Admin UI must include: ${text}`);
}

assert.equal(
  pkg.scripts["v2:transport-phase21"],
  "node scripts/v2-transport-phase21-smoke.mjs",
);
assert.ok(pkg.scripts.test.includes("npm run v2:transport-phase21"));

for (const text of [
  "Report Artifact Retention + Secure Purge",
  "Default:",
  "90",
  "fail-closed",
  "artifactAvailable: false",
  "No new environment variables",
]) {
  assert.ok(docs.includes(text), `Phase 21 docs must include: ${text}`);
}

console.log("Transport Phase 21 report artifact retention acceptance passed");
