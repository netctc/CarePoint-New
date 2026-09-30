import {
  BadRequestException,
  Controller,
  Get,
  Injectable,
  Module,
  Param,
} from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import {
  CurrentPrincipal,
  RequirePermissions,
} from "../../security/api-security.module";

const GOVERNANCE_ACTIONS = [
  "ADMIN_TRANSPORT_REPORT_RUN_SUCCEEDED",
  "ADMIN_TRANSPORT_REPORT_RUN_FAILED",
  "ADMIN_TRANSPORT_REPORT_RUN_REQUEUED",
  "ADMIN_TRANSPORT_REPORT_DELIVERY_OUTBOX_ENQUEUED",
  "ADMIN_TRANSPORT_REPORT_DELIVERY_HANDOFF_PREPARED",
  "ADMIN_TRANSPORT_REPORT_DOWNLOAD_GRANT_ISSUED",
  "ADMIN_TRANSPORT_REPORT_DOWNLOAD_FAILED",
  "ADMIN_TRANSPORT_REPORT_DOWNLOAD_INTEGRITY_FAILED",
  "ADMIN_TRANSPORT_REPORT_DOWNLOADED",
  "ADMIN_TRANSPORT_REPORT_ARTIFACT_LEGAL_HOLD_SET",
  "ADMIN_TRANSPORT_REPORT_ARTIFACT_LEGAL_HOLD_CLEARED",
  "SYSTEM_TRANSPORT_REPORT_ARTIFACT_PURGED",
  "SYSTEM_TRANSPORT_REPORT_ARTIFACT_PURGE_FAILED",
  "SYSTEM_TRANSPORT_REPORT_ARTIFACT_INTEGRITY_VERIFIED",
  "SYSTEM_TRANSPORT_REPORT_ARTIFACT_INTEGRITY_MISMATCH",
  "SYSTEM_TRANSPORT_REPORT_ARTIFACT_INTEGRITY_CHECK_FAILED",
] as const;

