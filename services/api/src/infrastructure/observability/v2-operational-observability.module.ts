import {
  CallHandler,
  ExecutionContext,
  Global,
  Injectable,
  Module,
  type NestInterceptor,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import type { Observable } from "rxjs";
import { PrismaService } from "../prisma/prisma.module";
import {
  V2OperationalTelemetryService,
  type V2OperationalDomain,
} from "./v2-operational-telemetry.service";

type RequestShape = {
  method?: string;
  route?: { path?: string };
  baseUrl?: string;
};

type ResponseShape = {
  statusCode?: number;
  once(event: "finish", listener: () => void): void;
};

const QUEUE_SAMPLE_MS = 15_000;

@Injectable()
class V2DomainObservabilityInterceptor implements NestInterceptor {
  constructor(private readonly telemetry: V2OperationalTelemetryService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== "http") return next.handle();
    const http = context.switchToHttp();
    const request = http.getRequest<RequestShape>();
    const response = http.getResponse<ResponseShape>();
    const started = process.hrtime.bigint();

    response.once("finish", () => {
      const route = `${request.baseUrl ?? ""}${request.route?.path ?? ""}`.toLowerCase();
      const domain = classifyV2Domain(route);
      if (!domain) return;
      const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;
      const statusCode = response.statusCode ?? 0;
      const method = (request.method ?? "UNKNOWN").toUpperCase();
      const operation = routeOperation(domain, method, route);
      this.telemetry.recordTechnical(domain, operation, statusCode >= 500 ? "ERROR" : "SUCCESS", durationMs);
    });

    return next.handle();
  }
}

@Injectable()
class V2QueueTelemetrySampler implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly telemetry: V2OperationalTelemetryService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.sample(), QUEUE_SAMPLE_MS);
    this.timer.unref?.();
    void this.sample();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async sample(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const [openAlerts, syncConflicts, externalDeliveries, exportJobs] = await Promise.all([
        this.prisma.clinicalAlert.count({ where: { status: "OPEN" } }),
        this.prisma.offlineFieldSyncConflict.count({ where: { status: "PENDING" } }),
        this.prisma.notificationDelivery.count({
          where: { status: "PENDING", channel: { in: ["PUSH", "EMAIL", "SMS"] } },
        }),
        this.prisma.fhirBulkExportJobState.count({
          where: { status: { notIn: ["COMPLETED", "FAILED", "CANCELLED", "EXPIRED"] } },
        }),
      ]);
      this.telemetry.recordQueueDepth("RPM", "OPEN_CLINICAL_ALERTS", openAlerts);
      this.telemetry.recordQueueDepth("SYNC", "PENDING_SYNC_CONFLICTS", syncConflicts);
      this.telemetry.recordQueueDepth("INTEGRATION", "PENDING_EXTERNAL_DELIVERIES", externalDeliveries);
      this.telemetry.recordQueueDepth("EXPORT", "ACTIVE_EXPORT_JOBS", exportJobs);
    } catch (error) {
      const errorCode = error instanceof Error
        ? error.constructor.name.replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 80)
        : "QueueTelemetryError";
      process.stderr.write(`${JSON.stringify({
        type: "v2_queue_telemetry_sample_failure",
        errorCode: errorCode || "QueueTelemetryError",
        timestamp: new Date().toISOString(),
      })}\n`);
    } finally {
      this.running = false;
    }
  }
}

export function classifyV2Domain(route: string): V2OperationalDomain | null {
  const normalized = route.toLowerCase();
  if (normalized.includes("questionnaire")) return "QUESTIONNAIRE";
  if (normalized.includes("observation")) return "OBSERVATION";
  if (normalized.includes("rpm") || normalized.includes("clinical-alert") || normalized.includes("alert-rules")) return "RPM";
  if (normalized.includes("export") || normalized.includes("$export")) return "EXPORT";
  if (normalized.includes("offline-sync")) return "SYNC";
  if (normalized.includes("integration") || normalized.includes("/fhir") || normalized.includes("/labs")) return "INTEGRATION";
  return null;
}

function routeOperation(domain: V2OperationalDomain, method: string, route: string): string {
  const routeShape = route
    .replace(/:[a-z0-9_]+/gi, "PARAM")
    .replace(/[^a-z0-9]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase()
    .slice(0, 48);
  const candidate = `${method}_${routeShape || domain}`.replace(/[^A-Z0-9_]/g, "_").slice(0, 64);
  return /^[A-Z][A-Z0-9_]{1,63}$/.test(candidate) ? candidate : `${domain}_OPERATION`;
}

@Global()
@Module({
  providers: [
    V2OperationalTelemetryService,
    V2QueueTelemetrySampler,
    { provide: APP_INTERCEPTOR, useClass: V2DomainObservabilityInterceptor },
  ],
  exports: [V2OperationalTelemetryService],
})
export class V2OperationalObservabilityModule {}
