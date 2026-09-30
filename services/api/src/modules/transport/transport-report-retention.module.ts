import { BadRequestException, Body, Controller, Get, Header, Injectable, Module, Param, Post } from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import {
  CurrentPrincipal,
  RequirePermissions,
} from "../../security/api-security.module";
import { TransportReportArtifactStorageService } from "./transport-report-artifact-storage.service";

@Injectable()
export class TransportReportRetentionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
    private readonly artifacts: TransportReportArtifactStorageService,
  ) {}

  async governance(principal: AuthPrincipal) {
    const now = new Date();
    const SOURCE_LIMIT = 2000;
    const source = await this.prisma.transportManagementReportRun.findMany({
      where: {
        status: "SUCCEEDED",
        artifactStoredAt: { not: null },
      },
      select: {
        id: true,
        scheduledFor: true,
        reportFilename: true,
        artifactStoredAt: true,
        artifactDeletedAt: true,
        artifactLegalHold: true,
        artifactLegalHoldReason: true,
        artifactLegalHoldSetAt: true,
        artifactPurgeClaimedAt: true,
        artifactBytes: true,
        deliveryStatus: true,
        schedule: {
          select: {
            id: true,
            name: true,
            artifactRetentionDays: true,
          },
        },
        deliveries: {
          select: { downloadedAt: true },
          take: 100,
        },
      },
      orderBy: [{ artifactStoredAt: "desc" }, { id: "desc" }],
      take: SOURCE_LIMIT,
    });

    const staleClaimBefore = new Date(now.getTime() - 15 * 60_000);
    const rows = source.map((row) => {
      const storedAt = row.artifactStoredAt!;
      const expiresAt = new Date(
        storedAt.getTime() +
          row.schedule.artifactRetentionDays * 86_400_000,
      );
      const daysUntilExpiry =
        Math.ceil((expiresAt.getTime() - now.getTime()) / 86_400_000);
      const activeClaim =
        Boolean(row.artifactPurgeClaimedAt) &&
        row.artifactPurgeClaimedAt!.getTime() >= staleClaimBefore.getTime();
      const state = row.artifactDeletedAt
        ? "PURGED"
        : row.artifactLegalHold
          ? "LEGAL_HOLD"
          : activeClaim
            ? "PURGE_CLAIMED"
            : expiresAt.getTime() <= now.getTime()
              ? "DUE"
              : "LIVE";
      return {
        runId: row.id,
        reportFilename: row.reportFilename,
        scheduledFor: row.scheduledFor,
        artifactStoredAt: storedAt,
        artifactDeletedAt: row.artifactDeletedAt,
        artifactBytes: row.artifactBytes,
        artifactLegalHold: row.artifactLegalHold,
        artifactLegalHoldReason: row.artifactLegalHoldReason,
        artifactLegalHoldSetAt: row.artifactLegalHoldSetAt,
        artifactPurgeClaimedAt: row.artifactPurgeClaimedAt,
        expiresAt,
        daysUntilExpiry,
        state,
        deliveryStatus: row.deliveryStatus,
        recipientDownloadReceipts: row.deliveries.filter(
          (delivery) => delivery.downloadedAt != null,
        ).length,
        schedule: row.schedule,
      };
    });

    const live = rows.filter((row) => row.state !== "PURGED");
    const summary = {
      sourceRuns: rows.length,
      sourceCapped: rows.length === SOURCE_LIMIT,
      liveArtifacts: live.length,
      purgedArtifacts: rows.filter((row) => row.state === "PURGED").length,
      legalHolds: rows.filter((row) => row.state === "LEGAL_HOLD").length,
      purgeClaimsActive: rows.filter((row) => row.state === "PURGE_CLAIMED").length,
      retentionDue: rows.filter((row) => row.state === "DUE").length,
      expiringWithin7Days: rows.filter(
        (row) =>
          row.state === "LIVE" &&
          row.daysUntilExpiry >= 0 &&
          row.daysUntilExpiry <= 7,
      ).length,
      expiringWithin30Days: rows.filter(
        (row) =>
          row.state === "LIVE" &&
          row.daysUntilExpiry >= 0 &&
          row.daysUntilExpiry <= 30,
      ).length,
      recipientDownloadReceipts: rows.reduce(
        (total, row) => total + row.recipientDownloadReceipts,
        0,
      ),
      deliveryAttentionRequired: rows.filter(
        (row) => row.deliveryStatus === "DELIVERY_ATTENTION_REQUIRED",
      ).length,
    };

    const items = rows
      .sort((a, b) => {
        const stateOrder: Record<string, number> = {
          DUE: 0,
          PURGE_CLAIMED: 1,
          LEGAL_HOLD: 2,
          LIVE: 3,
          PURGED: 4,
        };
        const byState =
          (stateOrder[a.state] ?? 99) - (stateOrder[b.state] ?? 99);
        if (byState !== 0) return byState;
        return a.expiresAt.getTime() - b.expiresAt.getTime();
      })
      .slice(0, 250);

    await this.audit.write({
      actorId: principal.accountId,
      action: "ADMIN_TRANSPORT_REPORT_GOVERNANCE_READ",
      objectType: "TRANSPORT_REPORT_GOVERNANCE",
      objectId: "OVERVIEW",
      purpose: "DATA_RETENTION",
      result: "SUCCESS",
      metadata: {
        ...summary,
        returnedItems: items.length,
        patientIdentityIncluded: false,
        patientLocationIncluded: false,
        objectStorageKeyIncluded: false,
      },
    });

    return {
      generatedAt: now.toISOString(),
      summary,
      sensitiveDataPolicy: {
        patientIdentityIncluded: false,
        patientLocationIncluded: false,
        objectStorageKeyIncluded: false,
      },
      items,
    };
  }

  async setLegalHold(
    principal: AuthPrincipal,
    runIdRaw: string,
    body: { reason?: unknown },
  ) {
    const runId = this.id(runIdRaw, "runId");
    const reason = this.reason(body.reason);
    const now = new Date();
    const staleBefore = new Date(now.getTime() - 15 * 60_000);

    const updated = await this.prisma.transportManagementReportRun.updateMany({
      where: {
        id: runId,
        status: "SUCCEEDED",
        artifactObjectKey: { not: null },
        artifactDeletedAt: null,
        OR: [
          { artifactPurgeClaimedAt: null },
          { artifactPurgeClaimedAt: { lt: staleBefore } },
        ],
      },
      data: {
        artifactLegalHold: true,
        artifactLegalHoldReason: reason,
        artifactLegalHoldSetAt: now,
        artifactLegalHoldSetByAccountId: principal.accountId,
        artifactPurgeClaimedAt: null,
      },
    });
    if (updated.count !== 1) {
      throw new BadRequestException(
        "Transport report artifact cannot enter legal hold because it is missing, purged, or currently being purged.",
      );
    }

    await this.audit.write({
      actorId: principal.accountId,
      action: "ADMIN_TRANSPORT_REPORT_ARTIFACT_LEGAL_HOLD_SET",
      objectType: "TRANSPORT_REPORT_RUN",
      objectId: runId,
      purpose: "DATA_RETENTION",
      result: "SUCCESS",
      metadata: {
        reason,
        purgeBlocked: true,
        patientIdentityIncluded: false,
        patientLocationIncluded: false,
      },
    });

    return {
      runId,
      artifactLegalHold: true,
      artifactLegalHoldReason: reason,
      artifactLegalHoldSetAt: now.toISOString(),
      purgeBlocked: true,
    };
  }

  async clearLegalHold(principal: AuthPrincipal, runIdRaw: string) {
    const runId = this.id(runIdRaw, "runId");
    const existing = await this.prisma.transportManagementReportRun.findUnique({
      where: { id: runId },
      select: {
        artifactLegalHold: true,
        artifactDeletedAt: true,
      },
    });
    if (!existing || existing.artifactDeletedAt) {
      throw new BadRequestException(
        "Transport report artifact legal hold cannot be changed.",
      );
    }
    if (!existing.artifactLegalHold) {
      return {
        runId,
        artifactLegalHold: false,
        changed: false,
      };
    }

    const updated = await this.prisma.transportManagementReportRun.update({
      where: { id: runId },
      data: {
        artifactLegalHold: false,
        artifactLegalHoldReason: null,
        artifactLegalHoldSetAt: null,
        artifactLegalHoldSetByAccountId: null,
      },
    });

    await this.audit.write({
      actorId: principal.accountId,
      action: "ADMIN_TRANSPORT_REPORT_ARTIFACT_LEGAL_HOLD_CLEARED",
      objectType: "TRANSPORT_REPORT_RUN",
      objectId: runId,
      purpose: "DATA_RETENTION",
      result: "SUCCESS",
      metadata: {
        purgeBlocked: false,
        priorHoldCleared: true,
      },
    });

    return {
      runId,
      artifactLegalHold: updated.artifactLegalHold,
      changed: true,
    };
  }

  async runOnce(principal: AuthPrincipal, limit = 100) {
    const boundedLimit = Math.max(1, Math.min(limit, 200));
    const now = new Date();
    const source = await this.prisma.transportManagementReportRun.findMany({
      where: {
        status: "SUCCEEDED",
        artifactObjectKey: { not: null },
        artifactStoredAt: { not: null },
        artifactDeletedAt: null,
        artifactLegalHold: false,
        OR: [
          { artifactPurgeClaimedAt: null },
          {
            artifactPurgeClaimedAt: {
              lt: new Date(now.getTime() - 15 * 60_000),
            },
          },
        ],
      },
      select: {
        id: true,
        artifactObjectKey: true,
        artifactStoredAt: true,
        artifactSha256: true,
        artifactBytes: true,
        schedule: {
          select: {
            id: true,
            artifactRetentionDays: true,
          },
        },
      },
      orderBy: [{ artifactStoredAt: "asc" }, { id: "asc" }],
      take: Math.max(boundedLimit, 200),
    });

    let due = 0;
    let deleted = 0;
    let failed = 0;
    let invalidatedGrants = 0;

    for (const row of source) {
      if (due >= boundedLimit) break;
      if (!row.artifactObjectKey || !row.artifactStoredAt) continue;
      const expiresAt = new Date(
        row.artifactStoredAt.getTime() +
          row.schedule.artifactRetentionDays * 86_400_000,
      );
      if (expiresAt.getTime() > now.getTime()) continue;
      due += 1;

      const claimTime = new Date();
      const staleBefore = new Date(claimTime.getTime() - 15 * 60_000);
      const claimed = await this.prisma.transportManagementReportRun.updateMany({
        where: {
          id: row.id,
          artifactObjectKey: row.artifactObjectKey,
          artifactDeletedAt: null,
          artifactLegalHold: false,
          OR: [
            { artifactPurgeClaimedAt: null },
            { artifactPurgeClaimedAt: { lt: staleBefore } },
          ],
        },
        data: { artifactPurgeClaimedAt: claimTime },
      });
      if (claimed.count !== 1) continue;

      try {
        await this.artifacts.deleteCsv(row.artifactObjectKey);
        const purgedAt = new Date();
        const updated = await this.prisma.transportManagementReportRun.updateMany({
          where: {
            id: row.id,
            artifactObjectKey: row.artifactObjectKey,
            artifactDeletedAt: null,
            artifactLegalHold: false,
            artifactPurgeClaimedAt: claimTime,
          },
          data: {
            artifactObjectKey: null,
            artifactDeletedAt: purgedAt,
            artifactPurgeClaimedAt: null,
          },
        });
        if (updated.count !== 1) {
          throw new Error("RetentionPurgeClaimLost");
        }

        const grants =
          await this.prisma.transportManagementReportDownloadGrant.updateMany({
            where: {
              runId: row.id,
              consumedAt: null,
            },
            data: { consumedAt: purgedAt },
          });
        invalidatedGrants += grants.count;
        deleted += 1;

        await this.audit.write({
          actorId: principal.accountId,
          action: "SYSTEM_TRANSPORT_REPORT_ARTIFACT_PURGED",
          objectType: "TRANSPORT_REPORT_RUN",
          objectId: row.id,
          purpose: "DATA_RETENTION",
          result: "SUCCESS",
          metadata: {
            scheduleId: row.schedule.id,
            retentionDays: row.schedule.artifactRetentionDays,
            artifactStoredAt: row.artifactStoredAt.toISOString(),
            artifactDeletedAt: purgedAt.toISOString(),
            artifactSha256Retained: Boolean(row.artifactSha256),
            artifactBytesRetained: row.artifactBytes,
            invalidatedDownloadGrants: grants.count,
            patientIdentityIncluded: false,
            patientLocationIncluded: false,
          },
        });
      } catch (error) {
        failed += 1;
        await this.prisma.transportManagementReportRun.updateMany({
          where: {
            id: row.id,
            artifactPurgeClaimedAt: claimTime,
            artifactDeletedAt: null,
          },
          data: { artifactPurgeClaimedAt: null },
        }).catch(() => undefined);
        await this.audit.write({
          actorId: principal.accountId,
          action: "SYSTEM_TRANSPORT_REPORT_ARTIFACT_PURGE_FAILED",
          objectType: "TRANSPORT_REPORT_RUN",
          objectId: row.id,
          purpose: "DATA_RETENTION",
          result: "FAILED",
          metadata: {
            scheduleId: row.schedule.id,
            retentionDays: row.schedule.artifactRetentionDays,
            errorCode: this.safeErrorCode(error),
            databaseMarkedPurged: false,
          },
        }).catch(() => undefined);
      }
    }

    return {
      generatedAt: now.toISOString(),
      scanned: source.length,
      due,
      deleted,
      failed,
      invalidatedGrants,
      batchLimit: boundedLimit,
      contentPurgedOnly: true,
      hashEvidenceRetained: true,
    };
  }

  private id(raw: string, field: string) {
    const value = raw.trim();
    if (!/^[A-Za-z0-9_.:-]{1,180}$/.test(value)) {
      throw new BadRequestException(field + " is invalid.");
    }
    return value;
  }

  private reason(raw: unknown) {
    if (typeof raw !== "string") {
      throw new BadRequestException("Legal hold reason is required.");
    }
    const value = raw.trim();
    if (!/^[\x20-\x7E]{3,500}$/.test(value)) {
      throw new BadRequestException(
        "Legal hold reason must contain 3 to 500 printable characters.",
      );
    }
    return value;
  }

  private safeErrorCode(error: unknown) {
    const name =
      error instanceof Error ? error.constructor.name : "RetentionError";
    return (
      name.replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 80) ||
      "RetentionError"
    );
  }
}

@Controller("admin/transport")
@RequirePermissions("TRANSPORT_OPERATE")
class TransportReportRetentionController {
  constructor(private readonly service: TransportReportRetentionService) {}

  @Get("report-governance")
  @Header("Cache-Control", "no-store")
  governance(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.service.governance(principal);
  }

  @Post("report-runs/:runId/legal-hold")
  setLegalHold(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("runId") runId: string,
    @Body() body: { reason?: unknown },
  ) {
    return this.service.setLegalHold(principal, runId, body ?? {});
  }

  @Post("report-runs/:runId/legal-hold/clear")
  clearLegalHold(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("runId") runId: string,
  ) {
    return this.service.clearLegalHold(principal, runId);
  }
}

@Module({
  controllers: [TransportReportRetentionController],
  providers: [
    TransportReportRetentionService,
    TransportReportArtifactStorageService,
  ],
  exports: [TransportReportRetentionService],
})
export class TransportReportRetentionModule {}
