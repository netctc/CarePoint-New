import "dotenv/config";
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { AuthPrincipal } from "@carepoint/identity";
import { AppModule } from "../app.module";
import { TransportReportExecutionService } from "../modules/transport/transport-report-execution.module";

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
    const result = await worker.workerCycle(principal, 25);
    process.stdout.write(JSON.stringify({
      event: "transport-report-worker-cycle",
      ...result,
    }) + "\n");
    if (result.failed > 0) process.exitCode = 1;
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
