import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

const [
  grantSchema,
  runSchema,
  migration,
  storage,
  downloadModule,
  appModule,
  adminApi,
  proxy,
  panel,
  packageText,
  docs,
] = await Promise.all([
  read("prisma/v2_transport_management_report_download_grant.prisma"),
  read("prisma/v2_transport_management_report_run.prisma"),
  read("prisma/migrations/20261001002000_v2_transport_report_download_grants/migration.sql"),
  read("src/modules/transport/transport-report-artifact-storage.service.ts"),
  read("src/modules/transport/transport-report-download.module.ts"),
  read("src/app.module.ts"),
  read("../../apps/admin/lib/admin-api.ts"),
  read("../../apps/admin/app/api/admin/transport/[...segments]/route.ts"),
  read("../../apps/admin/components/TransportReportExecutionPanel.tsx"),
  read("package.json"),
  read("../../docs/transport-report-secure-download-phase19.md"),
]);

const pkg = JSON.parse(packageText);

for (const text of [
  "model TransportManagementReportDownloadGrant",
  "tokenHash",
  "@unique",
  "issuedToAccountId",
  "expiresAt",
  "consumedAt",
  "@@index([runId, expiresAt, consumedAt])",
]) {
  assert.ok(grantSchema.includes(text), `grant schema must include: ${text}`);
}
assert.ok(runSchema.includes("TransportManagementReportDownloadGrant[]"));

for (const text of [
  'CREATE TABLE "TransportManagementReportDownloadGrant"',
  'TransportManagementReportDownloadGrant_tokenHash_key',
  'TransportManagementReportDownloadGrant_runId_fkey',
]) {
  assert.ok(migration.includes(text), `migration must include: ${text}`);
}

for (const text of [
  "async getCsv(",
  '"transport-management-reports"',
  "getString(",
  'readFile(this.localPath(objectKey), "utf8")',
]) {
  assert.ok(storage.includes(text), `artifact storage must include: ${text}`);
}

for (const text of [
  "GRANT_TTL_MS = 5 * 60_000",
  "randomBytes(32).toString(\"base64url\")",
  "const tokenHash = this.tokenHash(grantToken)",
  "tokenHash,",
  "issuedToAccountId: principal.accountId",
  "consumedAt: null",
  "expiresAt: { gt: now }",
  "consumed.count !== 1",
  "createHash(\"sha256\").update(bytes).digest(\"hex\")",
  "sha256 !== grant.run.artifactSha256",
  "bytes.byteLength !== grant.run.artifactBytes",
  '@Post("report-runs/:runId/download-grant")',
  '@Post("report-runs/:runId/download")',
  "new StreamableFile",
  "tokenPersistedPlaintext: false",
  "publicUrlIssued: false",
]) {
  assert.ok(downloadModule.includes(text), `download module must include: ${text}`);
}

assert.ok(
  !grantSchema.includes("grantToken") &&
    !migration.includes("grantToken"),
  "plaintext grant tokens must never be persisted",
);
assert.ok(appModule.includes("TransportReportDownloadModule"));

for (const text of [
  "forwardAdminBinary(",
  "options: ForwardOptions = {}",
  "options.requireSameOrigin",
  'options.method || "GET"',
  "JSON.stringify(options.body)",
]) {
  assert.ok(adminApi.includes(text), `Admin binary forwarding must include: ${text}`);
}

for (const text of [
  "forwardAdminBinary",
  'path.endsWith("/download")',
  'method: "POST"',
  "requireSameOrigin: true",
]) {
  assert.ok(proxy.includes(text), `transport Admin proxy must include: ${text}`);
}

for (const text of [
  "async function secureDownload(run: Run)",
  '"/download-grant"',
  '"/download"',
  "grantToken: grant.grantToken",
  "Secure download",
  "URL.revokeObjectURL",
  "No public or signed artifact URL was issued",
]) {
  assert.ok(panel.includes(text), `Admin panel must include: ${text}`);
}

assert.ok(
  !downloadModule.includes("@Get(\"report-runs/:runId/download") &&
    !panel.includes("?grantToken="),
  "grant token must not be transported in a GET/query URL",
);

assert.equal(
  pkg.scripts["v2:transport-phase19"],
  "node scripts/v2-transport-phase19-smoke.mjs",
);
assert.ok(pkg.scripts.test.includes("npm run v2:transport-phase19"));

for (const text of [
  "One-Time Secure Admin Download Grants",
  "five minutes",
  "256 bits",
  "Only the SHA-256 token hash is stored",
  "same-origin",
  "No new environment variables",
]) {
  assert.ok(docs.includes(text), `Phase 19 docs must include: ${text}`);
}

console.log("Transport Phase 19 one-time secure download acceptance passed");
