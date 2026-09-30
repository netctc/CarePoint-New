import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

const [
  runSchema,
  migration,
  retention,
  execution,
  adminPanel,
  packageText,
  docs,
] = await Promise.all([
  read("prisma/v2_transport_management_report_run.prisma"),
  read("prisma/migrations/20261001010500_v2_transport_report_legal_hold/migration.sql"),
  read("src/modules/transport/transport-report-retention.module.ts"),
  read("src/modules/transport/transport-report-execution.module.ts"),
  read("../../apps/admin/components/TransportReportExecutionPanel.tsx"),
  read("package.json"),
  read("../../docs/transport-report-legal-hold-phase22.md"),
]);

const pkg = JSON.parse(packageText);

for (const text of [
  "artifactLegalHold     Boolean  @default(false)",
  "artifactLegalHoldReason",
  "artifactLegalHoldSetAt",
  "artifactLegalHoldSetByAccountId",
  "artifactPurgeClaimedAt",
  "@@index([artifactLegalHold, artifactDeletedAt, artifactStoredAt])",
]) {
  assert.ok(runSchema.includes(text), `run schema must include: ${text}`);
}

for (const text of [
  'ADD COLUMN "artifactLegalHold"',
  'ADD COLUMN "artifactLegalHoldReason"',
  'ADD COLUMN "artifactPurgeClaimedAt"',
]) {
  assert.ok(migration.includes(text), `migration must include: ${text}`);
}

for (const text of [
  "async setLegalHold(",
  "async clearLegalHold(",
  "15 * 60_000",
  "artifactPurgeClaimedAt: null",
  "artifactLegalHold: true",
  "artifactLegalHold: false",
  "artifactLegalHoldReason: reason",
  'action: "ADMIN_TRANSPORT_REPORT_ARTIFACT_LEGAL_HOLD_SET"',
  'action: "ADMIN_TRANSPORT_REPORT_ARTIFACT_LEGAL_HOLD_CLEARED"',
  '@Post("report-runs/:runId/legal-hold")',
  '@Post("report-runs/:runId/legal-hold/clear")',
  "3 to 500 printable characters",
]) {
  assert.ok(retention.includes(text), `legal hold service must include: ${text}`);
}

const runOnce = retention.slice(retention.indexOf("async runOnce"));
for (const text of [
  "artifactLegalHold: false",
  "const claimTime = new Date()",
  "data: { artifactPurgeClaimedAt: claimTime }",
  "await this.artifacts.deleteCsv(row.artifactObjectKey)",
  "artifactPurgeClaimedAt: claimTime",
  "artifactPurgeClaimedAt: null",
]) {
  assert.ok(runOnce.includes(text), `purge coordination must include: ${text}`);
}

const claimIndex = runOnce.indexOf("data: { artifactPurgeClaimedAt: claimTime }");
const deleteIndex = runOnce.indexOf("await this.artifacts.deleteCsv");
assert.ok(
  claimIndex >= 0 && deleteIndex > claimIndex,
  "purge claim must be acquired before private object deletion",
);

for (const text of [
  "artifactLegalHold: row.artifactLegalHold",
  "artifactLegalHoldReason: row.artifactLegalHoldReason",
  "artifactPurgeClaimedAt: row.artifactPurgeClaimedAt",
]) {
  assert.ok(execution.includes(text), `execution API must include: ${text}`);
}

for (const text of [
  "artifactLegalHold: boolean",
  "artifactLegalHoldReason: string | null",
  "async function changeLegalHold",
  "Set legal hold",
  "Clear hold",
  "<strong>LEGAL HOLD</strong>",
  '"/legal-hold"',
  '"/legal-hold/clear"',
]) {
  assert.ok(adminPanel.includes(text), `Admin hold UI must include: ${text}`);
}

assert.equal(
  pkg.scripts["v2:transport-phase22"],
  "node scripts/v2-transport-phase22-smoke.mjs",
);
assert.ok(pkg.scripts.test.includes("npm run v2:transport-phase22"));

for (const text of [
  "Report Legal Hold + Purge Governance",
  "hold wins if established before purge claim",
  "purge wins if already claimed",
  "15 minutes",
  "No new environment variables",
]) {
  assert.ok(docs.includes(text), `Phase 22 docs must include: ${text}`);
}

console.log("Transport Phase 22 legal hold governance acceptance passed");
