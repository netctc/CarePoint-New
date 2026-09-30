import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

const [
  deliverySchema,
  migration,
  deliveryModule,
  downloadModule,
  adminPanel,
  packageText,
  docs,
] = await Promise.all([
  read("prisma/v2_transport_management_report_delivery.prisma"),
  read("prisma/migrations/20261001003500_v2_transport_report_recipient_inbox/migration.sql"),
  read("src/modules/transport/transport-report-delivery.module.ts"),
  read("src/modules/transport/transport-report-download.module.ts"),
  read("../../apps/admin/components/TransportReportDeliveryPanel.tsx"),
  read("package.json"),
  read("../../docs/transport-report-recipient-inbox-phase20.md"),
]);

const pkg = JSON.parse(packageText);

for (const text of [
  "downloadedAt",
  "downloadedByAccountId",
  "@@index([status, downloadedAt])",
]) {
  assert.ok(deliverySchema.includes(text), `delivery schema must include: ${text}`);
}

for (const text of [
  'ADD COLUMN "downloadedAt"',
  'ADD COLUMN "downloadedByAccountId"',
  'TransportManagementReportDelivery_status_downloadedAt_idx',
]) {
  assert.ok(migration.includes(text), `migration must include: ${text}`);
}

for (const text of [
  "async inbox(principal: AuthPrincipal)",
  'status: "SENT"',
  "recipientAccountId: principal.accountId",
  "downloadedAt: true",
  "downloadedByAccountId: true",
  "artifactAvailable: Boolean(item.run.artifactSha256)",
  'patientIdentityIncluded: false',
  'patientLocationIncluded: false',
  'objectStorageKeyIncluded: false',
  '@Get("report-inbox")',
]) {
  assert.ok(deliveryModule.includes(text), `recipient inbox must include: ${text}`);
}

const inboxStart = deliveryModule.indexOf("async inbox(principal: AuthPrincipal)");
const inboxEnd = deliveryModule.indexOf("async recoverable", inboxStart);
const inboxBlock = deliveryModule.slice(inboxStart, inboxEnd);
assert.ok(
  !inboxBlock.includes("artifactObjectKey"),
  "recipient inbox must not select or expose the object-storage key",
);

for (const text of [
  "recipientReceipts",
  'status: "SENT"',
  "downloadedAt: null",
  "recipientAccountId: principal.accountId",
  "downloadedAt: new Date()",
  "downloadedByAccountId: principal.accountId",
  "recipientDeliveryReceiptsRecorded: recipientReceipts.count",
]) {
  assert.ok(downloadModule.includes(text), `download receipt logic must include: ${text}`);
}

const integrityIndex = downloadModule.indexOf(
  "sha256 !== grant.run.artifactSha256",
);
const receiptIndex = downloadModule.indexOf("const recipientReceipts");
assert.ok(
  integrityIndex >= 0 && receiptIndex > integrityIndex,
  "recipient receipt must be recorded only after artifact integrity validation",
);

for (const text of [
  "PHASE 20 · RECIPIENT REPORT INBOX + DOWNLOAD RECEIPTS",
  "My Report Inbox",
  "/api/admin/transport/report-inbox",
  "NOT YET DOWNLOADED",
  "DOWNLOADED",
  "async function secureInboxDownload",
  "Secure download",
  "recipient download receipt was recorded",
]) {
  assert.ok(adminPanel.includes(text), `Admin inbox must include: ${text}`);
}

assert.equal(
  pkg.scripts["v2:transport-phase20"],
  "node scripts/v2-transport-phase20-smoke.mjs",
);
assert.ok(pkg.scripts.test.includes("npm run v2:transport-phase20"));

for (const text of [
  "Recipient Report Inbox + Download Receipts",
  "destination.recipientAccountId = current principal.accountId",
  "objectStorageKeyIncluded: false",
  "No new environment variables",
  "original receipt timestamp",
]) {
  assert.ok(docs.includes(text), `Phase 20 docs must include: ${text}`);
}

console.log("Transport Phase 20 recipient inbox acceptance passed");
