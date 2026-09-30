import "dotenv/config";
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { AuthPrincipal } from "@carepoint/identity";
import { AppModule } from "../app.module";
import { TransportReportExecutionService } from "../modules/transport/transport-report-execution.module";
import { TransportReportDeliveryWorkerService } from "../modules/transport/transport-report-delivery.module";
import { TransportReportRetentionService } from "../modules/transport/transport-report-retention.module";
import { TransportReportIntegrityService } from "../modules/transport/transport-report-integrity.module";

const principal: AuthPrincipal = {
  accountId: "system:transport-report-scheduler",
  role: "ADMIN",
  sessionId: "cloud-run-job:transport-report-worker",
};

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ["error", "warn", "log"],
  });
  try {
    const worker = app.get(TransportReportExecutionService);
    const deliveryWorker = app.get(TransportReportDeliveryWorkerService);
    const retentionWorker = app.get(TransportReportRetentionService);
    const integrityWorker = app.get(TransportReportIntegrityService);
    const reportResult = await worker.workerCycle(principal, 25);
    const deliveryResult = await deliveryWorker.runOnce(25);
    const integrityResult = await integrityWorker.runOnce(principal, 50);
    const retentionResult = await retentionWorker.runOnce(principal, 100);
    process.stdout.write(JSON.stringify({
      event: "transport-report-worker-cycle",
      report: reportResult,
      deliveryNotification: deliveryResult,
      integrity: integrityResult,
      retention: retentionResult,
      artifactDeliveryPerformed: false,
    }) + "\n");
    if (
      reportResult.failed > 0 ||
      deliveryResult.failed > 0 ||
      integrityResult.mismatch > 0 ||
      integrityResult.checkFailed > 0 ||
      retentionResult.failed > 0
    ) {
      process.exitCode = 1;
    }
  } finally {
    await app.close();
  }
}

void main().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : "Unknown transport report worker failure.";
  process.stderr.write(JSON.stringify({
    event: "transport-report-worker-fatal",
    message,
  }) + "\n");
  process.exitCode = 1;
});
