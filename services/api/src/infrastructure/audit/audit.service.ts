import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.module";

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
  constructor(private readonly prisma: PrismaService) {}

  async write(input: AuditWrite): Promise<void> {
    await this.prisma.auditEvent.create({
      data: {
        actorId: input.actorId ?? null,
        action: input.action,
        objectType: input.objectType,
        objectId: input.objectId ?? null,
        purpose: input.purpose ?? null,
        result: input.result,
        metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
      },
    });
  }

  async list(limit = 100) {
    return this.prisma.auditEvent.findMany({
      orderBy: { occurredAt: "desc" },
      take: Math.max(1, Math.min(limit, 500)),
    });
  }
}
