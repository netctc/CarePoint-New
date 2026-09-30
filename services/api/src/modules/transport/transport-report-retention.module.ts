import { Injectable, Module } from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { TransportReportArtifactStorageService } from "./transport-report-artifact-storage.service";

@Injectable()
export class TransportReportRetentionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
    private readonly artifacts: TransportReportArtifactStorageService,
  ) {}

  async runOnce(principal: AuthPrincipal, limit = 100) {
    const boundedLimit = Math.max(1, Math.min(limit, 200));
    const now = new Date();
    const source = await this.prisma.transportManagementReportRun.findMany({
      where: {
        status: "SUCCEEDED",
        artifactObjectKey: { not: null },
        artifactStoredAt: { not: null },
        artifactDeletedAt: null,
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

      try {
        await this.artifacts.deleteCsv(row.artifactObjectKey);
        const purgedAt = new Date();
        const updated = await this.prisma.transportManagementReportRun.updateMany({
          where: {
            id: row.id,
            artifactObjectKey: row.artifactObjectKey,
            artifactDeletedAt: null,
          },
          data: {
            artifactObjectKey: null,
            artifactDeletedAt: purgedAt,
          },
        });
        if (updated.count !== 1) continue;

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

  private safeErrorCode(error: unknown) {
    const name =
      error instanceof Error ? error.constructor.name : "RetentionError";
    return (
      name.replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 80) ||
      "RetentionError"
    );
  }
}

@Module({
  providers: [
    TransportReportRetentionService,
    TransportReportArtifactStorageService,
  ],
  exports: [TransportReportRetentionService],
})
export class TransportReportRetentionModule {}
