import { BadRequestException, Body, Controller, Injectable, Module, Param, Post } from "@nestjs/common";
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
