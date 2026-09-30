import {
  BadRequestException,
  Controller,
  Get,
  Header,
  Injectable,
  Module,
  Param,
  Post,
  Query,
} from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { createHash } from "node:crypto";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import {
  CurrentPrincipal,
  RequirePermissions,
} from "../../security/api-security.module";
import {
  TransportCommandCenterModule,
  TransportCommandCenterService,
} from "./transport-command-center.module";
import { TransportReportArtifactStorageService } from "./transport-report-artifact-storage.service";
import {
  TransportReportDeliveryModule,
  TransportReportDeliveryOutboxService,
} from "./transport-report-delivery.module";

type RunStatus = "ALL" | "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED";

@Injectable()
export class TransportReportExecutionService {
  private static readonly LEASE_MS = 5 * 60_000;
  private static readonly MAX_ATTEMPTS = 5;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
    private readonly commandCenter: TransportCommandCenterService,
    private readonly artifacts: TransportReportArtifactStorageService,
    private readonly deliveries: TransportReportDeliveryOutboxService,
  ) {}

  async queueDue(principal: AuthPrincipal) {
    const now = new Date();
    const schedules = await this.prisma.transportManagementReportSchedule.findMany({
      where: { enabled: true, nextRunAt: { lte: now } },
      orderBy: [{ nextRunAt: "asc" }, { id: "asc" }],
      take: 100,
    });

    let queued = 0;
    let alreadyQueued = 0;
    for (const schedule of schedules) {
      const dueAt = schedule.nextRunAt;
      const created = await this.prisma.transportManagementReportRun.createMany({
        data: [
          {
            scheduleId: schedule.id,
            scheduledFor: dueAt,
            status: "QUEUED",
            createdByAccountId: principal.accountId,
          },
        ],
        skipDuplicates: true,
      });
      queued += created.count;
      alreadyQueued += created.count === 0 ? 1 : 0;

      const nextRunAt = this.nextRun(
        schedule,
        new Date(dueAt.getTime() + 60_000),
      );
      await this.prisma.transportManagementReportSchedule.updateMany({
        where: {
          id: schedule.id,
          enabled: true,
          nextRunAt: dueAt,
        },
        data: {
          nextRunAt,
          updatedByAccountId: principal.accountId,
        },
      });
    }

    await this.audit.write({
      actorId: principal.accountId,
      action: "ADMIN_TRANSPORT_REPORT_DUE_RUNS_QUEUED",
      objectType: "TRANSPORT_REPORT_RUN",
      objectId: "DUE",
      purpose: "TRANSPORT_OPERATIONS",
      result: "SUCCESS",
      metadata: {
        dueSchedules: schedules.length,
        queued,
        alreadyQueued,
        maxCatchUpPerSchedule: 1,
        automaticDeliveryAvailable: false,
      },
    });

    return {
      generatedAt: now.toISOString(),
      executionMode: "DURABLE_LEDGER_EXTERNAL_TRIGGER",
      dueSchedules: schedules.length,
      queued,
      alreadyQueued,
      maxCatchUpPerSchedule: 1,
      automaticDeliveryAvailable: false,
      reportDeliveryPerformed: false,
    };
  }

  async runs(
    principal: AuthPrincipal,
    statusRaw?: string,
    limitRaw?: string,
  ) {
    const status = this.status(statusRaw);
    const limit = this.integer(limitRaw, 50, 1, 200, "limit");
    const rows = await this.prisma.transportManagementReportRun.findMany({
      where: status === "ALL" ? {} : { status },
      include: {
        schedule: {
          select: {
            id: true,
            name: true,
            cadence: true,
            windowDays: true,
            mode: true,
            sla: true,
            providerId: true,
            enabled: true,
          },
        },
      },
      orderBy: [{ scheduledFor: "desc" }, { createdAt: "desc" }],
      take: limit,
    });

    await this.audit.write({
      actorId: principal.accountId,
      action: "ADMIN_TRANSPORT_REPORT_RUNS_READ",
      objectType: "TRANSPORT_REPORT_RUN",
      objectId: status,
      purpose: "TRANSPORT_OPERATIONS",
      result: "SUCCESS",
      metadata: { status, count: rows.length, limit },
    });

    return {
      generatedAt: new Date().toISOString(),
      executionMode: "DURABLE_LEDGER_EXTERNAL_TRIGGER",
      automaticDeliveryAvailable: false,
      items: rows.map((row) => this.present(row)),
    };
  }

  async execute(principal: AuthPrincipal, runIdRaw: string) {
    const runId = this.id(runIdRaw, "runId");
    const run = await this.prisma.transportManagementReportRun.findUnique({
      where: { id: runId },
      include: { schedule: true },
    });
    if (!run) throw new BadRequestException("Transport report run was not found.");
    if (run.status === "SUCCEEDED") return this.present(run);
    if (run.status !== "QUEUED") {
      throw new BadRequestException(
        "Transport report run must be QUEUED before execution.",
      );
    }
    if (run.attemptCount >= TransportReportExecutionService.MAX_ATTEMPTS) {
      throw new BadRequestException("Transport report run reached the retry limit.");
    }

    const startedAt = new Date();
    const leaseExpiresAt = new Date(
      startedAt.getTime() + TransportReportExecutionService.LEASE_MS,
    );
    const claim = await this.prisma.transportManagementReportRun.updateMany({
      where: { id: runId, status: "QUEUED" },
      data: {
        status: "RUNNING",
        claimedAt: startedAt,
        startedAt,
        leaseExpiresAt,
        attemptCount: { increment: 1 },
        failedAt: null,
        lastError: null,
      },
    });
    if (claim.count !== 1) {
      throw new BadRequestException("Transport report run is already claimed.");
    }

    try {
      const report = await this.commandCenter.managementReport(principal, {
        windowDays: String(run.schedule.windowDays),
        mode: run.schedule.mode,
        sla: run.schedule.sla,
        ...(run.schedule.providerId
          ? { providerId: run.schedule.providerId }
          : {}),
      });
      const csv = this.artifacts.encodeCsv(report.columns, report.rows);
      const artifactObjectKey = run.scheduleId + "/" + run.id + ".csv";
      const artifactSha256 = createHash("sha256")
        .update(csv, "utf8")
        .digest("hex");
      const artifactBytes = Buffer.byteLength(csv, "utf8");
      const artifactStoredAt = new Date();
      const artifactStorage = await this.artifacts.putCsv(artifactObjectKey, csv);

      const snapshot = {
        version: 2,
        runId,
        scheduleId: run.scheduleId,
        scheduledFor: run.scheduledFor.toISOString(),
        reportGeneratedAt: report.generatedAt,
        filename: report.filename,
        format: report.format,
        rowCount: report.rows.length,
        truncatedSource: report.truncatedSource,
        filters: {
          windowDays: run.schedule.windowDays,
          mode: run.schedule.mode,
          sla: run.schedule.sla,
          providerId: run.schedule.providerId,
        },
        summary: report.summary,
        sensitiveDataPolicy: report.sensitiveDataPolicy,
        artifact: {
          objectKey: artifactObjectKey,
          sha256: artifactSha256,
          bytes: artifactBytes,
          contentType: "text/csv; charset=utf-8",
          storageProvider: artifactStorage.provider,
          storedAt: artifactStoredAt.toISOString(),
          publicUrlIssued: false,
        },
        delivery: {
          status: "ARTIFACT_READY",
          externalDeliveryRequired: true,
          automaticDeliveryAvailable: false,
          reportDeliveryPerformed: false,
        },
      };
      const snapshotJson = JSON.stringify(snapshot);
      const snapshotHash = createHash("sha256")
        .update(snapshotJson, "utf8")
        .digest("hex");
      const completedAt = new Date();

      const updated = await this.prisma.transportManagementReportRun.update({
        where: { id: runId },
        data: {
          status: "SUCCEEDED",
          completedAt,
          leaseExpiresAt: null,
          reportGeneratedAt: new Date(report.generatedAt),
          reportFilename: report.filename,
          reportFormat: report.format,
          rowCount: report.rows.length,
          truncatedSource: report.truncatedSource,
          snapshotHash,
          snapshotJson,
          artifactObjectKey,
          artifactSha256,
          artifactBytes,
          artifactContentType: "text/csv; charset=utf-8",
          artifactStorageProvider: artifactStorage.provider,
          artifactStoredAt,
          deliveryStatus: "ARTIFACT_READY",
        },
        include: {
          schedule: {
            select: {
              id: true,
              name: true,
              cadence: true,
              windowDays: true,
              mode: true,
              sla: true,
              providerId: true,
              enabled: true,
            },
          },
        },
      });

      await this.prisma.transportManagementReportSchedule.update({
        where: { id: run.scheduleId },
        data: {
          lastRunAt: completedAt,
          updatedByAccountId: principal.accountId,
        },
      });

      await this.audit.write({
        actorId: principal.accountId,
        action: "ADMIN_TRANSPORT_REPORT_RUN_SUCCEEDED",
        objectType: "TRANSPORT_REPORT_RUN",
        objectId: runId,
        purpose: "TRANSPORT_OPERATIONS",
        result: "SUCCESS",
        metadata: {
          scheduleId: run.scheduleId,
          scheduledFor: run.scheduledFor.toISOString(),
          rowCount: report.rows.length,
          truncatedSource: report.truncatedSource,
          snapshotHash,
          artifactSha256,
          artifactBytes,
          artifactStorageProvider: artifactStorage.provider,
          artifactPublicUrlIssued: false,
          patientIdentityIncluded: false,
          patientLocationIncluded: false,
          reportDeliveryPerformed: false,
        },
      });

      return this.present(updated);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message.slice(0, 1000)
          : "Unknown transport report execution failure.";
      await this.prisma.transportManagementReportRun.updateMany({
        where: { id: runId, status: "RUNNING" },
        data: {
          status: "FAILED",
          failedAt: new Date(),
          leaseExpiresAt: null,
          lastError: message,
        },
      });
      await this.audit.write({
        actorId: principal.accountId,
        action: "ADMIN_TRANSPORT_REPORT_RUN_FAILED",
        objectType: "TRANSPORT_REPORT_RUN",
        objectId: runId,
        purpose: "TRANSPORT_OPERATIONS",
        result: "FAILED",
        metadata: {
          scheduleId: run.scheduleId,
          scheduledFor: run.scheduledFor.toISOString(),
          error: message,
          reportDeliveryPerformed: false,
        },
      });
      throw error;
    }
  }

  async retry(principal: AuthPrincipal, runIdRaw: string) {
    const runId = this.id(runIdRaw, "runId");
    const existing = await this.prisma.transportManagementReportRun.findUnique({
      where: { id: runId },
    });
    if (!existing) throw new BadRequestException("Transport report run was not found.");
    if (existing.status !== "FAILED") {
      throw new BadRequestException("Only FAILED transport report runs can be retried.");
    }
    if (existing.attemptCount >= TransportReportExecutionService.MAX_ATTEMPTS) {
      throw new BadRequestException("Transport report run reached the retry limit.");
    }

    await this.prisma.transportManagementReportRun.update({
      where: { id: runId },
      data: {
        status: "QUEUED",
        claimedAt: null,
        leaseExpiresAt: null,
        startedAt: null,
        failedAt: null,
        lastError: null,
      },
    });
    await this.audit.write({
      actorId: principal.accountId,
      action: "ADMIN_TRANSPORT_REPORT_RUN_REQUEUED",
      objectType: "TRANSPORT_REPORT_RUN",
      objectId: runId,
      purpose: "TRANSPORT_OPERATIONS",
      result: "SUCCESS",
      metadata: {
        attemptCount: existing.attemptCount,
        maxAttempts: TransportReportExecutionService.MAX_ATTEMPTS,
      },
    });
    return { runId, status: "QUEUED" };
  }

  async recoverStale(principal: AuthPrincipal) {
    const now = new Date();
    const recovered = await this.prisma.transportManagementReportRun.updateMany({
      where: {
        status: "RUNNING",
        leaseExpiresAt: { lt: now },
        attemptCount: { lt: TransportReportExecutionService.MAX_ATTEMPTS },
      },
      data: {
        status: "QUEUED",
        claimedAt: null,
        leaseExpiresAt: null,
        startedAt: null,
        lastError: "Recovered after execution lease expiry.",
      },
    });
    const exhausted = await this.prisma.transportManagementReportRun.updateMany({
      where: {
        status: "RUNNING",
        leaseExpiresAt: { lt: now },
        attemptCount: { gte: TransportReportExecutionService.MAX_ATTEMPTS },
      },
      data: {
        status: "FAILED",
        failedAt: now,
        leaseExpiresAt: null,
        lastError: "Execution lease expired after the maximum attempt count.",
      },
    });

    await this.audit.write({
      actorId: principal.accountId,
      action: "ADMIN_TRANSPORT_REPORT_RUN_STALE_RECOVERY",
      objectType: "TRANSPORT_REPORT_RUN",
      objectId: "STALE",
      purpose: "TRANSPORT_OPERATIONS",
      result: "SUCCESS",
      metadata: { recovered: recovered.count, exhausted: exhausted.count },
    });

    return {
      recovered: recovered.count,
      exhausted: exhausted.count,
      leaseMinutes: TransportReportExecutionService.LEASE_MS / 60_000,
      maxAttempts: TransportReportExecutionService.MAX_ATTEMPTS,
    };
  }

  async prepareDeliveryHandoff(
    principal: AuthPrincipal,
    runIdRaw: string,
  ) {
    const runId = this.id(runIdRaw, "runId");
    const existing = await this.prisma.transportManagementReportRun.findUnique({
      where: { id: runId },
    });
    if (!existing) {
      throw new BadRequestException("Transport report run was not found.");
    }
    if (
      existing.status !== "SUCCEEDED" ||
      !existing.artifactObjectKey ||
      !existing.artifactSha256 ||
      !existing.artifactStoredAt
    ) {
      throw new BadRequestException(
        "Transport report artifact is not ready for delivery handoff.",
      );
    }

    const preparedAt = existing.deliveryHandoffPreparedAt ?? new Date();
    const outbox = await this.deliveries.enqueueForRun(principal, {
      id: existing.id,
      scheduleId: existing.scheduleId,
    });
    const deliveryStatus =
      outbox.configuredDestinations > 0
        ? "DELIVERY_OUTBOX_READY"
        : "READY_FOR_EXTERNAL_DELIVERY";
    const row = await this.prisma.transportManagementReportRun.update({
      where: { id: runId },
      data: {
        deliveryStatus,
        deliveryHandoffPreparedAt: preparedAt,
        deliveryHandoffPreparedByAccountId:
          existing.deliveryHandoffPreparedByAccountId ?? principal.accountId,
      },
    });

    await this.audit.write({
      actorId: principal.accountId,
      action: "ADMIN_TRANSPORT_REPORT_DELIVERY_HANDOFF_PREPARED",
      objectType: "TRANSPORT_REPORT_RUN",
      objectId: runId,
      purpose: "TRANSPORT_OPERATIONS",
      result: "SUCCESS",
      metadata: {
        artifactSha256: row.artifactSha256,
        artifactBytes: row.artifactBytes,
        artifactStorageProvider: row.artifactStorageProvider,
        publicUrlIssued: false,
        externalDeliveryRequired: true,
        reportDeliveryPerformed: false,
        configuredDestinations: outbox.configuredDestinations,
        newlyQueuedDeliveries: outbox.newlyQueued,
      },
    });

    return {
      runId,
      scheduleId: row.scheduleId,
      deliveryStatus: row.deliveryStatus,
      handoffPreparedAt: preparedAt,
      artifact: {
        objectKey: row.artifactObjectKey,
        sha256: row.artifactSha256,
        bytes: row.artifactBytes,
        contentType: row.artifactContentType,
        storageProvider: row.artifactStorageProvider,
        storedAt: row.artifactStoredAt,
      },
      deliveryOutbox: outbox,
      externalDeliveryRequired: true,
      automaticDeliveryAvailable: false,
      reportDeliveryPerformed: false,
      publicUrlIssued: false,
    };
  }

  async workerCycle(principal: AuthPrincipal, limit = 25) {
    const boundedLimit = Math.max(1, Math.min(limit, 100));
    const recovery = await this.recoverStale(principal);
    const queue = await this.queueDue(principal);
    const queued = await this.prisma.transportManagementReportRun.findMany({
      where: { status: "QUEUED" },
      select: { id: true },
      orderBy: [{ scheduledFor: "asc" }, { createdAt: "asc" }],
      take: boundedLimit,
    });

    let succeeded = 0;
    let failed = 0;
    for (const row of queued) {
      try {
        await this.execute(principal, row.id);
        succeeded += 1;
      } catch {
        failed += 1;
      }
    }

    const payload = {
      generatedAt: new Date().toISOString(),
      executionMode: "CLOUD_RUN_JOB_APPLICATION_CONTEXT",
      workerBatchLimit: boundedLimit,
      recoveredStale: recovery.recovered,
      exhaustedStale: recovery.exhausted,
      dueSchedules: queue.dueSchedules,
      newlyQueued: queue.queued,
      selectedRuns: queued.length,
      succeeded,
      failed,
      automaticDeliveryAvailable: false,
      reportDeliveryPerformed: false,
    };

    await this.audit.write({
      actorId: principal.accountId,
      action: "SYSTEM_TRANSPORT_REPORT_WORKER_CYCLE",
      objectType: "TRANSPORT_REPORT_WORKER",
      objectId: principal.sessionId,
      purpose: "TRANSPORT_OPERATIONS",
      result: failed > 0 ? "FAILED" : "SUCCESS",
      metadata: payload,
    });

    return payload;
  }

  private present(row: any) {
    let snapshot: unknown = null;
    if (typeof row.snapshotJson === "string" && row.snapshotJson.length) {
      try {
        snapshot = JSON.parse(row.snapshotJson);
      } catch {
        snapshot = null;
      }
    }
    return {
      id: row.id,
      scheduleId: row.scheduleId,
      schedule: row.schedule ?? null,
      scheduledFor: row.scheduledFor,
      status: row.status,
      attemptCount: row.attemptCount,
      claimedAt: row.claimedAt,
      leaseExpiresAt: row.leaseExpiresAt,
      startedAt: row.startedAt,
      completedAt: row.completedAt,
      failedAt: row.failedAt,
      lastError: row.lastError,
      reportGeneratedAt: row.reportGeneratedAt,
      reportFilename: row.reportFilename,
      reportFormat: row.reportFormat,
      rowCount: row.rowCount,
      truncatedSource: row.truncatedSource,
      snapshotHash: row.snapshotHash,
      snapshot,
      artifactObjectKey: row.artifactObjectKey,
      artifactSha256: row.artifactSha256,
      artifactBytes: row.artifactBytes,
      artifactContentType: row.artifactContentType,
      artifactStorageProvider: row.artifactStorageProvider,
      artifactStoredAt: row.artifactStoredAt,
      deliveryStatus: row.deliveryStatus,
      deliveryHandoffPreparedAt: row.deliveryHandoffPreparedAt,
      deliveryHandoffPreparedByAccountId: row.deliveryHandoffPreparedByAccountId,
      publicUrlIssued: false,
      automaticDeliveryAvailable: false,
      reportDeliveryPerformed: false,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private nextRun(
    input: {
      cadence: string;
      weekday: number | null;
      dayOfMonth: number | null;
      hourUtc: number;
      minuteUtc: number;
    },
    after: Date,
  ) {
    if (input.cadence === "DAILY") {
      const candidate = new Date(
        Date.UTC(
          after.getUTCFullYear(),
          after.getUTCMonth(),
          after.getUTCDate(),
          input.hourUtc,
          input.minuteUtc,
        ),
      );
      if (candidate.getTime() <= after.getTime()) {
        candidate.setUTCDate(candidate.getUTCDate() + 1);
      }
      return candidate;
    }
    if (input.cadence === "WEEKLY") {
      const weekday = input.weekday ?? 1;
      const candidate = new Date(
        Date.UTC(
          after.getUTCFullYear(),
          after.getUTCMonth(),
          after.getUTCDate(),
          input.hourUtc,
          input.minuteUtc,
        ),
      );
      let addDays = (weekday - candidate.getUTCDay() + 7) % 7;
      if (addDays === 0 && candidate.getTime() <= after.getTime()) addDays = 7;
      candidate.setUTCDate(candidate.getUTCDate() + addDays);
      return candidate;
    }
    const day = input.dayOfMonth ?? 1;
    let candidate = new Date(
      Date.UTC(
        after.getUTCFullYear(),
        after.getUTCMonth(),
        day,
        input.hourUtc,
        input.minuteUtc,
      ),
    );
    if (candidate.getTime() <= after.getTime()) {
      candidate = new Date(
        Date.UTC(
          after.getUTCFullYear(),
          after.getUTCMonth() + 1,
          day,
          input.hourUtc,
          input.minuteUtc,
        ),
      );
    }
    return candidate;
  }

  private status(raw?: string): RunStatus {
    if (!raw) return "ALL";
    const value = raw.trim().toUpperCase() as RunStatus;
    if (!["ALL", "QUEUED", "RUNNING", "SUCCEEDED", "FAILED"].includes(value)) {
      throw new BadRequestException("status is invalid.");
    }
    return value;
  }

  private integer(
    raw: string | undefined,
    fallback: number,
    min: number,
    max: number,
    field: string,
  ) {
    if (raw == null || raw.trim() === "") return fallback;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < min || value > max) {
      throw new BadRequestException(
        field + " must be an integer between " + String(min) + " and " + String(max) + ".",
      );
    }
    return value;
  }

  private id(raw: string, field: string) {
    const value = raw.trim();
    if (!/^[A-Za-z0-9_.:-]{1,180}$/.test(value)) {
      throw new BadRequestException(field + " is invalid.");
    }
    return value;
  }
}

