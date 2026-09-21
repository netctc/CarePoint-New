import { BadRequestException, Injectable } from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { Prisma } from "@prisma/client";
import { auditChainHash, auditPayloadHash } from "../../infrastructure/audit/audit-integrity";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";

interface RetentionUpdateInput {
  mode: "INDEFINITE" | "MINIMUM_DAYS";
  minimumRetentionDays?: number | null;
  legalHoldEnabled?: boolean;
}

@Injectable()
export class AuditIntegrityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
  ) {}

  async status(principal: AuthPrincipal, rawLimit?: string) {
    const limit = this.limit(rawLimit);
    const [policy, recentDescending] = await Promise.all([
      this.policy(),
      this.prisma.auditIntegrityRecord.findMany({ orderBy: { sequence: "desc" }, take: limit }),
    ]);
    const records = recentDescending.reverse();
    const firstRecord = records[0] ?? null;
    const ids = records.map((row) => row.auditEventId);
    const events = ids.length === 0
      ? []
      : await this.prisma.auditEvent.findMany({ where: { id: { in: ids } } });
    const eventById = new Map(events.map((event) => [event.id, event]));
    const predecessor = firstRecord === null
      ? null
      : await this.prisma.auditIntegrityRecord.findFirst({
          where: { sequence: { lt: firstRecord.sequence } },
          orderBy: { sequence: "desc" },
        });

    let payloadMismatchCount = 0;
    let chainMismatchCount = 0;
    let missingEventCount = 0;
    let expectedPreviousHash = predecessor?.eventHash ?? null;

    for (const record of records) {
      if (record.previousHash !== expectedPreviousHash) chainMismatchCount += 1;
      const event = eventById.get(record.auditEventId);
      if (!event) {
        missingEventCount += 1;
      } else {
        const payloadHash = auditPayloadHash(event);
        if (payloadHash !== record.payloadHash) payloadMismatchCount += 1;
        const expectedEventHash = auditChainHash(record.previousHash, record.payloadHash);
        if (expectedEventHash !== record.eventHash) chainMismatchCount += 1;
      }
      expectedPreviousHash = record.eventHash;
    }

    const coverage = await this.coverageCounts(policy.createdAt);
    const healthy = payloadMismatchCount === 0
      && chainMismatchCount === 0
      && missingEventCount === 0
      && coverage.missingProtectedCount === 0;

    const result = {
      healthy,
      checkedRecords: records.length,
      requestedLimit: limit,
      payloadMismatchCount,
      chainMismatchCount,
      missingEventCount,
      missingProtectedCount: coverage.missingProtectedCount,
      historicalUnchainedCount: coverage.historicalUnchainedCount,
      firstCheckedSequence: firstRecord?.sequence.toString() ?? null,
      lastCheckedSequence: records.at(-1)?.sequence.toString() ?? null,
      integrityCoverageStartedAt: policy.createdAt.toISOString(),
      appendOnlyEnforced: true,
    };

    await this.audit.write({
      actorId: principal.accountId,
      action: "AUDIT_INTEGRITY_STATUS_READ",
      objectType: "AUDIT_INTEGRITY",
      objectId: "default",
      purpose: "AUDIT_MONITORING",
      result: healthy ? "SUCCESS" : "FAILED",
      metadata: {
        checkedRecords: result.checkedRecords,
        payloadMismatchCount,
        chainMismatchCount,
        missingEventCount,
        missingProtectedCount: coverage.missingProtectedCount,
      },
    });
    return result;
  }

  async retention(principal: AuthPrincipal) {
    const [policy, eventCount, oldest, newest] = await Promise.all([
      this.policy(),
      this.prisma.auditEvent.count(),
      this.prisma.auditEvent.findFirst({ orderBy: { occurredAt: "asc" }, select: { occurredAt: true } }),
      this.prisma.auditEvent.findFirst({ orderBy: { occurredAt: "desc" }, select: { occurredAt: true } }),
    ]);
    const result = {
      mode: policy.mode,
      minimumRetentionDays: policy.minimumRetentionDays,
      legalHoldEnabled: policy.legalHoldEnabled,
      eventCount,
      oldestEventAt: oldest?.occurredAt.toISOString() ?? null,
      newestEventAt: newest?.occurredAt.toISOString() ?? null,
      physicalDeletionEnabled: false,
      enforcement: "DATABASE_APPEND_ONLY",
      updatedAt: policy.updatedAt.toISOString(),
    };
    await this.audit.write({
      actorId: principal.accountId,
      action: "AUDIT_RETENTION_STATUS_READ",
      objectType: "AUDIT_RETENTION_POLICY",
      objectId: policy.id,
      purpose: "AUDIT_GOVERNANCE",
      result: "SUCCESS",
      metadata: { mode: policy.mode, legalHoldEnabled: policy.legalHoldEnabled },
    });
    return result;
  }

  async updateRetention(principal: AuthPrincipal, input: RetentionUpdateInput) {
    const normalized = this.retentionInput(input);
    const policy = await this.prisma.auditRetentionPolicy.update({
      where: { id: "default" },
      data: normalized,
    });
    await this.audit.write({
      actorId: principal.accountId,
      action: "AUDIT_RETENTION_POLICY_UPDATED",
      objectType: "AUDIT_RETENTION_POLICY",
      objectId: policy.id,
      purpose: "AUDIT_GOVERNANCE",
      result: "SUCCESS",
      metadata: {
        mode: policy.mode,
        minimumRetentionDays: policy.minimumRetentionDays,
        legalHoldEnabled: policy.legalHoldEnabled,
      },
    });
    return {
      mode: policy.mode,
      minimumRetentionDays: policy.minimumRetentionDays,
      legalHoldEnabled: policy.legalHoldEnabled,
      physicalDeletionEnabled: false,
      updatedAt: policy.updatedAt.toISOString(),
    };
  }

  private async policy() {
    return this.prisma.auditRetentionPolicy.upsert({
      where: { id: "default" },
      create: { id: "default", mode: "INDEFINITE", minimumRetentionDays: null, legalHoldEnabled: false },
      update: {},
    });
  }

  private async coverageCounts(coverageStartAt: Date) {
    const rows = await this.prisma.$queryRaw<Array<{
      missingProtectedCount: bigint;
      historicalUnchainedCount: bigint;
    }>>(Prisma.sql`
      SELECT
        COUNT(*) FILTER (
          WHERE integrity."auditEventId" IS NULL AND event."occurredAt" >= ${coverageStartAt}
        )::bigint AS "missingProtectedCount",
        COUNT(*) FILTER (
          WHERE integrity."auditEventId" IS NULL AND event."occurredAt" < ${coverageStartAt}
        )::bigint AS "historicalUnchainedCount"
      FROM "AuditEvent" event
      LEFT JOIN "AuditIntegrityRecord" integrity ON integrity."auditEventId" = event."id"
    `);
    return {
      missingProtectedCount: Number(rows[0]?.missingProtectedCount ?? 0n),
      historicalUnchainedCount: Number(rows[0]?.historicalUnchainedCount ?? 0n),
    };
  }

  private limit(value?: string): number {
    if (!value) return 500;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 5000) {
      throw new BadRequestException("limit must be an integer between 1 and 5000.");
    }
    return parsed;
  }

  private retentionInput(input: RetentionUpdateInput) {
    if (!input || (input.mode !== "INDEFINITE" && input.mode !== "MINIMUM_DAYS")) {
      throw new BadRequestException("mode must be INDEFINITE or MINIMUM_DAYS.");
    }
    if (input.legalHoldEnabled !== undefined && typeof input.legalHoldEnabled !== "boolean") {
      throw new BadRequestException("legalHoldEnabled must be boolean.");
    }
    if (input.mode === "INDEFINITE") {
      return {
        mode: "INDEFINITE" as const,
        minimumRetentionDays: null,
        legalHoldEnabled: input.legalHoldEnabled ?? false,
      };
    }
    if (!Number.isInteger(input.minimumRetentionDays)
      || Number(input.minimumRetentionDays) < 30
      || Number(input.minimumRetentionDays) > 36500) {
      throw new BadRequestException("minimumRetentionDays must be an integer between 30 and 36500.");
    }
    return {
      mode: "MINIMUM_DAYS" as const,
      minimumRetentionDays: Number(input.minimumRetentionDays),
      legalHoldEnabled: input.legalHoldEnabled ?? false,
    };
  }
}
