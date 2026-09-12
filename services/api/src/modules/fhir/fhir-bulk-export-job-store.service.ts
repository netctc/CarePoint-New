import { Injectable } from "@nestjs/common";
import { Prisma, type FhirBulkExportJobState } from "@prisma/client";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { RedisSecurityService } from "../../infrastructure/redis/redis-security.module";

const MAX_REDIS_COMPAT_TTL_SECONDS = 31 * 24 * 60 * 60;

export interface DurableBulkJobRecord {
  id: string;
  clientId: string;
  status: string;
  payload: unknown;
  availableAt: Date;
  leaseOwner: string | null;
  leaseUntil: Date | null;
  purgeAt: Date;
  attemptCount: number;
  lastError: string | null;
}

@Injectable()
export class FhirBulkExportJobStoreService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisSecurityService,
  ) {}

  async save(input: {
    jobId: string;
    clientId: string;
    status: string;
    payload: unknown;
    ttlSeconds: number;
    availableAt?: Date;
    lastError?: string | null;
  }): Promise<void> {
    const now = new Date();
    const payload = this.jsonPayload(input.payload);
    const payloadExpiresAt = this.payloadDate(input.payload, "expiresAt");
    const purgeAt = payloadExpiresAt && payloadExpiresAt.getTime() > now.getTime()
      ? payloadExpiresAt
      : new Date(now.getTime() + input.ttlSeconds * 1000);
    const availableAt = input.availableAt ?? now;
    await this.prisma.fhirBulkExportJobState.upsert({
      where: { id: input.jobId },
      create: {
        id: input.jobId,
        clientId: input.clientId,
        status: input.status,
        payload,
        availableAt,
        purgeAt,
        lastError: input.lastError ?? this.payloadString(input.payload, "error"),
      },
      update: {
        clientId: input.clientId,
        status: input.status,
        payload,
        availableAt,
        purgeAt,
        lastError: input.lastError ?? this.payloadString(input.payload, "error"),
        ...(input.status === "COMPLETED" || input.status === "FAILED"
          ? { leaseOwner: null, leaseUntil: null }
          : {}),
      },
    });
    if (this.redisCompatWrite()) {
      await this.redis.setEphemeral(this.legacyKey(input.jobId), JSON.stringify(input.payload), this.redisTtl(purgeAt));
    }
  }

  async get(jobId: string): Promise<DurableBulkJobRecord | null> {
    const row = await this.prisma.fhirBulkExportJobState.findUnique({ where: { id: jobId } });
    if (row) return this.map(row);

    const legacy = await this.redis.getEphemeral(this.legacyKey(jobId));
    if (!legacy) return null;
    const payload = this.parseLegacy(legacy);
    const clientId = this.payloadString(payload, "clientId");
    const status = this.payloadString(payload, "status");
    if (!clientId || !status) return null;
    await this.save({ jobId, clientId, status, payload, ttlSeconds: 2 * 60 * 60 });
    return this.get(jobId);
  }

  async syncFromLegacy(jobId: string, ttlSeconds: number): Promise<DurableBulkJobRecord | null> {
    const legacy = await this.redis.getEphemeral(this.legacyKey(jobId));
    if (!legacy) return this.get(jobId);
    const payload = this.parseLegacy(legacy);
    const clientId = this.payloadString(payload, "clientId");
    const status = this.payloadString(payload, "status");
    if (!clientId || !status) return this.get(jobId);
    await this.save({ jobId, clientId, status, payload, ttlSeconds });
    return this.get(jobId);
  }

  async restoreLegacy(record: DurableBulkJobRecord): Promise<boolean> {
    if (record.purgeAt.getTime() <= Date.now()) return false;
    const existing = await this.redis.getEphemeral(this.legacyKey(record.id));
    if (existing) return true;
    await this.redis.setEphemeral(this.legacyKey(record.id), JSON.stringify(record.payload), this.redisTtl(record.purgeAt));
    return true;
  }

  async remove(jobId: string): Promise<void> {
    await this.prisma.fhirBulkExportJobState.deleteMany({ where: { id: jobId } });
    await this.redis.deleteEphemeral(this.legacyKey(jobId)).catch(() => undefined);
  }

  async claim(jobId: string, owner: string, leaseSeconds: number): Promise<DurableBulkJobRecord | null> {
    const now = new Date();
    const leaseUntil = new Date(now.getTime() + leaseSeconds * 1000);
    const claimed = await this.prisma.fhirBulkExportJobState.updateMany({
      where: {
        id: jobId,
        status: { in: ["QUEUED", "RUNNING"] },
        availableAt: { lte: now },
        purgeAt: { gt: now },
        OR: [
          { leaseUntil: null },
          { leaseUntil: { lt: now } },
          { leaseOwner: owner },
        ],
      },
      data: {
        leaseOwner: owner,
        leaseUntil,
        attemptCount: { increment: 1 },
      },
    });
    if (claimed.count !== 1) return null;
    const row = await this.prisma.fhirBulkExportJobState.findUnique({ where: { id: jobId } });
    return row ? this.map(row) : null;
  }

  async releaseLease(jobId: string, owner: string, availableAt = new Date(), lastError?: string | null): Promise<void> {
    await this.prisma.fhirBulkExportJobState.updateMany({
      where: { id: jobId, leaseOwner: owner },
      data: {
        leaseOwner: null,
        leaseUntil: null,
        availableAt,
        ...(lastError !== undefined ? { lastError } : {}),
      },
    });
  }

  async recoverable(limit: number): Promise<DurableBulkJobRecord[]> {
    const now = new Date();
    const rows = await this.prisma.fhirBulkExportJobState.findMany({
      where: {
        status: { in: ["QUEUED", "RUNNING"] },
        availableAt: { lte: now },
        purgeAt: { gt: now },
        OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }],
      },
      orderBy: [{ availableAt: "asc" }, { createdAt: "asc" }],
      take: limit,
    });
    return rows.map((row) => this.map(row));
  }

  async retryableFailures(limit: number, maxAttempts: number): Promise<DurableBulkJobRecord[]> {
    const now = new Date();
    const rows = await this.prisma.fhirBulkExportJobState.findMany({
      where: {
        status: "FAILED",
        lastError: "FHIR bulk export processing failed.",
        attemptCount: { lt: maxAttempts },
        availableAt: { lte: now },
        purgeAt: { gt: now },
      },
      orderBy: [{ updatedAt: "asc" }],
      take: limit,
    });
    return rows.map((row) => this.map(row));
  }

  async requeue(record: DurableBulkJobRecord, availableAt: Date): Promise<void> {
    const payload = this.objectPayload(record.payload);
    const nextPayload = {
      ...payload,
      status: "QUEUED",
      completedAt: null,
      artifacts: [],
      error: null,
    };
    await this.prisma.fhirBulkExportJobState.update({
      where: { id: record.id },
      data: {
        status: "QUEUED",
        payload: this.jsonPayload(nextPayload),
        availableAt,
        leaseOwner: null,
        leaseUntil: null,
        lastError: null,
      },
    });
    await this.redis.deleteEphemeral(this.legacyKey(record.id)).catch(() => undefined);
  }

  async expired(limit: number): Promise<DurableBulkJobRecord[]> {
    const rows = await this.prisma.fhirBulkExportJobState.findMany({
      where: { purgeAt: { lte: new Date() } },
      orderBy: { purgeAt: "asc" },
      take: limit,
    });
    return rows.map((row) => this.map(row));
  }

  private map(row: FhirBulkExportJobState): DurableBulkJobRecord {
    return {
      id: row.id,
      clientId: row.clientId,
      status: row.status,
      payload: row.payload,
      availableAt: row.availableAt,
      leaseOwner: row.leaseOwner,
      leaseUntil: row.leaseUntil,
      purgeAt: row.purgeAt,
      attemptCount: row.attemptCount,
      lastError: row.lastError,
    };
  }

  private parseLegacy(raw: string): unknown {
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return null;
    }
  }

  private objectPayload(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  }

  private payloadString(value: unknown, key: string): string | null {
    const payload = this.objectPayload(value);
    return typeof payload[key] === "string" ? payload[key] as string : null;
  }

  private payloadDate(value: unknown, key: string): Date | null {
    const raw = this.payloadString(value, key);
    if (!raw) return null;
    const date = new Date(raw);
    return Number.isFinite(date.getTime()) ? date : null;
  }

  private jsonPayload(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }

  private redisTtl(purgeAt: Date): number {
    return Math.max(1, Math.min(MAX_REDIS_COMPAT_TTL_SECONDS, Math.ceil((purgeAt.getTime() - Date.now()) / 1000)));
  }

  private redisCompatWrite(): boolean {
    return process.env.BULK_EXPORT_REDIS_COMPAT_WRITE !== "false";
  }

  private legacyKey(jobId: string): string {
    return `carepoint:fhir:bulk-export:${jobId}`;
  }
}
