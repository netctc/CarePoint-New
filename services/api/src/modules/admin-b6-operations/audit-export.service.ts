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
import { Prisma } from "@prisma/client";
import type { AuthPrincipal } from "@carepoint/identity";
import type { EncryptedEnvelope } from "@carepoint/security";
import { createHash, randomBytes } from "node:crypto";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { DocumentStorageService } from "../documents/document-storage.service";
import { DocumentsEnvelopeService } from "../documents/documents-envelope.service";

const EXPORT_TTL_MS = 24 * 60 * 60 * 1000;
const DOWNLOAD_TTL_MS = 5 * 60 * 1000;
const POLL_MS = 2_000;
const STALE_MS = 10 * 60 * 1000;
const MAX_EVENTS = 10_000;

export interface CreateAuditExportInput {
  from?: string;
  to?: string;
  action?: string;
  objectType?: string;
  result?: string;
}

type AuditFilter = {
  from: string | null;
  to: string | null;
  action: string | null;
  objectType: string | null;
  result: string | null;
};

@Injectable()
export class AuditExportService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
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

  async create(principal: AuthPrincipal, input: CreateAuditExportInput) {
    const filter = this.filter(input ?? {});
    const filterDigest = this.sha256(JSON.stringify(filter));
    const job = await this.prisma.auditExportJob.create({
      data: {
        accountId: principal.accountId,
        filter: filter as Prisma.InputJsonValue,
        filterDigest,
        expiresAt: new Date(Date.now() + EXPORT_TTL_MS),
      },
    });
    await this.audit.write({
      actorId: principal.accountId,
      action: "AUDIT_EXPORT_REQUESTED",
      objectType: "AUDIT_EXPORT_JOB",
      objectId: job.id,
      purpose: "COMPLIANCE_EXPORT",
      result: "SUCCESS",
      metadata: { filterDigest, expiresAt: job.expiresAt },
    });
    void this.runOnce();
    return this.present(job);
  }

  async list(principal: AuthPrincipal, limitInput?: string) {
    const rows = await this.prisma.auditExportJob.findMany({
      where: { accountId: principal.accountId },
      orderBy: { createdAt: "desc" },
      take: this.limit(limitInput),
    });
    return { items: rows.map((row) => this.present(row)) };
  }

  async get(principal: AuthPrincipal, jobId: string) {
    const job = await this.mine(principal, jobId);
    await this.expireIfNeeded(job);
    return this.present(await this.mine(principal, jobId));
  }

  async issueDownloadGrant(principal: AuthPrincipal, jobId: string) {
    const job = await this.mine(principal, jobId);
    await this.expireIfNeeded(job);
    const current = await this.mine(principal, jobId);
    if (current.status !== "READY" || !current.objectKey) throw new ConflictException("Audit export is not ready.");
    if (current.expiresAt.getTime() <= Date.now()) throw new GoneException("Audit export has expired.");

    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Math.min(current.expiresAt.getTime(), Date.now() + DOWNLOAD_TTL_MS));
    await this.prisma.auditExportDownloadGrant.create({
      data: {
        exportJobId: current.id,
        accountId: principal.accountId,
        tokenHash: this.sha256(token),
        expiresAt,
      },
    });
    await this.audit.write({
      actorId: principal.accountId,
      action: "AUDIT_EXPORT_DOWNLOAD_GRANTED",
      objectType: "AUDIT_EXPORT_JOB",
      objectId: current.id,
      purpose: "COMPLIANCE_EXPORT",
      result: "SUCCESS",
      metadata: { expiresAt, contentDigest: current.contentDigest },
    });
    return {
      jobId: current.id,
      expiresAt,
      signedUrl: "/api/v1/admin/audit-exports/" + current.id + "/download?token=" + encodeURIComponent(token),
    };
  }

  async download(principal: AuthPrincipal, jobId: string, tokenInput: unknown) {
    const token = this.token(tokenInput);
    const tokenHash = this.sha256(token);
    const job = await this.mine(principal, jobId);
    await this.expireIfNeeded(job);
    const current = await this.mine(principal, jobId);
    if (
      current.status !== "READY"
      || !current.objectKey
      || !current.algorithm
      || !current.keyId
      || !current.wrappedKey
      || !current.iv
      || !current.contentDigest
      || current.byteLength === null
    ) throw new ConflictException("Audit export is not downloadable.");

    const grant = await this.prisma.auditExportDownloadGrant.findUnique({ where: { tokenHash } });
    if (!grant || grant.exportJobId !== current.id || grant.accountId !== principal.accountId) {
      throw new ForbiddenException("Audit export download grant is invalid.");
    }
    if (grant.consumedAt || grant.expiresAt.getTime() <= Date.now()) {
      throw new GoneException("Audit export download grant expired or was consumed.");
    }

    const ciphertext = await this.storage.get(current.objectKey);
    const bytes = await this.envelope.decryptBytes(this.asEnvelope(current, ciphertext));
    if (bytes.byteLength !== current.byteLength || this.sha256(bytes) !== current.contentDigest) {
      throw new ConflictException("Audit export artifact integrity validation failed.");
    }

    const consumed = await this.prisma.auditExportDownloadGrant.updateMany({
      where: { id: grant.id, consumedAt: null, expiresAt: { gt: new Date() } },
      data: { consumedAt: new Date() },
    });
    if (consumed.count !== 1) throw new GoneException("Audit export download grant was already consumed.");

    await this.audit.write({
      actorId: principal.accountId,
      action: "AUDIT_EXPORT_DOWNLOADED",
      objectType: "AUDIT_EXPORT_JOB",
      objectId: current.id,
      purpose: "COMPLIANCE_EXPORT",
      result: "SUCCESS",
      metadata: {
        contentDigest: current.contentDigest,
        byteLength: current.byteLength,
        storageProvider: this.storage.storageProviderName(),
      },
    });
    return {
      bytes,
      mediaType: "application/x-ndjson",
      fileName: "carepoint-audit-export-" + current.id + ".ndjson",
    };
  }

  async runOnce(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.cleanupExpired();
      const staleBefore = new Date(Date.now() - STALE_MS);
      const candidates = await this.prisma.auditExportJob.findMany({
        where: {
          expiresAt: { gt: new Date() },
          OR: [{ status: "PENDING" }, { status: "PROCESSING", startedAt: { lt: staleBefore } }],
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

  private async process(jobId: string) {
    const now = new Date();
    const claimed = await this.prisma.auditExportJob.updateMany({
      where: {
        id: jobId,
        expiresAt: { gt: now },
        OR: [{ status: "PENDING" }, { status: "PROCESSING", startedAt: { lt: new Date(now.getTime() - STALE_MS) } }],
      },
      data: { status: "PROCESSING", startedAt: now, errorCode: null },
    });
    if (claimed.count !== 1) return;
    const job = await this.prisma.auditExportJob.findUnique({ where: { id: jobId } });
    if (!job) return;

    try {
      const filter = this.readFilter(job.filter);
      const events = await this.prisma.auditEvent.findMany({
        where: {
          ...(filter.from || filter.to ? {
            occurredAt: {
              ...(filter.from ? { gte: new Date(filter.from) } : {}),
              ...(filter.to ? { lte: new Date(filter.to) } : {}),
            },
          } : {}),
          ...(filter.action ? { action: filter.action } : {}),
          ...(filter.objectType ? { objectType: filter.objectType } : {}),
          ...(filter.result ? { result: filter.result } : {}),
        },
        orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
        take: MAX_EVENTS,
      });
      const manifest = {
        type: "manifest",
        schemaVersion: 1,
        exportId: job.id,
        filterDigest: job.filterDigest,
        generatedAt: new Date().toISOString(),
        eventCount: events.length,
        truncated: events.length === MAX_EVENTS,
      };
      const lines = [
        JSON.stringify(manifest),
        ...events.map((event) => JSON.stringify({ type: "auditEvent", ...event })),
      ];
      const bytes = Buffer.from(lines.join("\n") + "\n", "utf8");
      const contentDigest = this.sha256(bytes);
      const encrypted = await this.envelope.encryptBytes(bytes);
      const objectKey = "audit-exports/" + job.accountId + "/" + job.id + ".ndjson.enc";
      await this.storage.put(objectKey, encrypted.ciphertext);
      await this.prisma.auditExportJob.update({
        where: { id: job.id },
        data: {
          status: "READY",
          objectKey,
          mediaType: "application/x-ndjson",
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
      await this.audit.write({
        actorId: job.accountId,
        action: "AUDIT_EXPORT_READY",
        objectType: "AUDIT_EXPORT_JOB",
        objectId: job.id,
        purpose: "COMPLIANCE_EXPORT",
        result: "SUCCESS",
        metadata: {
          eventCount: events.length,
          truncated: events.length === MAX_EVENTS,
          contentDigest,
          byteLength: bytes.byteLength,
          storageProvider: this.storage.storageProviderName(),
        },
      });
    } catch (error) {
      const errorCode = error instanceof Error ? error.constructor.name.slice(0, 80) : "AuditExportError";
      await this.prisma.auditExportJob.updateMany({
        where: { id: job.id, status: "PROCESSING" },
        data: { status: "FAILED", errorCode, completedAt: new Date() },
      });
      await this.audit.write({
        actorId: job.accountId,
        action: "AUDIT_EXPORT_FAILED",
        objectType: "AUDIT_EXPORT_JOB",
        objectId: job.id,
        purpose: "COMPLIANCE_EXPORT",
        result: "FAILED",
        metadata: { errorCode },
      }).catch(() => undefined);
    }
  }

  private async cleanupExpired() {
    const rows = await this.prisma.auditExportJob.findMany({
      where: { status: "READY", expiresAt: { lte: new Date() }, cleanedAt: null },
      select: { id: true, objectKey: true, accountId: true },
      take: 25,
    });
    for (const row of rows) {
      if (row.objectKey) await this.storage.remove(row.objectKey).catch(() => undefined);
      await this.prisma.auditExportJob.updateMany({
        where: { id: row.id, cleanedAt: null },
        data: { status: "EXPIRED", cleanedAt: new Date(), objectKey: null },
      });
      await this.audit.write({
        actorId: row.accountId,
        action: "AUDIT_EXPORT_EXPIRED",
        objectType: "AUDIT_EXPORT_JOB",
        objectId: row.id,
        purpose: "SYSTEM_ACCESS",
        result: "SUCCESS",
      }).catch(() => undefined);
    }
  }

  private async expireIfNeeded(job: { id: string; status: string; expiresAt: Date; objectKey: string | null }) {
    if (job.status === "EXPIRED" || job.expiresAt.getTime() > Date.now()) return;
    if (job.objectKey) await this.storage.remove(job.objectKey).catch(() => undefined);
    await this.prisma.auditExportJob.updateMany({
      where: { id: job.id, status: { not: "EXPIRED" } },
      data: { status: "EXPIRED", cleanedAt: new Date(), objectKey: null },
    });
  }

  private async mine(principal: AuthPrincipal, jobIdInput: unknown) {
    const jobId = this.identifier(jobIdInput, "jobId");
    const job = await this.prisma.auditExportJob.findFirst({
      where: { id: jobId, accountId: principal.accountId },
    });
    if (!job) throw new NotFoundException("Audit export job not found.");
    return job;
  }

  private filter(input: CreateAuditExportInput): AuditFilter {
    const from = this.optionalDate(input.from, "from");
    const to = this.optionalDate(input.to, "to");
    if (from && to && new Date(from).getTime() > new Date(to).getTime()) {
      throw new BadRequestException("from must not be after to.");
    }
    return {
      from,
      to,
      action: this.optionalCode(input.action, "action"),
      objectType: this.optionalCode(input.objectType, "objectType"),
      result: this.optionalCode(input.result, "result"),
    };
  }

  private readFilter(value: Prisma.JsonValue): AuditFilter {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new ConflictException("Audit export filter is invalid.");
    const row = value as Record<string, Prisma.JsonValue>;
    return {
      from: typeof row.from === "string" ? row.from : null,
      to: typeof row.to === "string" ? row.to : null,
      action: typeof row.action === "string" ? row.action : null,
      objectType: typeof row.objectType === "string" ? row.objectType : null,
      result: typeof row.result === "string" ? row.result : null,
    };
  }

  private optionalDate(value: unknown, field: string): string | null {
    if (value === undefined || value === null || value === "") return null;
    if (typeof value !== "string") throw new BadRequestException(field + " must be an ISO date-time.");
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) throw new BadRequestException(field + " must be an ISO date-time.");
    return date.toISOString();
  }

  private optionalCode(value: unknown, field: string): string | null {
    if (value === undefined || value === null || value === "") return null;
    if (typeof value !== "string") throw new BadRequestException(field + " is invalid.");
    const normalized = value.trim().toUpperCase();
    if (!/^[A-Z0-9_.:-]{1,120}$/.test(normalized)) throw new BadRequestException(field + " is invalid.");
    return normalized;
  }

  private identifier(value: unknown, field: string): string {
    if (typeof value !== "string" || !/^[A-Za-z0-9_.:-]{1,180}$/.test(value.trim())) {
      throw new BadRequestException(field + " is invalid.");
    }
    return value.trim();
  }

  private token(value: unknown): string {
    if (typeof value !== "string" || !/^[A-Za-z0-9_-]{40,100}$/.test(value.trim())) {
      throw new ForbiddenException("Audit export token is invalid.");
    }
    return value.trim();
  }

  private limit(raw?: string): number {
    if (!raw) return 50;
    if (!/^\d{1,3}$/.test(raw.trim())) throw new BadRequestException("limit is invalid.");
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < 1 || value > 100) throw new BadRequestException("limit must be between 1 and 100.");
    return value;
  }

  private present(job: {
    id: string;
    status: string;
    filter: Prisma.JsonValue;
    filterDigest: string;
    mediaType: string | null;
    byteLength: number | null;
    contentDigest: string | null;
    errorCode: string | null;
    expiresAt: Date;
    createdAt: Date;
    completedAt: Date | null;
  }) {
    return {
      id: job.id,
      status: job.status,
      filter: job.filter,
      filterDigest: job.filterDigest,
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

  private sha256(value: string | Uint8Array): string {
    return createHash("sha256").update(value).digest("hex");
  }

  private asEnvelope(job: { algorithm: string; keyId: string; wrappedKey: string; iv: string }, ciphertext: string): EncryptedEnvelope {
    if (job.algorithm !== "AES-256-GCM") throw new ConflictException("Unsupported audit export envelope algorithm.");
    return {
      version: 1,
      algorithm: "AES-256-GCM",
      keyId: job.keyId,
      wrappedKey: job.wrappedKey,
      iv: job.iv,
      ciphertext,
    };
  }
}
