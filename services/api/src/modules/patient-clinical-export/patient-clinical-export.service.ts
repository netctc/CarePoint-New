import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import type { EncryptedEnvelope } from "@carepoint/security";
import { createHash, randomBytes } from "node:crypto";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { PatientContextService } from "../dependents/dependents.service";
import { DocumentStorageService } from "../documents/document-storage.service";
import { DocumentsEnvelopeService } from "../documents/documents-envelope.service";
import { PatientHealthSummaryService } from "../patient-health-summary/patient-health-summary.service";

export interface CreatePatientClinicalExportInput {
  format?: string;
  clientRequestId?: string;
}

const ARTIFACT_TTL_MS = 24 * 60 * 60 * 1000;
const DOWNLOAD_GRANT_TTL_MS = 5 * 60 * 1000;
const POLL_MS = 2_000;
const STALE_PROCESSING_MS = 10 * 60 * 1000;
const EXPORT_SCOPE = "PATIENT_CLINICAL_PORTABILITY";

@Injectable()
export class PatientClinicalExportService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
    private readonly contexts: PatientContextService,
    private readonly summary: PatientHealthSummaryService,
    private readonly storage: DocumentStorageService,
    private readonly envelope: DocumentsEnvelopeService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.runOnce(), POLL_MS);
    this.timer.unref?.();
    void this.runOnce();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async create(principal: AuthPrincipal, input: CreatePatientClinicalExportInput) {
    this.assertPatient(principal);
    const format = this.format(input?.format);
    const clientRequestId = this.identifier(input?.clientRequestId, "clientRequestId");
    const context = await this.contexts.resolveEffectivePatient(principal, "CLINICAL_READ");
    const requestDigest = this.sha256(JSON.stringify({
      patientId: context.patientId,
      format,
      scope: EXPORT_SCOPE,
    }));
    const existing = await this.prisma.patientClinicalExportJob.findUnique({
      where: { accountId_clientRequestId: { accountId: principal.accountId, clientRequestId } },
    });
    if (existing) {
      if (existing.requestDigest !== requestDigest) {
        throw new ConflictException("clientRequestId was already used for a different export request.");
      }
      return this.present(existing);
    }

    const job = await this.prisma.patientClinicalExportJob.create({
      data: {
        patientId: context.patientId,
        accountId: principal.accountId,
        sessionId: principal.sessionId,
        format,
        scope: EXPORT_SCOPE,
        clientRequestId,
        requestDigest,
        expiresAt: new Date(Date.now() + ARTIFACT_TTL_MS),
      },
    });
    await this.audit.writeClinical({
      actorId: principal.accountId,
      action: "PATIENT_CLINICAL_EXPORT_REQUESTED",
      objectType: "PATIENT_CLINICAL_EXPORT",
      objectId: job.id,
      purpose: context.mode === "DEPENDENT" ? "PROXY_PATIENT_ACCESS" : "PATIENT_ACCESS",
      result: "SUCCESS",
      metadata: {
        patientId: context.patientId,
        format,
        scope: EXPORT_SCOPE,
        contextMode: context.mode,
        decision: "ALLOW",
      },
    });
    void this.runOnce();
    return this.present(job);
  }

  async get(principal: AuthPrincipal, jobId: string) {
    this.assertPatient(principal);
    const job = await this.mine(principal, jobId);
    await this.expireIfNeeded(job);
    const refreshed = await this.mine(principal, jobId);
    return this.present(refreshed);
  }

  async issueDownloadGrant(principal: AuthPrincipal, jobId: string) {
    this.assertPatient(principal);
    const job = await this.mine(principal, jobId);
    await this.expireIfNeeded(job);
    const current = await this.mine(principal, jobId);
    if (current.status !== "READY" || !current.objectKey) {
      throw new ConflictException("Clinical export is not ready for download.");
    }
    const now = Date.now();
    if (current.expiresAt.getTime() <= now) throw new GoneException("Clinical export has expired.");
    const token = randomBytes(32).toString("base64url");
    const tokenHash = this.sha256(token);
    const expiresAt = new Date(Math.min(current.expiresAt.getTime(), now + DOWNLOAD_GRANT_TTL_MS));
    await this.prisma.patientClinicalExportDownloadGrant.create({
      data: {
        exportJobId: current.id,
        accountId: principal.accountId,
        tokenHash,
        expiresAt,
      },
    });
    await this.audit.writeClinical({
      actorId: principal.accountId,
      action: "PATIENT_CLINICAL_EXPORT_DOWNLOAD_GRANTED",
      objectType: "PATIENT_CLINICAL_EXPORT",
      objectId: current.id,
      purpose: "PATIENT_ACCESS",
      result: "SUCCESS",
      metadata: { patientId: current.patientId, format: current.format, expiresAt, decision: "ALLOW" },
    });
    return {
      jobId: current.id,
      expiresAt,
      signedUrl: `/api/v1/patient/exports/${current.id}/download?token=${encodeURIComponent(token)}`,
    };
  }

  async download(principal: AuthPrincipal, jobId: string, tokenInput: unknown) {
    this.assertPatient(principal);
    const token = this.token(tokenInput);
    const tokenHash = this.sha256(token);
    const job = await this.mine(principal, jobId);
    await this.expireIfNeeded(job);
    const current = await this.mine(principal, jobId);
    if (current.status !== "READY" || !current.objectKey || !current.algorithm || !current.keyId || !current.wrappedKey || !current.iv || !current.contentDigest || current.byteLength === null) {
      throw new ConflictException("Clinical export is not downloadable.");
    }
    const grant = await this.prisma.patientClinicalExportDownloadGrant.findUnique({ where: { tokenHash } });
    if (!grant || grant.exportJobId !== current.id || grant.accountId !== principal.accountId) {
      throw new ForbiddenException("Clinical export download grant is invalid.");
    }
    if (grant.consumedAt || grant.expiresAt.getTime() <= Date.now()) {
      throw new GoneException("Clinical export download grant has expired or was already used.");
    }

    const ciphertext = await this.storage.get(current.objectKey);
    const bytes = await this.envelope.decryptBytes(this.asEnvelope(current, ciphertext));
    const digest = this.sha256(bytes);
    if (digest !== current.contentDigest || bytes.byteLength !== current.byteLength) {
      throw new ConflictException("Clinical export artifact integrity validation failed.");
    }
    const consumed = await this.prisma.patientClinicalExportDownloadGrant.updateMany({
      where: { id: grant.id, consumedAt: null, expiresAt: { gt: new Date() } },
      data: { consumedAt: new Date() },
    });
    if (consumed.count !== 1) throw new GoneException("Clinical export download grant was already used.");

    await this.audit.writeClinical({
      actorId: principal.accountId,
      action: "PATIENT_CLINICAL_EXPORT_DOWNLOADED",
      objectType: "PATIENT_CLINICAL_EXPORT",
      objectId: current.id,
      purpose: "PATIENT_ACCESS",
      result: "SUCCESS",
      metadata: {
        patientId: current.patientId,
        format: current.format,
        byteLength: current.byteLength,
        contentDigest: current.contentDigest,
        decision: "ALLOW",
      },
    });
    return {
      bytes,
      mediaType: current.mediaType ?? (current.format === "PDF" ? "application/pdf" : "application/json"),
      fileName: `carepoint-clinical-export-${current.id}.${current.format.toLowerCase()}`,
    };
  }

  async runOnce(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.cleanupExpired();
      const staleBefore = new Date(Date.now() - STALE_PROCESSING_MS);
      const candidates = await this.prisma.patientClinicalExportJob.findMany({
        where: {
          OR: [
            { status: "PENDING" },
            { status: "PROCESSING", startedAt: { lt: staleBefore } },
          ],
          expiresAt: { gt: new Date() },
        },
        select: { id: true },
        orderBy: { createdAt: "asc" },
        take: 5,
      });
      for (const candidate of candidates) await this.process(candidate.id);
    } finally {
      this.running = false;
    }
  }

  private async process(jobId: string): Promise<void> {
    const now = new Date();
    const claimed = await this.prisma.patientClinicalExportJob.updateMany({
      where: {
        id: jobId,
        expiresAt: { gt: now },
        OR: [
          { status: "PENDING" },
          { status: "PROCESSING", startedAt: { lt: new Date(now.getTime() - STALE_PROCESSING_MS) } },
        ],
      },
      data: { status: "PROCESSING", startedAt: now, errorCode: null },
    });
    if (claimed.count !== 1) return;
    const job = await this.prisma.patientClinicalExportJob.findUnique({ where: { id: jobId } });
    if (!job) return;
    try {
      const principal: AuthPrincipal = { accountId: job.accountId, role: "PATIENT", sessionId: job.sessionId };
      const snapshot = await this.summary.get(principal);
      if (snapshot.patientId !== job.patientId) {
        throw new ConflictException("Patient context changed while clinical export was queued.");
      }
      const packageValue = {
        schemaVersion: 1,
        exportId: job.id,
        scope: job.scope,
        generatedAt: new Date().toISOString(),
        patientId: job.patientId,
        healthSummary: snapshot,
      };
      const bytes = job.format === "PDF"
        ? this.renderPdf(packageValue)
        : Buffer.from(JSON.stringify(packageValue, null, 2), "utf8");
      const contentDigest = this.sha256(bytes);
      const encrypted = await this.envelope.encryptBytes(bytes);
      const objectKey = `patient-exports/${job.patientId}/${job.id}.${job.format.toLowerCase()}.enc`;
      await this.storage.put(objectKey, encrypted.ciphertext);
      await this.prisma.patientClinicalExportJob.update({
        where: { id: job.id },
        data: {
          status: "READY",
          objectKey,
          mediaType: job.format === "PDF" ? "application/pdf" : "application/json",
          byteLength: bytes.byteLength,
          contentDigest,
          algorithm: encrypted.envelope.algorithm,
          keyId: encrypted.envelope.keyId,
          wrappedKey: encrypted.envelope.wrappedKey,
          iv: encrypted.envelope.iv,
          completedAt: new Date(),
          errorCode: null,
        },
      });
      await this.audit.writeClinical({
        actorId: job.accountId,
        action: "PATIENT_CLINICAL_EXPORT_READY",
        objectType: "PATIENT_CLINICAL_EXPORT",
        objectId: job.id,
        purpose: "PATIENT_ACCESS",
        result: "SUCCESS",
        metadata: {
          patientId: job.patientId,
          format: job.format,
          scope: job.scope,
          byteLength: bytes.byteLength,
          contentDigest,
          storageProvider: this.storage.storageProviderName(),
          decision: "ALLOW",
        },
      });
    } catch (error) {
      const errorCode = error instanceof Error ? error.constructor.name.slice(0, 80) : "ExportGenerationError";
      await this.prisma.patientClinicalExportJob.updateMany({
        where: { id: job.id, status: "PROCESSING" },
        data: { status: "FAILED", errorCode, completedAt: new Date() },
      });
      await this.audit.writeClinical({
        actorId: job.accountId,
        action: "PATIENT_CLINICAL_EXPORT_FAILED",
        objectType: "PATIENT_CLINICAL_EXPORT",
        objectId: job.id,
        purpose: "PATIENT_ACCESS",
        result: "FAILED",
        metadata: { patientId: job.patientId, format: job.format, errorCode, decision: "DENY" },
      }).catch(() => undefined);
    }
  }

  private async cleanupExpired(): Promise<void> {
    const rows = await this.prisma.patientClinicalExportJob.findMany({
      where: { status: "READY", expiresAt: { lte: new Date() }, cleanedAt: null },
      select: { id: true, objectKey: true, accountId: true, patientId: true },
      take: 25,
    });
    for (const row of rows) {
      if (row.objectKey) await this.storage.remove(row.objectKey).catch(() => undefined);
      await this.prisma.patientClinicalExportJob.updateMany({
        where: { id: row.id, cleanedAt: null },
        data: { status: "EXPIRED", cleanedAt: new Date(), objectKey: null },
      });
      await this.audit.writeClinical({
        actorId: row.accountId,
        action: "PATIENT_CLINICAL_EXPORT_EXPIRED",
        objectType: "PATIENT_CLINICAL_EXPORT",
        objectId: row.id,
        purpose: "SYSTEM_ACCESS",
        result: "SUCCESS",
        metadata: { patientId: row.patientId, decision: "ALLOW" },
      }).catch(() => undefined);
    }
  }

  private async expireIfNeeded(job: { id: string; status: string; expiresAt: Date; objectKey: string | null }): Promise<void> {
    if (job.expiresAt.getTime() > Date.now() || job.status === "EXPIRED") return;
    if (job.objectKey) await this.storage.remove(job.objectKey).catch(() => undefined);
    await this.prisma.patientClinicalExportJob.updateMany({
      where: { id: job.id, status: { not: "EXPIRED" } },
      data: { status: "EXPIRED", cleanedAt: new Date(), objectKey: null },
    });
  }

  private async mine(principal: AuthPrincipal, jobIdInput: string) {
    const jobId = this.identifier(jobIdInput, "jobId");
    const job = await this.prisma.patientClinicalExportJob.findFirst({
      where: { id: jobId, accountId: principal.accountId },
    });
    if (!job) throw new NotFoundException("Clinical export job not found.");
    return job;
  }

  private present(job: any) {
    return {
      id: job.id,
      format: job.format,
      scope: job.scope,
      status: job.status,
      expiresAt: job.expiresAt,
      createdAt: job.createdAt,
      completedAt: job.completedAt,
      ...(job.status === "READY" ? {
        mediaType: job.mediaType,
        byteLength: job.byteLength,
        contentDigest: job.contentDigest,
      } : {}),
      ...(job.status === "FAILED" ? { errorCode: job.errorCode } : {}),
    };
  }

  private assertPatient(principal: AuthPrincipal): void {
    if (principal.role !== "PATIENT") throw new ForbiddenException("Patient clinical exports require PATIENT role.");
  }

  private format(value: unknown): "JSON" | "PDF" {
    const normalized = typeof value === "string" ? value.trim().toUpperCase() : "JSON";
    if (normalized !== "JSON" && normalized !== "PDF") throw new BadRequestException("format must be JSON or PDF.");
    return normalized;
  }

  private identifier(value: unknown, field: string): string {
    if (typeof value !== "string" || !/^[A-Za-z0-9_.:-]{1,180}$/.test(value.trim())) {
      throw new BadRequestException(`${field} is required and must be a safe identifier.`);
    }
    return value.trim();
  }

  private token(value: unknown): string {
    if (typeof value !== "string" || !/^[A-Za-z0-9_-]{40,100}$/.test(value.trim())) {
      throw new ForbiddenException("Clinical export download token is invalid.");
    }
    return value.trim();
  }

  private sha256(value: string | Uint8Array): string {
    return createHash("sha256").update(value).digest("hex");
  }

  private asEnvelope(job: { algorithm: string; keyId: string; wrappedKey: string; iv: string }, ciphertext: string): EncryptedEnvelope {
    if (job.algorithm !== "AES-256-GCM") throw new ConflictException("Unsupported export envelope algorithm.");
    return {
      version: 1,
      algorithm: "AES-256-GCM",
      keyId: job.keyId,
      wrappedKey: job.wrappedKey,
      iv: job.iv,
      ciphertext,
    };
  }

  private renderPdf(value: unknown): Buffer {
    const source = JSON.stringify(value, null, 2);
    const lines: string[] = ["CarePoint Clinical Export", "", ...source.split("\n")]
      .flatMap((line) => this.wrap(line, 92))
      .slice(0, 3000);
    const pages: string[][] = [];
    for (let index = 0; index < lines.length; index += 54) pages.push(lines.slice(index, index + 54));
    const objects: string[] = [];
    const fontObject = 3 + pages.length * 2;
    const kids: number[] = [];
    pages.forEach((pageLines, index) => {
      const pageObject = 3 + index * 2;
      const contentObject = pageObject + 1;
      kids.push(pageObject);
      const stream = `BT /F1 9 Tf 42 800 Td 13 TL ${pageLines.map((line) => `(${this.pdfEscape(line)}) Tj T*`).join(" ")} ET`;
      objects[pageObject] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontObject} 0 R >> >> /Contents ${contentObject} 0 R >>`;
      objects[contentObject] = `<< /Length ${Buffer.byteLength(stream, "utf8")} >>\nstream\n${stream}\nendstream`;
    });
    objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
    objects[2] = `<< /Type /Pages /Kids [${kids.map((id) => `${id} 0 R`).join(" ")}] /Count ${kids.length} >>`;
    objects[fontObject] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
    let pdf = "%PDF-1.4\n";
    const offsets: number[] = [0];
    for (let id = 1; id <= fontObject; id += 1) {
      offsets[id] = Buffer.byteLength(pdf, "utf8");
      pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`;
    }
    const xref = Buffer.byteLength(pdf, "utf8");
    pdf += `xref\n0 ${fontObject + 1}\n0000000000 65535 f \n`;
    for (let id = 1; id <= fontObject; id += 1) pdf += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
    pdf += `trailer\n<< /Size ${fontObject + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return Buffer.from(pdf, "utf8");
  }

  private wrap(line: string, max: number): string[] {
    if (line.length <= max) return [line];
    const parts: string[] = [];
    for (let index = 0; index < line.length; index += max) parts.push(line.slice(index, index + max));
    return parts;
  }

  private pdfEscape(value: string): string {
    return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)").replace(/[^\x20-\x7E]/g, "?");
  }
}
