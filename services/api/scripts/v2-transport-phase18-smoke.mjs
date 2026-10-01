import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

const [
  deliveryModule,
  communicationsModule,
  workerEntrypoint,
  adminPanel,
  packageText,
  docs,
] = await Promise.all([
  read("src/modules/transport/transport-report-delivery.module.ts"),
  read("src/modules/communications/communications.module.ts"),
  read("src/scripts/run-transport-report-scheduler.ts"),
  read("../../apps/admin/components/TransportReportDeliveryPanel.tsx"),
  read("package.json"),
  read("../../docs/transport-report-delivery-worker-phase18.md"),
]);

const pkg = JSON.parse(packageText);

assert.ok(
  communicationsModule.includes("NotificationGatewayService"),
  "communications module must expose the existing notification gateway",
);
assert.ok(
  communicationsModule.includes("exports: [") &&
    communicationsModule.includes("NotificationGatewayService,"),
  "NotificationGatewayService must be exported for the transport delivery worker",
);

for (const text of [
  "class TransportReportDeliveryWorkerService",
  "LEASE_SECONDS = 60",
  "MAX_ATTEMPTS = 5",
  "RETRY_BASE_SECONDS = 5",
  "MAX_RETRY_SECONDS = 15 * 60",
  "this.outbox.recoverable",
  "this.outbox.claim",
  'recipient.role !== "ADMIN"',
  'recipient.status !== "ACTIVE"',
  "this.gateway.send({",
  'safeTitleKey: "transport.report.ready.title"',
  'safeBodyKey: "transport.report.ready.body"',
  'entityType: "TRANSPORT_REPORT_RUN"',
  'channel: "EMAIL"',
  'deliveryStatus: failed',
  '"DELIVERY_ATTENTION_REQUIRED"',
  '"DELIVERY_NOTIFICATION_COMPLETE"',
  'executionMode: "REPORT_READY_NOTIFICATION_WORKER"',
  "artifactDeliveryPerformed: false",
]) {
  assert.ok(deliveryModule.includes(text), `delivery worker must include: ${text}`);
}

const gatewayCallStart = deliveryModule.indexOf("this.gateway.send({");
const gatewayCallEnd = deliveryModule.indexOf("});", gatewayCallStart);
const gatewayPayload = deliveryModule.slice(gatewayCallStart, gatewayCallEnd);
for (const prohibited of [
  "artifactObjectKey",
  "artifactSha256",
  "artifactBytes",
  "artifactStorageProvider",
  "reportFilename",
]) {
  assert.ok(
    !gatewayPayload.includes(prohibited),
    `notification gateway payload must not include ${prohibited}`,
  );
}

for (const text of [
  "TransportReportDeliveryWorkerService",
  "deliveryWorker.runOnce(25)",
  "deliveryNotification: deliveryResult",
  "artifactDeliveryPerformed: false",
]) {
  assert.ok(workerEntrypoint.includes(text), `Cloud Run entrypoint must include: ${text}`);
}

for (const text of [
  "REPORT_READY_NOTIFICATION_WORKER",
  "SENT means the readiness notification was sent",
  "private CSV artifact was delivered",
]) {
  assert.ok(adminPanel.includes(text), `Admin panel must include: ${text}`);
}

assert.equal(
  pkg.scripts["v2:transport-phase18"],
  "node scripts/v2-transport-phase18-smoke.mjs",
);
assert.ok(pkg.scripts.test.includes("npm run v2:transport-phase18"));

for (const text of [
  "Secure Report-Ready Notification Worker",
  "artifactDeliveryPerformed: false",
  "ACTIVE and ADMIN",
  "No new environment variables",
  "transport.report.ready.title",
  "TRANSPORT_REPORT_RUN",
]) {
  assert.ok(docs.includes(text), `Phase 18 docs must include: ${text}`);
}

console.log("Transport Phase 18 report-ready notification worker acceptance passed");
