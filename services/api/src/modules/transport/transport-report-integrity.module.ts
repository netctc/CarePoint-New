import { Injectable, Module } from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { createHash } from "node:crypto";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { TransportReportArtifactStorageService } from "./transport-report-artifact-storage.service";

@Injectable()
export class TransportReportIntegrityService {
  private static readonly VERIFY_INTERVAL_MS = 24 * 60 * 60_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
    private readonly artifacts: TransportReportArtifactStorageService,
  ) {}

  async runOnce(principal: AuthPrincipal, limit = 50) {
    const boundedLimit = Math.max(1, Math.min(limit, 100));
    const now = new Date();
    const cutoff = new Date(
      now.getTime() - TransportReportIntegrityService.VERIFY_INTERVAL_MS,
    );
    const rows = await this.prisma.transportManagementReportRun.findMany({
      where: {
        status: "SUCCEEDED",
        artifactObjectKey: { not: null },
        artifactSha256: { not: null },
        artifactStoredAt: { not: null },
        artifactDeletedAt: null,
        artifactPurgeClaimedAt: null,
        OR: [
          { artifactIntegrityLastCheckedAt: null },
          { artifactIntegrityLastCheckedAt: { lt: cutoff } },
        ],
      },
      select: {
        id: true,
        artifactObjectKey: true,
        artifactSha256: true,
        artifactBytes: true,
        artifactLegalHold: true,
      },
      orderBy: [
        { artifactIntegrityLastCheckedAt: "asc" },
        { artifactStoredAt: "asc" },
        { id: "asc" },
      ],
      take: boundedLimit,
    });

    let verified = 0;
    let mismatch = 0;
    let checkFailed = 0;
    let skippedRace = 0;

    for (const row of rows) {
      if (!row.artifactObjectKey || !row.artifactSha256) continue;
      try {
        const csv = await this.artifacts.getCsv(row.artifactObjectKey);
        const bytes = Buffer.from(csv, "utf8");
        const actualSha256 = createHash("sha256").update(bytes).digest("hex");
        const shaMatches = actualSha256 === row.artifactSha256;
        const bytesMatch =
          row.artifactBytes == null || bytes.byteLength === row.artifactBytes;
        const integrityStatus = shaMatches && bytesMatch ? "VERIFIED" : "MISMATCH";
        const failureCode = shaMatches
          ? bytesMatch
            ? null
            : "BYTE_LENGTH_MISMATCH"
          : "SHA256_MISMATCH";
        const checkedAt = new Date();

        const updated =
          await this.prisma.transportManagementReportRun.updateMany({
            where: {
              id: row.id,
              artifactObjectKey: row.artifactObjectKey,
              artifactDeletedAt: null,
              artifactPurgeClaimedAt: null,
            },
            data: {
              artifactIntegrityStatus: integrityStatus,
              artifactIntegrityLastCheckedAt: checkedAt,
              artifactIntegrityFailureAt:
                integrityStatus === "VERIFIED" ? null : checkedAt,
              artifactIntegrityFailureCode: failureCode,
            },
          });
        if (updated.count !== 1) {
          skippedRace += 1;
          continue;
        }

        if (integrityStatus === "VERIFIED") {
          verified += 1;
          await this.audit.write({
            actorId: principal.accountId,
            action: "SYSTEM_TRANSPORT_REPORT_ARTIFACT_INTEGRITY_VERIFIED",
            objectType: "TRANSPORT_REPORT_RUN",
            objectId: row.id,
            purpose: "DATA_INTEGRITY",
            result: "SUCCESS",
            metadata: {
              sha256Verified: true,
              byteLengthVerified: true,
              artifactBytes: bytes.byteLength,
              legalHoldActive: row.artifactLegalHold,
              patientIdentityIncluded: false,
              patientLocationIncluded: false,
            },
          });
        } else {
          mismatch += 1;
          await this.audit.write({
            actorId: principal.accountId,
            action: "SYSTEM_TRANSPORT_REPORT_ARTIFACT_INTEGRITY_MISMATCH",
            objectType: "TRANSPORT_REPORT_RUN",
            objectId: row.id,
            purpose: "DATA_INTEGRITY",
            result: "FAILED",
            metadata: {
              failureCode,
              expectedSha256: row.artifactSha256,
              actualSha256,
              expectedBytes: row.artifactBytes,
              actualBytes: bytes.byteLength,
              legalHoldActive: row.artifactLegalHold,
            },
          });
        }
      } catch (error) {
        const checkedAt = new Date();
        const errorCode = this.safeErrorCode(error);
        const updated =
          await this.prisma.transportManagementReportRun.updateMany({
            where: {
              id: row.id,
              artifactObjectKey: row.artifactObjectKey,
              artifactDeletedAt: null,
              artifactPurgeClaimedAt: null,
            },
            data: {
              artifactIntegrityStatus: "CHECK_FAILED",
              artifactIntegrityLastCheckedAt: checkedAt,
              artifactIntegrityFailureAt: checkedAt,
              artifactIntegrityFailureCode: errorCode,
            },
          });
        if (updated.count !== 1) {
          skippedRace += 1;
          continue;
        }
        checkFailed += 1;
        await this.audit.write({
          actorId: principal.accountId,
          action: "SYSTEM_TRANSPORT_REPORT_ARTIFACT_INTEGRITY_CHECK_FAILED",
          objectType: "TRANSPORT_REPORT_RUN",
          objectId: row.id,
          purpose: "DATA_INTEGRITY",
          result: "FAILED",
          metadata: {
            errorCode,
            artifactMismatchConfirmed: false,
            legalHoldActive: row.artifactLegalHold,
          },
        }).catch(() => undefined);
      }
    }

    return {
      generatedAt: now.toISOString(),
      selected: rows.length,
      verified,
      mismatch,
      checkFailed,
      skippedRace,
      verifyIntervalHours: 24,
      batchLimit: boundedLimit,
    };
  }

  private safeErrorCode(error: unknown) {
    const name =
      error instanceof Error ? error.constructor.name : "IntegrityCheckError";
    return (
      name.replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 80) ||
      "IntegrityCheckError"
    );
  }
}

@Module({
  providers: [
    TransportReportIntegrityService,
    TransportReportArtifactStorageService,
  ],
  exports: [TransportReportIntegrityService],
})
export class TransportReportIntegrityModule {}
