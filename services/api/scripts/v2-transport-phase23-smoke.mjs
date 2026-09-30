import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

const [
  retentionModule,
  adminPanel,
  adminPage,
  packageText,
  docs,
] = await Promise.all([
  read("src/modules/transport/transport-report-retention.module.ts"),
  read("../../apps/admin/components/TransportReportGovernancePanel.tsx"),
  read("../../apps/admin/app/transport-providers/page.tsx"),
  read("package.json"),
  read("../../docs/transport-report-governance-phase23.md"),
]);

const pkg = JSON.parse(packageText);

for (const text of [
  "async governance(principal: AuthPrincipal)",
  "const SOURCE_LIMIT = 2000",
  "take: SOURCE_LIMIT",
  ".slice(0, 250)",
  '"PURGED"',
  '"LEGAL_HOLD"',
  '"PURGE_CLAIMED"',
  '"DUE"',
  '"LIVE"',
  "row.schedule.artifactRetentionDays * 86_400_000",
  "expiringWithin7Days",
  "expiringWithin30Days",
  "recipientDownloadReceipts",
  "deliveryAttentionRequired",
  'action: "ADMIN_TRANSPORT_REPORT_GOVERNANCE_READ"',
  'objectStorageKeyIncluded: false',
  '@Get("report-governance")',
  '@Header("Cache-Control", "no-store")',
]) {
  assert.ok(retentionModule.includes(text), `governance API must include: ${text}`);
}

const governanceStart = retentionModule.indexOf(
  "async governance(principal: AuthPrincipal)",
);
const governanceEnd = retentionModule.indexOf(
  "async setLegalHold(",
  governanceStart,
);
const governanceBlock = retentionModule.slice(governanceStart, governanceEnd);
assert.ok(
  !governanceBlock.includes("artifactObjectKey"),
  "governance read must not select or expose private object-storage keys",
);

for (const text of [
  "PHASE 23 · REPORT GOVERNANCE DASHBOARD",
  "Report Retention & Access Governance",
  "/api/admin/transport/report-governance",
  "Live artifacts",
  "Retention due",
  "Legal holds",
  "Expiring ≤7d",
  "Expiring ≤30d",
  "Download receipts",
  "bounded 2,000-run cap",
]) {
  assert.ok(adminPanel.includes(text), `governance panel must include: ${text}`);
}

assert.ok(
  adminPage.includes("TransportReportGovernancePanel"),
  "Transport Providers page must surface the governance dashboard",
);

assert.equal(
  pkg.scripts["v2:transport-phase23"],
  "node scripts/v2-transport-phase23-smoke.mjs",
);
assert.ok(pkg.scripts.test.includes("npm run v2:transport-phase23"));

for (const text of [
  "Report Governance Dashboard",
  "2,000",
  "250",
  "objectStorageKeyIncluded: false",
  "No new environment variables",
]) {
  assert.ok(docs.includes(text), `Phase 23 docs must include: ${text}`);
}

console.log("Transport Phase 23 report governance dashboard acceptance passed");
