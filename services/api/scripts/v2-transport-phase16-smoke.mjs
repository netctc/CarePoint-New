import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

const [
  runSchema,
  migration,
  storageContract,
  gcpRuntime,
  ociRuntime,
  artifactService,
  executionModule,
  adminPanel,
  packageText,
  docs,
  ksaSmoke,
  gcpPreflightSmoke,
  c3Smoke,
] = await Promise.all([
  read("prisma/v2_transport_management_report_run.prisma"),
  read("prisma/migrations/20260930234500_v2_transport_report_artifact_handoff/migration.sql"),
  read("src/infrastructure/cloud/production-object-storage.ts"),
  read("src/infrastructure/cloud/gcp-object-storage-runtime.ts"),
  read("src/infrastructure/cloud/oci-object-storage-runtime.ts"),
  read("src/modules/transport/transport-report-artifact-storage.service.ts"),
  read("src/modules/transport/transport-report-execution.module.ts"),
  read("../../apps/admin/components/TransportReportExecutionPanel.tsx"),
  read("package.json"),
  read("../../docs/transport-report-artifact-phase16.md"),
  read("scripts/r3-ksa-object-storage-contract-smoke.mjs"),
  read("scripts/r3-gcp-object-storage-preflight-smoke.mjs"),
  read("scripts/c3-object-storage-preflight-smoke.mjs"),
]);

const pkg = JSON.parse(packageText);

for (const text of [
  "artifactObjectKey",
  "artifactSha256",
  "artifactBytes",
  "artifactContentType",
  "artifactStorageProvider",
  "artifactStoredAt",
  "deliveryStatus",
  "deliveryHandoffPreparedAt",
  "@@index([deliveryStatus, artifactStoredAt])",
]) {
  assert.ok(runSchema.includes(text), `run schema must include: ${text}`);
}

for (const text of [
  'ADD COLUMN "artifactObjectKey"',
  'ADD COLUMN "artifactSha256"',
  'ADD COLUMN "deliveryStatus"',
  'TransportManagementReportRun_deliveryStatus_artifactStoredAt_idx',
]) {
  assert.ok(migration.includes(text), `migration must include: ${text}`);
}

assert.ok(
  storageContract.includes('"transport-management-reports"'),
  "production storage contract must include the transport report domain",
);
assert.ok(
  storageContract.includes('prefix: "carepoint/transport-management-reports"'),
  "transport report artifacts must use an isolated prefix",
);
assert.ok(
  gcpRuntime.includes('"transport-management-reports"'),
  "GCP runtime must support transport report artifacts",
);
assert.ok(
  ociRuntime.includes('"transport-management-reports"'),
  "OCI runtime must support transport report artifacts",
);

for (const text of [
  "class TransportReportArtifactStorageService",
  '"transport-management-reports"',
  '"text/csv; charset=utf-8"',
  'sanitized: "true"',
  'public: "false"',
  'mode: 0o600',
  '/^[=+\\-@\\t\\r]/',
  "LOCAL_PRIVATE",
  "GCP_CLOUD_STORAGE",
  "OCI_OBJECT_STORAGE",
]) {
  assert.ok(artifactService.includes(text), `artifact service must include: ${text}`);
}

for (const text of [
  "this.artifacts.encodeCsv(report.columns, report.rows)",
  "await this.artifacts.putCsv(artifactObjectKey, csv)",
  'deliveryStatus: "ARTIFACT_READY"',
  "artifactSha256",
  "artifactBytes",
  "artifactStorageProvider",
  "async prepareDeliveryHandoff(",
  'deliveryStatus: "READY_FOR_EXTERNAL_DELIVERY"',
  '@Post("report-runs/:runId/prepare-delivery-handoff")',
  "publicUrlIssued: false",
  "reportDeliveryPerformed: false",
]) {
  assert.ok(executionModule.includes(text), `execution module must include: ${text}`);
}

assert.ok(
  !executionModule.includes("signedUrl") &&
  !executionModule.includes("publicUrl:") &&
  !artifactService.includes("signedUrl"),
  "Phase 16 must not issue public or signed artifact URLs",
);

for (const text of [
  "artifactStorageProvider",
  "artifactSha256",
  "Prepare handoff",
  "/prepare-delivery-handoff",
]) {
  assert.ok(adminPanel.includes(text), `Admin panel must include: ${text}`);
}

assert.ok(ksaSmoke.includes("contract.domains.length, 3"));
assert.ok(gcpPreflightSmoke.includes('"transport-management-reports"'));
assert.ok(
  gcpPreflightSmoke.includes(
    "preflight should inspect each unique bucket once while validating all configured domains",
  ),
);
assert.ok(c3Smoke.includes('"transport-management-reports"'));

assert.equal(
  pkg.scripts["v2:transport-phase16"],
  "node scripts/v2-transport-phase16-smoke.mjs",
);
assert.ok(pkg.scripts.test.includes("npm run v2:transport-phase16"));

for (const text of [
  "Secure Report Artifact Storage + Delivery Handoff",
  "No new environment variables",
  "publicUrlIssued: false",
  "reportDeliveryPerformed: false",
  "patient identity",
  "formula injection",
]) {
  assert.ok(docs.includes(text), `Phase 16 docs must include: ${text}`);
}

console.log("Transport Phase 16 secure report artifact acceptance passed");
