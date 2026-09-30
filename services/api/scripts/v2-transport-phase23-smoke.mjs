import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

const [
  governanceModule,
  appModule,
  adminPanel,
  adminPage,
  packageText,
  docs,
] = await Promise.all([
  read("src/modules/transport/transport-report-governance.module.ts"),
  read("src/app.module.ts"),
  read("../../apps/admin/components/TransportReportGovernancePanel.tsx"),
  read("../../apps/admin/app/transport-providers/page.tsx"),
  read("package.json"),
  read("../../docs/transport-report-governance-timeline-phase23.md"),
]);

const pkg = JSON.parse(packageText);

for (const text of [
  "class TransportReportGovernanceService",
  "GOVERNANCE_ACTIONS",
  '"ADMIN_TRANSPORT_REPORT_RUN_SUCCEEDED"',
  '"ADMIN_TRANSPORT_REPORT_DELIVERY_HANDOFF_PREPARED"',
  '"ADMIN_TRANSPORT_REPORT_DOWNLOADED"',
  '"ADMIN_TRANSPORT_REPORT_ARTIFACT_LEGAL_HOLD_SET"',
  '"SYSTEM_TRANSPORT_REPORT_ARTIFACT_PURGED"',
  'objectType: "TRANSPORT_REPORT_RUN"',
  "auditIntegrityRecord.findMany",
  "integrity.sequence.toString()",
  "payloadHash",
  "previousHash",
  "eventHash",
  'artifactState = run.artifactDeletedAt',
  '"PURGED"',
  '"LEGAL_HOLD"',
  '"LIVE_PRIVATE"',
  '@Get("report-runs/:runId/governance-timeline")',
]) {
  assert.ok(governanceModule.includes(text), `governance module must include: ${text}`);
}

for (const text of [
  "rawAuditMetadataIncluded: false",
  "objectStorageKeyIncluded: false",
  "patientIdentityIncluded: false",
  "patientContactIncluded: false",
  "patientLocationIncluded: false",
  "csvContentIncluded: false",
]) {
  assert.ok(governanceModule.includes(text), `privacy contract must include: ${text}`);
}

assert.ok(
  !governanceModule.includes("metadata: true") &&
    !governanceModule.includes("artifactObjectKey: true"),
  "governance timeline must not select raw audit metadata or the private object key",
);

for (const text of [
  'action: "ADMIN_TRANSPORT_REPORT_GOVERNANCE_TIMELINE_READ"',
  'objectType: "TRANSPORT_REPORT_GOVERNANCE"',
]) {
  assert.ok(governanceModule.includes(text), `governance read audit must include: ${text}`);
}

assert.ok(appModule.includes("TransportReportGovernanceModule"));

for (const text of [
  "PHASE 23 · GOVERNANCE EVIDENCE + HOLD/PURGE TIMELINE",
  "Report Governance Evidence",
  "/governance-timeline",
  "Immutable governance timeline",
  "event.eventHash",
  "event.sequence",
  "Raw audit",
]) {
  assert.ok(adminPanel.includes(text), `Admin governance panel must include: ${text}`);
}
assert.ok(adminPage.includes("TransportReportGovernancePanel"));

assert.equal(
  pkg.scripts["v2:transport-phase23"],
  "node scripts/v2-transport-phase23-smoke.mjs",
);
assert.ok(pkg.scripts.test.includes("npm run v2:transport-phase23"));

for (const text of [
  "Governance Evidence + Hold/Purge Timeline",
  "raw audit metadata",
  "object-storage key",
  "AuditIntegrityRecord",
  "No new environment variables",
  "No database migration is required",
]) {
  assert.ok(docs.includes(text), `Phase 23 docs must include: ${text}`);
}

console.log("Transport Phase 23 governance evidence timeline acceptance passed");
