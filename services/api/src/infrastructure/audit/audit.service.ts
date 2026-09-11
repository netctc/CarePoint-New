import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.module";
import { SiemAuditOutboxStoreService } from "../siem/siem-audit-outbox-store.service";
import { SiemOutboxWorkerService } from "../siem/siem-outbox-worker.service";

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

  // Allows domain state, immutable audit and SIEM enqueue to commit atomically.
  // The existing durable SIEM worker polls committed deliveries; never wake it
  // before the caller's transaction has committed.
  async writeInTransaction(tx: Prisma.TransactionClient, input: AuditWrite): Promise<void> {
    const event = await tx.auditEvent.create({ data: {
      actorId: input.actorId ?? null, action: input.action, objectType: input.objectType,
      objectId: input.objectId ?? null, purpose: input.purpose ?? null, result: input.result,
      metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
    } });
    if (this.siemExportEnabled()) await this.siemOutbox.enqueueInTransaction(tx, event.id);
  }
  async write(input: AuditWrite): Promise<void> {
    await this.prisma.$transaction((tx) => this.writeInTransaction(tx, input));
    if (this.siemExportEnabled()) this.siemWorker.wake();
  }
  async list(limit = 100) {
    return this.prisma.auditEvent.findMany({ orderBy: { occurredAt: "desc" }, take: Math.max(1, Math.min(limit, 500)) });
  }
  private siemExportEnabled(): boolean {
    return process.env.NODE_ENV === "production" || process.env.SIEM_EXPORT_ENABLED?.trim().toLowerCase() === "true";
  }
}
