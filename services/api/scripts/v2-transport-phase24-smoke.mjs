import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

const [
  runSchema,
  migration,
  integrityModule,
  appModule,
  worker,
  executionModule,
  downloadModule,
  governanceModule,
  governancePanel,
  executionPanel,
  packageText,
  docs,
] = await Promise.all([
  read("prisma/v2_transport_management_report_run.prisma"),
  read("prisma/migrations/20261001012000_v2_transport_report_artifact_integrity/migration.sql"),
  read("src/modules/transport/transport-report-integrity.module.ts"),
  read("src/app.module.ts"),
  read("src/scripts/run-transport-report-scheduler.ts"),
  read("src/modules/transport/transport-report-execution.module.ts"),
  read("src/modules/transport/transport-report-download.module.ts"),
  read("src/modules/transport/transport-report-governance.module.ts"),
  read("../../apps/admin/components/TransportReportGovernancePanel.tsx"),
  read("../../apps/admin/components/TransportReportExecutionPanel.tsx"),
  read("package.json"),
  read("../../docs/transport-report-integrity-phase24.md"),
]);

const pkg = JSON.parse(packageText);

for (const text of [
  'artifactIntegrityStatus String   @default("PENDING")',
  "artifactIntegrityLastCheckedAt",
  "artifactIntegrityFailureAt",
  "artifactIntegrityFailureCode",
  "@@index([artifactIntegrityStatus, artifactIntegrityLastCheckedAt])",
]) {
  assert.ok(runSchema.includes(text), `run schema must include: ${text}`);
}

for (const text of [
  'ADD COLUMN "artifactIntegrityStatus"',
  'ADD COLUMN "artifactIntegrityLastCheckedAt"',
  'ADD COLUMN "artifactIntegrityFailureAt"',
  'TransportManagementReportRun_artifactIntegrityStatus_artifactIntegrityLastCheckedAt_idx',
]) {
  assert.ok(migration.includes(text), `migration must include: ${text}`);
}

for (const text of [
  "class TransportReportIntegrityService",
  "VERIFY_INTERVAL_MS = 24 * 60 * 60_000",
  "artifactPurgeClaimedAt: null",
  "artifactIntegrityLastCheckedAt: null",
  "artifactIntegrityLastCheckedAt: { lt: cutoff }",
  "take: boundedLimit",
  'createHash("sha256").update(bytes).digest("hex")',
  '"VERIFIED"',
  '"MISMATCH"',
  '"CHECK_FAILED"',
  '"SHA256_MISMATCH"',
  '"BYTE_LENGTH_MISMATCH"',
  'action: "SYSTEM_TRANSPORT_REPORT_ARTIFACT_INTEGRITY_VERIFIED"',
  'action: "SYSTEM_TRANSPORT_REPORT_ARTIFACT_INTEGRITY_MISMATCH"',
  'action: "SYSTEM_TRANSPORT_REPORT_ARTIFACT_INTEGRITY_CHECK_FAILED"',
  'purpose: "DATA_INTEGRITY"',
  "skippedRace",
]) {
  assert.ok(integrityModule.includes(text), `integrity worker must include: ${text}`);
}

assert.ok(appModule.includes("TransportReportIntegrityModule"));

for (const text of [
  "TransportReportIntegrityService",
  "integrityWorker.runOnce(principal, 50)",
  "integrity: integrityResult",
  "integrityResult.mismatch > 0",
  "integrityResult.checkFailed > 0",
]) {
  assert.ok(worker.includes(text), `worker integration must include: ${text}`);
}

const integrityIndex = worker.indexOf("integrityWorker.runOnce(principal, 50)");
const retentionIndex = worker.indexOf("retentionWorker.runOnce(principal, 100)");
assert.ok(
  integrityIndex >= 0 && retentionIndex > integrityIndex,
  "integrity verification must run before retention purge",
);

for (const text of [
  'artifactIntegrityStatus: "PENDING"',
  "artifactIntegrityLastCheckedAt: null",
  "artifactIntegrityFailureAt: null",
  "artifactIntegrityFailureCode: null",
  "artifactIntegrityStatus: row.artifactIntegrityStatus",
]) {
  assert.ok(executionModule.includes(text), `execution integration must include: ${text}`);
}

for (const text of [
  'artifactIntegrityStatus === "MISMATCH"',
  'artifactIntegrityStatus: "VERIFIED"',
  "artifactIntegrityLastCheckedAt: verifiedAt",
  "artifactIntegrityFailureAt: null",
  "artifactIntegrityFailureCode: null",
]) {
  assert.ok(downloadModule.includes(text), `download integrity integration must include: ${text}`);
}

for (const text of [
  '"SYSTEM_TRANSPORT_REPORT_ARTIFACT_INTEGRITY_VERIFIED"',
  '"SYSTEM_TRANSPORT_REPORT_ARTIFACT_INTEGRITY_MISMATCH"',
  '"SYSTEM_TRANSPORT_REPORT_ARTIFACT_INTEGRITY_CHECK_FAILED"',
  "artifactIntegrityStatus: true",
  "artifactIntegrityStatus: run.artifactIntegrityStatus",
  'return "INTEGRITY"',
]) {
  assert.ok(governanceModule.includes(text), `governance integration must include: ${text}`);
}

for (const text of [
  "artifactIntegrityStatus: string",
  'label="Integrity"',
  "artifactIntegrityLastCheckedAt",
  "artifactIntegrityFailureCode",
]) {
  assert.ok(governancePanel.includes(text), `governance panel must include: ${text}`);
}
assert.ok(executionPanel.includes("Integrity:"));
assert.ok(executionPanel.includes("run.artifactIntegrityStatus"));

assert.equal(
  pkg.scripts["v2:transport-phase24"],
  "node scripts/v2-transport-phase24-smoke.mjs",
);
assert.ok(pkg.scripts.test.includes("npm run v2:transport-phase24"));

for (const text of [
  "Artifact Integrity Attestation + Drift Detection",
  "24 hours",
  "MISMATCH",
  "CHECK_FAILED",
  "purge-race safety",
  "No new environment variables",
]) {
  assert.ok(docs.includes(text), `Phase 24 docs must include: ${text}`);
}

console.log("Transport Phase 24 artifact integrity acceptance passed");
