import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { isolatedSyntheticPrivatePilotActive } from "../release/private-pilot-infrastructure-profile";
import { PrismaService } from "../prisma/prisma.module";
import { SiemAuditOutboxStoreService } from "../siem/siem-audit-outbox-store.service";
import { SiemOutboxWorkerService } from "../siem/siem-outbox-worker.service";
import { sanitizeClinicalAuditMetadata } from "./clinical-audit-metadata";
import { auditChainHash, auditPayloadHash } from "./audit-integrity";

export type AuditResult = "SUCCESS" | "DENIED" | "FAILED";
export interface AuditWrite {
  actorId?: string | null;
  action: string;
  objectType: string;
  objectId?: string | null;
  purpose?: string | null;
  result: AuditResult;
  metadata?: Record<string, unknown>;
}
@Injectable()
export class DatabaseAuditService {
  constructor(private readonly prisma: PrismaService, private readonly siemOutbox: SiemAuditOutboxStoreService, private readonly siemWorker: SiemOutboxWorkerService) {}

  // Domain state, immutable audit, integrity chain and SIEM enqueue share the caller's commit.
  // The advisory transaction lock serializes only the short integrity-chain append,
  // preventing two concurrent events from claiming the same predecessor.
  async writeInTransaction(tx: Prisma.TransactionClient, input: AuditWrite): Promise<void> {
    const event = await tx.auditEvent.create({ data: {
      actorId: input.actorId ?? null, action: input.action, objectType: input.objectType,
      objectId: input.objectId ?? null, purpose: input.purpose ?? null, result: input.result,
      metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
    } });
    await this.appendIntegrityRecord(tx, event);
    if (this.siemExportEnabled()) await this.siemOutbox.enqueueInTransaction(tx, event.id);
  }
  async writeClinicalInTransaction(tx: Prisma.TransactionClient, input: AuditWrite): Promise<void> {
    await this.writeInTransaction(tx, {
      ...input,
      metadata: sanitizeClinicalAuditMetadata(input.metadata),
    });
  }

  async writeClinical(input: AuditWrite): Promise<void> {
    await this.write({
      ...input,
      metadata: sanitizeClinicalAuditMetadata(input.metadata),
    });
  }

  async write(input: AuditWrite): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await this.writeInTransaction(tx, input);
    });
    if (this.siemExportEnabled()) this.siemWorker.wake();
  }
  async list(limit = 100) {
    return this.prisma.auditEvent.findMany({ orderBy: { occurredAt: "desc" }, take: Math.max(1, Math.min(limit, 500)) });
  }

  private async appendIntegrityRecord(tx: Prisma.TransactionClient, event: {
    id: string;
    actorId: string | null;
    action: string;
    objectType: string;
    objectId: string | null;
    purpose: string | null;
    result: string;
    metadata: Prisma.JsonValue | null;
    occurredAt: Date;
  }): Promise<void> {
    // pg_advisory_xact_lock() returns PostgreSQL void. Use executeRaw so Prisma
    // never attempts to deserialize the void result as a query row.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(8411, 51001)`;
    const previous = await tx.auditIntegrityRecord.findFirst({ orderBy: { sequence: "desc" } });
    const payloadHash = auditPayloadHash(event);
    const previousHash = previous?.eventHash ?? null;
    const eventHash = auditChainHash(previousHash, payloadHash);
    await tx.auditIntegrityRecord.create({
      data: {
        auditEventId: event.id,
        payloadHash,
        previousHash,
        eventHash,
      },
    });
  }

  private siemExportEnabled(): boolean {
    if (isolatedSyntheticPrivatePilotActive(process.env)) return false;
    return process.env.NODE_ENV === "production" || process.env.SIEM_EXPORT_ENABLED?.trim().toLowerCase() === "true";
  }
}