@Injectable()
export class TransportReportGovernanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
  ) {}

  async timeline(principal: AuthPrincipal, runIdRaw: string) {
    const runId = this.id(runIdRaw, "runId");
    const run = await this.prisma.transportManagementReportRun.findUnique({
      where: { id: runId },
      select: {
        id: true,
        scheduleId: true,
        scheduledFor: true,
        status: true,
        attemptCount: true,
        reportGeneratedAt: true,
        reportFilename: true,
        rowCount: true,
        truncatedSource: true,
        artifactSha256: true,
        artifactBytes: true,
        artifactContentType: true,
        artifactStorageProvider: true,
        artifactStoredAt: true,
        artifactDeletedAt: true,
        artifactIntegrityStatus: true,
        artifactIntegrityLastCheckedAt: true,
        artifactIntegrityFailureAt: true,
        artifactIntegrityFailureCode: true,
        artifactLegalHold: true,
        artifactLegalHoldReason: true,
        artifactLegalHoldSetAt: true,
        artifactLegalHoldSetByAccountId: true,
        deliveryStatus: true,
        deliveryHandoffPreparedAt: true,
        deliveryHandoffPreparedByAccountId: true,
        createdAt: true,
        updatedAt: true,
        deliveries: {
          select: {
            status: true,
            sentAt: true,
            downloadedAt: true,
            downloadedByAccountId: true,
          },
          orderBy: { createdAt: "asc" },
          take: 200,
        },
        schedule: {
          select: {
            id: true,
            name: true,
            artifactRetentionDays: true,
          },
        },
      },
    });
    if (!run) {
      throw new BadRequestException("Transport report run was not found.");
    }

    const events = await this.prisma.auditEvent.findMany({
      where: {
        objectType: "TRANSPORT_REPORT_RUN",
        objectId: runId,
        action: { in: [...GOVERNANCE_ACTIONS] },
      },
      select: {
        id: true,
        actorId: true,
        action: true,
        purpose: true,
        result: true,
        occurredAt: true,
      },
      orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
      take: 300,
    });

    const integrityRows = events.length
      ? await this.prisma.auditIntegrityRecord.findMany({
          where: { auditEventId: { in: events.map((event) => event.id) } },
          select: {
            auditEventId: true,
            sequence: true,
            payloadHash: true,
            previousHash: true,
            eventHash: true,
          },
        })
      : [];
    const integrityById = new Map(
      integrityRows.map((row) => [row.auditEventId, row]),
    );

    const receipts = run.deliveries.filter((item) => item.downloadedAt);
    const notifications = run.deliveries.filter((item) => item.sentAt);
    const artifactState = run.artifactDeletedAt
      ? "PURGED"
      : run.artifactLegalHold
        ? "LEGAL_HOLD"
        : run.artifactSha256
          ? "LIVE_PRIVATE"
          : "NOT_AVAILABLE";

    const payload = {
      generatedAt: new Date().toISOString(),
      run: {
        id: run.id,
        scheduleId: run.scheduleId,
        scheduleName: run.schedule.name,
        scheduledFor: run.scheduledFor,
        status: run.status,
        attemptCount: run.attemptCount,
        reportGeneratedAt: run.reportGeneratedAt,
        reportFilename: run.reportFilename,
        rowCount: run.rowCount,
        truncatedSource: run.truncatedSource,
        deliveryStatus: run.deliveryStatus,
      },
      governance: {
        artifactState,
        artifactSha256: run.artifactSha256,
        artifactBytes: run.artifactBytes,
        artifactContentType: run.artifactContentType,
        artifactStorageProvider: run.artifactStorageProvider,
        artifactStoredAt: run.artifactStoredAt,
        artifactDeletedAt: run.artifactDeletedAt,
        artifactIntegrityStatus: run.artifactIntegrityStatus,
        artifactIntegrityLastCheckedAt: run.artifactIntegrityLastCheckedAt,
        artifactIntegrityFailureAt: run.artifactIntegrityFailureAt,
        artifactIntegrityFailureCode: run.artifactIntegrityFailureCode,
        artifactRetentionDays: run.schedule.artifactRetentionDays,
        legalHold: run.artifactLegalHold,
        legalHoldReason: run.artifactLegalHoldReason,
        legalHoldSetAt: run.artifactLegalHoldSetAt,
        legalHoldSetByAccountId: run.artifactLegalHoldSetByAccountId,
        deliveryHandoffPreparedAt: run.deliveryHandoffPreparedAt,
        deliveryHandoffPreparedByAccountId:
          run.deliveryHandoffPreparedByAccountId,
        notificationCount: notifications.length,
        downloadReceiptCount: receipts.length,
        firstDownloadedAt:
          receipts
            .map((item) => item.downloadedAt)
            .filter((value): value is Date => Boolean(value))
            .sort((a, b) => a.getTime() - b.getTime())[0] ?? null,
      },
      timeline: events.map((event) => {
        const integrity = integrityById.get(event.id);
        return {
          eventId: event.id,
          occurredAt: event.occurredAt,
          actorId: event.actorId,
          action: event.action,
          category: this.category(event.action),
          result: event.result,
          purpose: event.purpose,
          sequence: integrity ? integrity.sequence.toString() : null,
          payloadHash: integrity?.payloadHash ?? null,
          previousHash: integrity?.previousHash ?? null,
          eventHash: integrity?.eventHash ?? null,
          integrityEvidenceAvailable: Boolean(integrity),
        };
      }),
      sensitiveDataPolicy: {
        rawAuditMetadataIncluded: false,
        objectStorageKeyIncluded: false,
        patientIdentityIncluded: false,
        patientContactIncluded: false,
        patientLocationIncluded: false,
        csvContentIncluded: false,
      },
    };

    await this.audit.write({
      actorId: principal.accountId,
      action: "ADMIN_TRANSPORT_REPORT_GOVERNANCE_TIMELINE_READ",
      objectType: "TRANSPORT_REPORT_GOVERNANCE",
      objectId: runId,
      purpose: "DATA_GOVERNANCE",
      result: "SUCCESS",
      metadata: {
        eventCount: events.length,
        artifactState,
        rawAuditMetadataIncluded: false,
        objectStorageKeyIncluded: false,
        patientIdentityIncluded: false,
        patientLocationIncluded: false,
      },
    });

    return payload;
  }

  private category(action: string) {
    if (action.includes("INTEGRITY")) return "INTEGRITY";
    if (action.includes("LEGAL_HOLD")) return "LEGAL_HOLD";
    if (action.includes("PURGE")) return "RETENTION";
    if (action.includes("DOWNLOAD")) return "DOWNLOAD";
    if (action.includes("DELIVERY")) return "DELIVERY";
    if (action.includes("RUN_")) return "EXECUTION";
    return "GOVERNANCE";
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
class TransportReportGovernanceController {
  constructor(private readonly service: TransportReportGovernanceService) {}

  @Get("report-runs/:runId/governance-timeline")
  timeline(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("runId") runId: string,
  ) {
    return this.service.timeline(principal, runId);
  }
}

@Module({
  controllers: [TransportReportGovernanceController],
  providers: [TransportReportGovernanceService],
})
export class TransportReportGovernanceModule {}
