import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

const [
  schema,
  scheduleSchema,
  runSchema,
  migration,
  deliveryModule,
  executionModule,
  adminPanel,
  adminPage,
  packageText,
  docs,
] = await Promise.all([
  read("prisma/v2_transport_management_report_delivery.prisma"),
  read("prisma/v2_transport_management_report_schedule.prisma"),
  read("prisma/v2_transport_management_report_run.prisma"),
  read("prisma/migrations/20261001000500_v2_transport_report_delivery_outbox/migration.sql"),
  read("src/modules/transport/transport-report-delivery.module.ts"),
  read("src/modules/transport/transport-report-execution.module.ts"),
  read("../../apps/admin/components/TransportReportDeliveryPanel.tsx"),
  read("../../apps/admin/app/transport-providers/page.tsx"),
  read("package.json"),
  read("../../docs/transport-report-delivery-outbox-phase17.md"),
]);

const pkg = JSON.parse(packageText);

for (const text of [
  "model TransportManagementReportDestination",
  "@@unique([scheduleId, recipientAccountId, channel])",
  "model TransportManagementReportDelivery",
  "@@unique([runId, destinationId])",
  "@@index([status, availableAt, leaseUntil])",
  "leaseOwner",
  "leaseUntil",
  "attemptCount",
]) {
  assert.ok(schema.includes(text), `delivery schema must include: ${text}`);
}

assert.ok(scheduleSchema.includes("TransportManagementReportDestination[]"));
assert.ok(runSchema.includes("TransportManagementReportDelivery[]"));

for (const text of [
  'CREATE TABLE "TransportManagementReportDestination"',
  'CREATE TABLE "TransportManagementReportDelivery"',
  'TransportManagementReportDelivery_runId_destinationId_key',
  'TransportManagementReportDestination_scheduleId_recipientAccountId_channel_key',
]) {
  assert.ok(migration.includes(text), `migration must include: ${text}`);
}

for (const text of [
  "class TransportReportDeliveryOutboxService",
  'recipient.status !== "ACTIVE"',
  'recipient.role !== "ADMIN"',
  'channel: "EMAIL"',
  "skipDuplicates: true",
  'status: "PENDING"',
  "EXTERNAL_DELIVERY_ADAPTER_REQUIRED",
  '@Get("report-destinations")',
  '@Post("report-destinations")',
  '@Get("report-deliveries")',
]) {
  assert.ok(deliveryModule.includes(text), `delivery module must include: ${text}`);
}

assert.ok(
  !schema.includes("recipientEmail") &&
  !deliveryModule.includes("recipientEmail"),
  "Phase 17 must not duplicate recipient email into report destination storage",
);

for (const text of [
  "TransportReportDeliveryModule",
  "TransportReportDeliveryOutboxService",
  "this.deliveries.enqueueForRun",
  'deliveryStatus =',
  '"DELIVERY_OUTBOX_READY"',
  "configuredDestinations",
  "newlyQueuedDeliveries",
]) {
  assert.ok(executionModule.includes(text), `execution module must include: ${text}`);
}

assert.ok(
  !deliveryModule.includes("NotificationGatewayService") &&
  !deliveryModule.includes(".send("),
  "Phase 17 must not perform external provider delivery",
);

for (const text of [
  "PHASE 17 · DELIVERY DESTINATIONS + DURABLE OUTBOX",
  "Recipient ADMIN account ID",
  "Add destination",
  "EXTERNAL_DELIVERY_ADAPTER_REQUIRED",
  "No external provider send is performed",
]) {
  assert.ok(adminPanel.includes(text), `Admin delivery panel must include: ${text}`);
}
assert.ok(adminPage.includes("TransportReportDeliveryPanel"));

assert.equal(
  pkg.scripts["v2:transport-phase17"],
  "node scripts/v2-transport-phase17-smoke.mjs",
);
assert.ok(pkg.scripts.test.includes("npm run v2:transport-phase17"));

for (const text of [
  "Delivery Destinations + Durable Delivery Outbox",
  "active CarePoint ADMIN account",
  "EXTERNAL_DELIVERY_ADAPTER_REQUIRED",
  "reportDeliveryPerformed: false",
  "No new environment variables",
]) {
  assert.ok(docs.includes(text), `Phase 17 docs must include: ${text}`);
}

console.log("Transport Phase 17 durable delivery outbox acceptance passed");