@Controller("admin/transport")
@RequirePermissions("TRANSPORT_OPERATE")
class TransportReportExecutionController {
  constructor(private readonly service: TransportReportExecutionService) {}

  @Get("report-runs")
  @Header("Cache-Control", "no-store")
  runs(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Query("status") status?: string,
    @Query("limit") limit?: string,
  ) {
    return this.service.runs(principal, status, limit);
  }

  @Post("report-runs/queue-due")
  queueDue(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.service.queueDue(principal);
  }

  @Post("report-runs/recover-stale")
  recoverStale(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.service.recoverStale(principal);
  }

  @Post("report-runs/:runId/execute")
  execute(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("runId") runId: string,
  ) {
    return this.service.execute(principal, runId);
  }

  @Post("report-runs/:runId/retry")
  retry(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("runId") runId: string,
  ) {
    return this.service.retry(principal, runId);
  }

  @Post("report-runs/:runId/prepare-delivery-handoff")
  prepareDeliveryHandoff(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("runId") runId: string,
  ) {
    return this.service.prepareDeliveryHandoff(principal, runId);
  }
}

@Module({
  imports: [TransportCommandCenterModule, TransportReportDeliveryModule],
  controllers: [TransportReportExecutionController],
  providers: [
    TransportReportExecutionService,
    TransportReportArtifactStorageService,
  ],
  exports: [TransportReportExecutionService],
})
export class TransportReportExecutionModule {}
