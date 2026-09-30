import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

const [
  integrityModule,
  executionModule,
  downloadModule,
  deliveryModule,
  governanceModule,
  adminPanel,
  packageText,
  docs,
] = await Promise.all([
  read("src/modules/transport/transport-report-integrity.module.ts"),
  read("src/modules/transport/transport-report-execution.module.ts"),
  read("src/modules/transport/transport-report-download.module.ts"),
  read("src/modules/transport/transport-report-delivery.module.ts"),
  read("src/modules/transport/transport-report-governance.module.ts"),
  read("../../apps/admin/components/TransportReportExecutionPanel.tsx"),
  read("package.json"),
  read("../../docs/transport-report-integrity-quarantine-phase25.md"),
]);

const pkg = JSON.parse(packageText);

for (const text of [
  "async reverify(principal: AuthPrincipal",
  "artifactPurgeClaimedAt: true",
  "row.artifactPurgeClaimedAt",
  'createHash("sha256").update(bytes).digest("hex")',
  'const status = shaMatches && bytesMatch ? "VERIFIED" : "MISMATCH"',
  '"CHECK_FAILED"',
  "invalidatedDownloadGrants",
  "transportManagementReportDownloadGrant.updateMany",
  'action: "ADMIN_TRANSPORT_REPORT_ARTIFACT_REVERIFY_REQUESTED"',
  '@Post("report-runs/:runId/integrity/reverify")',
  '@RequirePermissions("TRANSPORT_OPERATE")',
  'quarantineActive: status === "MISMATCH"',
]) {
  assert.ok(integrityModule.includes(text), `integrity quarantine must include: ${text}`);
}

const mismatchBranch = integrityModule.slice(
  integrityModule.indexOf("} else {\n          mismatch += 1;"),
  integrityModule.indexOf("} catch (error)", integrityModule.indexOf("} else {\n          mismatch += 1;")),
);
assert.ok(
  mismatchBranch.includes("transportManagementReportDownloadGrant.updateMany"),
  "automatic mismatch detection must invalidate pending download grants",
);

assert.ok(
  executionModule.includes('existing.artifactIntegrityStatus === "MISMATCH"'),
  "delivery handoff must reject confirmed integrity mismatch",
);
assert.ok(
  downloadModule.includes('run.artifactIntegrityStatus === "MISMATCH"'),
  "new secure-download grants must reject confirmed integrity mismatch",
);
assert.ok(
  deliveryModule.includes('item.run.artifactIntegrityStatus !== "MISMATCH"'),
  "recipient inbox must quarantine confirmed integrity mismatch",
);

for (const text of [
  "PHASE 25 · INTEGRITY QUARANTINE + MANUAL REVERIFICATION",
  "async function reverifyIntegrity",
  '"/integrity/reverify"',
  "Reverify integrity",
  "<strong>QUARANTINED</strong>",
  'run.artifactIntegrityStatus !== "MISMATCH"',
]) {
  assert.ok(adminPanel.includes(text), `Admin quarantine UI must include: ${text}`);
}

assert.ok(
  governanceModule.includes(
    '"ADMIN_TRANSPORT_REPORT_ARTIFACT_REVERIFY_REQUESTED"',
  ),
  "governance timeline must include the manual reverification request",
);

assert.equal(
  pkg.scripts["v2:transport-phase25"],
  "node scripts/v2-transport-phase25-smoke.mjs",
);
assert.ok(pkg.scripts.test.includes("npm run v2:transport-phase25"));

for (const text of [
  "Integrity Quarantine + Manual Reverification",
  "artifactIntegrityStatus = MISMATCH",
  "Pending grant invalidation",
  "purge claim",
  "No new environment variables",
  "No database migration is required",
]) {
  assert.ok(docs.includes(text), `Phase 25 docs must include: ${text}`);
}

console.log("Transport Phase 25 integrity quarantine acceptance passed");
