import { BadRequestException, Injectable } from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { createHash } from "node:crypto";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";

@Injectable()
export class PatientClinicalExportAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
  ) {}

  async list(principal: AuthPrincipal, statusInput?: string, limitInput?: string) {
    const status = this.status(statusInput);
    const limit = this.limit(limitInput);
    const rows = await this.prisma.patientClinicalExportJob.findMany({
      ...(status ? { where: { status } } : {}),
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit,
    });

    await this.audit.writeClinical({
      actorId: principal.accountId,
      action: "ADMIN_PATIENT_EXPORT_JOBS_READ",
      objectType: "PATIENT_CLINICAL_EXPORT",
      objectId: "EXPORT_JOB_INDEX",
      purpose: "DATA_GOVERNANCE",
      result: "SUCCESS",
      metadata: { itemCount: rows.length, status: status ?? "ALL", limit },
    });

    return {
      items: rows.map((row) => ({
        id: row.id,
        requesterAccountId: row.accountId,
        patientReference: this.patientReference(row.patientId),
        format: row.format,
        scope: row.scope,
        status: row.status,
        expiresAt: row.expiresAt,
        createdAt: row.createdAt,
        startedAt: row.startedAt,
        completedAt: row.completedAt,
        cleanedAt: row.cleanedAt,
        ...(row.status === "READY" ? { byteLength: row.byteLength, mediaType: row.mediaType } : {}),
        ...(row.status === "FAILED" ? { errorCode: row.errorCode } : {}),
      })),
      privacyBoundary: {
        clinicalPayloadReturned: false,
        downloadCapabilityReturned: false,
        rawPatientIdReturned: false,
      },
    };
  }

  private patientReference(patientId: string): string {
    return `patient:${createHash("sha256").update(patientId, "utf8").digest("hex").slice(0, 16)}`;
  }

  private status(value?: string): "PENDING" | "PROCESSING" | "READY" | "FAILED" | "EXPIRED" | undefined {
    if (!value) return undefined;
    const normalized = value.trim().toUpperCase();
    if (!["PENDING", "PROCESSING", "READY", "FAILED", "EXPIRED"].includes(normalized)) {
      throw new BadRequestException("status is invalid.");
    }
    return normalized as "PENDING" | "PROCESSING" | "READY" | "FAILED" | "EXPIRED";
  }

  private limit(value?: string): number {
    if (!value) return 100;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 200) {
      throw new BadRequestException("limit must be an integer between 1 and 200.");
    }
    return parsed;
  }
}
