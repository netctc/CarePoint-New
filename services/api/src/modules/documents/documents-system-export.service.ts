import { ConflictException, Injectable } from "@nestjs/common";
import { Prisma, type DiagnosticReport } from "@prisma/client";
import type { EncryptedEnvelope } from "@carepoint/security";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { DocumentsAttestationService } from "./documents-attestation.service";
import { DocumentsEnvelopeService } from "./documents-envelope.service";

type DiagnosticType = "IMAGING" | "PATHOLOGY" | "OTHER";
type JsonObject = Record<string, unknown>;

export interface DiagnosticSystemExportView {
  id: string;
  patientId: string;
  providerId: string;
  encounterRef: string;
  documentId: string | null;
  type: string;
  status: "RELEASED";
  finalizedAt: Date | null;
  releasedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  data: JsonObject;
}

@Injectable()
export class DocumentsSystemExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
    private readonly envelope: DocumentsEnvelopeService,
    private readonly attestation: DocumentsAttestationService,
  ) {}

  async releasedDiagnosticReports(args: {
    since: Date | null;
    transactionTime: Date;
    maxResources: number;
    actorId: string;
    clientId: string;
  }): Promise<DiagnosticSystemExportView[]> {
    const { since, transactionTime, maxResources, actorId, clientId } = args;
    if (!Number.isInteger(maxResources) || maxResources < 1) throw new ConflictException("Diagnostic bulk export resource limit is invalid.");
    const reports = await this.prisma.$transaction((tx) => tx.diagnosticReport.findMany({
      where: {
        status: "RELEASED",
        updatedAt: { ...(since ? { gt: since } : {}), lte: transactionTime },
      },
      orderBy: { id: "asc" },
      take: maxResources + 1,
    }), { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    if (reports.length > maxResources) {
      throw new ConflictException(`FHIR bulk export for DiagnosticReport exceeded the current safety limit of ${maxResources} resources.`);
    }
    const result: DiagnosticSystemExportView[] = [];
    for (const report of reports) result.push(await this.presentReleasedReport(report));
    await this.audit.write({
      actorId,
      action: "DIAGNOSTIC_REPORT_SYSTEM_EXPORT_SNAPSHOT",
      objectType: "SMART_CLIENT",
      objectId: clientId,
      purpose: "SYSTEM_ACCESS",
      result: "SUCCESS",
      metadata: {
        count: result.length,
        since: since?.toISOString() ?? null,
        transactionTime: transactionTime.toISOString(),
        releaseGate: "RELEASED_ONLY",
      },
    });
    return result;
  }

  private async presentReleasedReport(report: DiagnosticReport): Promise<DiagnosticSystemExportView> {
    if (report.status !== "RELEASED") throw new ConflictException("Diagnostic bulk export release gate failed.");
    await this.assertReportIntegrity(report);
    const data = await this.envelope.decryptMetadata<JsonObject>(this.reportEnvelope(report));
    return {
      id: report.id,
      patientId: report.patientId,
      providerId: report.providerId,
      encounterRef: report.encounterRef,
      documentId: report.documentId,
      type: report.type,
      status: "RELEASED",
      finalizedAt: report.finalizedAt,
      releasedAt: report.releasedAt,
      createdAt: report.createdAt,
      updatedAt: report.updatedAt,
      data,
    };
  }

  private async assertReportIntegrity(report: DiagnosticReport): Promise<void> {
    if (!report.signature || !report.signatureAlgorithm || !report.signatureKeyId) {
      throw new ConflictException("Final diagnostic report attestation is incomplete.");
    }
    const envelope = this.reportEnvelope(report);
    const material = this.reportMaterial(report.type as DiagnosticType, report.patientId, report.providerId, report.encounterRef, report.documentId, envelope);
    const verified = await this.attestation.verify(material, report.signature, report.signatureKeyId, report.signatureAlgorithm);
    if (this.attestation.digest(material) !== report.payloadDigest || !verified) {
      throw new ConflictException("Diagnostic report attestation verification failed.");
    }
  }

  private reportEnvelope(report: DiagnosticReport): EncryptedEnvelope {
    if (report.algorithm !== "AES-256-GCM") throw new ConflictException("Unsupported diagnostic report encryption algorithm.");
    return {
      version: 1,
      algorithm: "AES-256-GCM",
      keyId: report.keyId,
      wrappedKey: report.wrappedKey,
      iv: report.iv,
      ciphertext: report.ciphertext,
    };
  }

  private reportMaterial(
    type: DiagnosticType,
    patientId: string,
    providerId: string,
    encounterRef: string,
    documentId: string | null,
    envelope: EncryptedEnvelope,
  ): string {
    return JSON.stringify({ schemaVersion: 1, type, patientId, providerId, encounterRef, documentId, envelope });
  }
}
