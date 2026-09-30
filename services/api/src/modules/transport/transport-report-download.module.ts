import {
  BadRequestException,
  Body,
  Controller,
  Header,
  Injectable,
  InternalServerErrorException,
  Module,
  Param,
  Post,
  StreamableFile,
} from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { createHash, randomBytes } from "node:crypto";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import {
  CurrentPrincipal,
  RequirePermissions,
} from "../../security/api-security.module";
import { TransportReportArtifactStorageService } from "./transport-report-artifact-storage.service";

type DownloadInput = {
  grantToken?: unknown;
};

@Injectable()
export class TransportReportDownloadService {
  private static readonly GRANT_TTL_MS = 5 * 60_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
    private readonly artifacts: TransportReportArtifactStorageService,
  ) {}

  async issueGrant(principal: AuthPrincipal, runIdRaw: string) {
    const runId = this.id(runIdRaw, "runId");
    const run = await this.prisma.transportManagementReportRun.findUnique({
      where: { id: runId },
      select: {
        id: true,
        status: true,
        artifactObjectKey: true,
        artifactSha256: true,
        artifactStoredAt: true,
      },
    });
    if (
      !run ||
      run.status !== "SUCCEEDED" ||
      !run.artifactObjectKey ||
      !run.artifactSha256 ||
      !run.artifactStoredAt
    ) {
      throw new BadRequestException(
        "Transport report artifact is not available for download.",
      );
    }

    const now = new Date();
    await this.prisma.transportManagementReportDownloadGrant.updateMany({
      where: {
        runId,
        issuedToAccountId: principal.accountId,
        consumedAt: null,
        expiresAt: { gt: now },
      },
      data: { consumedAt: now },
    });

    const grantToken = randomBytes(32).toString("base64url");
    const tokenHash = this.tokenHash(grantToken);
    const expiresAt = new Date(
      now.getTime() + TransportReportDownloadService.GRANT_TTL_MS,
    );
    await this.prisma.transportManagementReportDownloadGrant.create({
      data: {
        runId,
        tokenHash,
        issuedToAccountId: principal.accountId,
        expiresAt,
      },
    });

    await this.audit.write({
      actorId: principal.accountId,
      action: "ADMIN_TRANSPORT_REPORT_DOWNLOAD_GRANT_ISSUED",
      objectType: "TRANSPORT_REPORT_RUN",
      objectId: runId,
      purpose: "TRANSPORT_OPERATIONS",
      result: "SUCCESS",
      metadata: {
        expiresAt: expiresAt.toISOString(),
        ttlSeconds: TransportReportDownloadService.GRANT_TTL_MS / 1000,
        oneTime: true,
        tokenPersistedPlaintext: false,
        publicUrlIssued: false,
      },
    });

    return {
      runId,
      grantToken,
      expiresAt: expiresAt.toISOString(),
      oneTime: true,
      publicUrlIssued: false,
      tokenTransport: "SAME_ORIGIN_POST_BODY",
    };
  }

  async consume(
    principal: AuthPrincipal,
    runIdRaw: string,
    body: DownloadInput,
  ) {
    const runId = this.id(runIdRaw, "runId");
    const grantToken = this.grantToken(body.grantToken);
    const tokenHash = this.tokenHash(grantToken);
    const now = new Date();

    const grant =
      await this.prisma.transportManagementReportDownloadGrant.findUnique({
        where: { tokenHash },
        include: {
          run: {
            select: {
              id: true,
              status: true,
              reportFilename: true,
              artifactObjectKey: true,
              artifactSha256: true,
              artifactBytes: true,
              artifactContentType: true,
              artifactStoredAt: true,
            },
          },
        },
      });

    if (
      !grant ||
      grant.runId !== runId ||
      grant.issuedToAccountId !== principal.accountId ||
      grant.consumedAt ||
      grant.expiresAt.getTime() <= now.getTime() ||
      grant.run.status !== "SUCCEEDED" ||
      !grant.run.artifactObjectKey ||
      !grant.run.artifactSha256
    ) {
      throw new BadRequestException(
        "Transport report download grant is invalid or expired.",
      );
    }

    const consumed =
      await this.prisma.transportManagementReportDownloadGrant.updateMany({
        where: {
          id: grant.id,
          runId,
          issuedToAccountId: principal.accountId,
          consumedAt: null,
          expiresAt: { gt: now },
        },
        data: { consumedAt: now },
      });
    if (consumed.count !== 1) {
      throw new BadRequestException(
        "Transport report download grant is invalid or expired.",
      );
    }

    let csv: string;
    try {
      csv = await this.artifacts.getCsv(grant.run.artifactObjectKey);
    } catch (error) {
      await this.audit.write({
        actorId: principal.accountId,
        action: "ADMIN_TRANSPORT_REPORT_DOWNLOAD_FAILED",
        objectType: "TRANSPORT_REPORT_RUN",
        objectId: runId,
        purpose: "TRANSPORT_OPERATIONS",
        result: "FAILED",
        metadata: {
          reason: "ARTIFACT_READ_FAILED",
          grantConsumed: true,
        },
      });
      throw error;
    }

    const bytes = Buffer.from(csv, "utf8");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (
      sha256 !== grant.run.artifactSha256 ||
      (grant.run.artifactBytes != null &&
        bytes.byteLength !== grant.run.artifactBytes)
    ) {
      await this.audit.write({
        actorId: principal.accountId,
        action: "ADMIN_TRANSPORT_REPORT_DOWNLOAD_INTEGRITY_FAILED",
        objectType: "TRANSPORT_REPORT_RUN",
        objectId: runId,
        purpose: "TRANSPORT_OPERATIONS",
        result: "FAILED",
        metadata: {
          expectedSha256: grant.run.artifactSha256,
          actualSha256: sha256,
          expectedBytes: grant.run.artifactBytes,
          actualBytes: bytes.byteLength,
        },
      });
      throw new InternalServerErrorException(
        "Transport report artifact integrity validation failed.",
      );
    }

    const recipientReceipts =
      await this.prisma.transportManagementReportDelivery.updateMany({
        where: {
          runId,
          status: "SENT",
          downloadedAt: null,
          destination: {
            recipientAccountId: principal.accountId,
          },
        },
        data: {
          downloadedAt: new Date(),
          downloadedByAccountId: principal.accountId,
        },
      });

    await this.audit.write({
      actorId: principal.accountId,
      action: "ADMIN_TRANSPORT_REPORT_DOWNLOADED",
      objectType: "TRANSPORT_REPORT_RUN",
      objectId: runId,
      purpose: "TRANSPORT_OPERATIONS",
      result: "SUCCESS",
      metadata: {
        bytes: bytes.byteLength,
        sha256,
        oneTimeGrantConsumed: true,
        publicUrlIssued: false,
        recipientDeliveryReceiptsRecorded: recipientReceipts.count,
      },
    });

    return {
      bytes,
      fileName: this.fileName(grant.run.reportFilename, runId),
      contentType: grant.run.artifactContentType || "text/csv; charset=utf-8",
    };
  }

  private tokenHash(token: string) {
    return createHash("sha256").update(token, "utf8").digest("hex");
  }

  private grantToken(raw: unknown) {
    if (
      typeof raw !== "string" ||
      !/^[A-Za-z0-9_-]{40,100}$/.test(raw)
    ) {
      throw new BadRequestException(
        "Transport report download grant is invalid or expired.",
      );
    }
    return raw;
  }

  private id(raw: string, field: string) {
    const value = raw.trim();
    if (!/^[A-Za-z0-9_.:-]{1,180}$/.test(value)) {
      throw new BadRequestException(field + " is invalid.");
    }
    return value;
  }

  private fileName(value: string | null, runId: string) {
    const fallback = "carepoint-transport-report-" + runId + ".csv";
    const candidate = (value || fallback)
      .replace(/[\r\n"\\/<>:*?\u0000-\u001F]/g, "_")
      .trim()
      .slice(0, 180);
    return candidate || "carepoint-transport-report.csv";
  }
}

@Controller("admin/transport")
@RequirePermissions("TRANSPORT_OPERATE")
class TransportReportDownloadController {
  constructor(private readonly service: TransportReportDownloadService) {}

  @Post("report-runs/:runId/download-grant")
  issueGrant(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("runId") runId: string,
  ) {
    return this.service.issueGrant(principal, runId);
  }

  @Post("report-runs/:runId/download")
  @Header("Cache-Control", "private, no-store, max-age=0")
  @Header("Pragma", "no-cache")
  @Header("X-Content-Type-Options", "nosniff")
  async download(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("runId") runId: string,
    @Body() body: DownloadInput,
  ) {
    const content = await this.service.consume(principal, runId, body ?? {});
    return new StreamableFile(content.bytes, {
      type: content.contentType,
      disposition: 'attachment; filename="' + content.fileName + '"',
    });
  }
}

@Module({
  controllers: [TransportReportDownloadController],
  providers: [
    TransportReportDownloadService,
    TransportReportArtifactStorageService,
  ],
})
export class TransportReportDownloadModule {}
