import { Injectable } from "@nestjs/common";
import { Prisma, type SiemAuditDelivery } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.module";

export type SiemAuditTransaction = Prisma.TransactionClient;

export type DurableSiemAuditWorkItem = SiemAuditDelivery & {
  auditEvent: {
    id: string;
    actorId: string | null;
    action: string;
    objectType: string;
    objectId: string | null;
    purpose: string | null;
    result: string;
    metadata: Prisma.JsonValue | null;
    occurredAt: Date;
  };
};

@Injectable()
export class SiemAuditOutboxStoreService {
  constructor(private readonly prisma: PrismaService) {}

  async enqueueInTransaction(tx: SiemAuditTransaction, auditEventId: string): Promise<void> {
    await tx.siemAuditDelivery.create({ data: { auditEventId } });
  }

  async recoverable(limit: number): Promise<Array<{ id: string }>> {
    const now = new Date();
    return this.prisma.siemAuditDelivery.findMany({
      where: {
        status: "PENDING",
        availableAt: { lte: now },
        OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }],
      },
      orderBy: [{ availableAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      take: Math.max(1, Math.min(limit, 200)),
      select: { id: true },
    });
  }

  async claim(id: string, workerId: string, leaseSeconds: number): Promise<DurableSiemAuditWorkItem | null> {
    const now = new Date();
    const leaseUntil = new Date(now.getTime() + leaseSeconds * 1000);
    const claimed = await this.prisma.siemAuditDelivery.updateMany({
      where: {
        id,
        status: "PENDING",
        availableAt: { lte: now },
        OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }],
      },
      data: {
        leaseOwner: workerId,
        leaseUntil,
        attemptCount: { increment: 1 },
        errorCode: null,
      },
    });
    if (claimed.count !== 1) return null;
    return this.prisma.siemAuditDelivery.findUnique({
      where: { id },
      include: {
        auditEvent: {
          select: {
            id: true,
            actorId: true,
            action: true,
            objectType: true,
            objectId: true,
            purpose: true,
            result: true,
            metadata: true,
            occurredAt: true,
          },
        },
      },
    });
  }

  async actorRole(actorId: string | null): Promise<string | null> {
    if (!actorId) return null;
    const account = await this.prisma.user.findUnique({ where: { id: actorId }, select: { role: true } });
    return account?.role ?? null;
  }

  async markExported(id: string, workerId: string): Promise<boolean> {
    const updated = await this.prisma.siemAuditDelivery.updateMany({
      where: { id, status: "PENDING", leaseOwner: workerId },
      data: {
        status: "SENT",
        exportedAt: new Date(),
        leaseOwner: null,
        leaseUntil: null,
        errorCode: null,
      },
    });
    return updated.count === 1;
  }

  async requeue(id: string, workerId: string, availableAt: Date, errorCode: string): Promise<boolean> {
    const updated = await this.prisma.siemAuditDelivery.updateMany({
      where: { id, status: "PENDING", leaseOwner: workerId },
      data: {
        availableAt,
        leaseOwner: null,
        leaseUntil: null,
        errorCode,
      },
    });
    return updated.count === 1;
  }

  async markFailed(id: string, workerId: string, errorCode: string): Promise<boolean> {
    const updated = await this.prisma.siemAuditDelivery.updateMany({
      where: { id, status: "PENDING", leaseOwner: workerId },
      data: {
        status: "FAILED",
        leaseOwner: null,
        leaseUntil: null,
        errorCode,
      },
    });
    return updated.count === 1;
  }
}
