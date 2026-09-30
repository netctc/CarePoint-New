import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { AuthPrincipal } from "@carepoint/identity";
import { createHash } from "node:crypto";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";

type Candidate = {
  sourceEntityType: string;
  sourceEntityId: string;
  relatedEntityId?: string | null;
  evidence: Record<string, unknown>;
};

export interface DataQualityIssueQuery {
  status?: string;
  ruleCode?: string;
  limit?: string | number;
}

export interface DataQualityIssueActionInput {
  expectedVersion: number;
  status: "ACKNOWLEDGED" | "RESOLVED" | "DISMISSED";
  reasonCode: string;
}

const MAX_ISSUES_PER_RULE = 500;
const ISSUE_STATUSES = ["OPEN", "ACKNOWLEDGED", "RESOLVED", "DISMISSED"] as const;

@Injectable()
export class DataQualityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
  ) {}

  async listRules() {
    return this.prisma.dataQualityRule.findMany({
      orderBy: [{ category: "asc" }, { code: "asc" }],
      include: {
        versions: { orderBy: { version: "desc" }, take: 1 },
      },
    });
  }

  async listRuns(limitInput: string | number | undefined) {
    const limit = this.limit(limitInput, 100);
    return this.prisma.dataQualityRun.findMany({
      orderBy: { startedAt: "desc" },
      take: limit,
    });
  }

  async listIssues(query: DataQualityIssueQuery) {
    const status = query.status?.trim().toUpperCase();
    if (status && !ISSUE_STATUSES.includes(status as (typeof ISSUE_STATUSES)[number])) {
      throw new BadRequestException("status is invalid.");
    }
    const ruleCode = query.ruleCode?.trim().toUpperCase();
    if (ruleCode && !/^[A-Z0-9_]{3,120}$/.test(ruleCode)) throw new BadRequestException("ruleCode is invalid.");
    const limit = this.limit(query.limit, 200);
    return this.prisma.dataQualityIssue.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(ruleCode ? { rule: { code: ruleCode } } : {}),
      },
      include: {
        rule: { select: { code: true, category: true } },
        actions: { orderBy: { createdAt: "desc" }, take: 10 },
      },
      orderBy: [{ lastDetectedAt: "desc" }, { id: "asc" }],
      take: limit,
    });
  }

  async run(principal: AuthPrincipal, triggerType: "MANUAL" | "SCHEDULED" = "MANUAL") {
    const run = await this.prisma.dataQualityRun.create({
      data: {
        triggeredByActorId: principal.accountId,
        triggerType,
        status: "RUNNING",
      },
    });
    try {
      const rules = await this.prisma.dataQualityRule.findMany({
        where: { active: true },
        orderBy: { code: "asc" },
      });
      let issueCount = 0;
      let errorCount = 0;
      for (const rule of rules) {
        const version = await this.prisma.dataQualityRuleVersion.findUnique({
          where: { ruleId_version: { ruleId: rule.id, version: rule.currentVersion } },
        });
        if (!version) {
          errorCount += 1;
          continue;
        }
        try {
          const candidates = await this.evaluate(rule.code);
          for (const candidate of candidates.slice(0, MAX_ISSUES_PER_RULE)) {
            await this.recordIssue({
              runId: run.id,
              ruleId: rule.id,
              ruleCode: rule.code,
              ruleVersion: version.version,
              severity: version.severity,
              candidate,
            });
            issueCount += 1;
          }
        } catch {
          errorCount += 1;
        }
      }
      const completed = await this.prisma.dataQualityRun.update({
        where: { id: run.id },
        data: {
          status: errorCount > 0 ? "FAILED" : "COMPLETED",
          ruleCount: rules.length,
          issueCount,
          errorCount,
          completedAt: new Date(),
        },
      });
      await this.audit.write({
        actorId: principal.accountId,
        action: "DATA_QUALITY_RUN_COMPLETED",
        objectType: "DATA_QUALITY_RUN",
        objectId: completed.id,
        purpose: "SYSTEM_ACCESS",
        result: errorCount > 0 ? "FAILED" : "SUCCESS",
        metadata: {
          triggerType,
          ruleCount: completed.ruleCount,
          issueCount: completed.issueCount,
          errorCount: completed.errorCount,
        },
      });
      return completed;
    } catch (error) {
      await this.prisma.dataQualityRun.update({
        where: { id: run.id },
        data: { status: "FAILED", errorCount: 1, completedAt: new Date() },
      }).catch(() => undefined);
      throw error;
    }
  }

  async act(principal: AuthPrincipal, issueIdInput: string, input: DataQualityIssueActionInput) {
    const issueId = this.identifier(issueIdInput, "issueId");
    const expectedVersion = this.positiveInteger(input?.expectedVersion, "expectedVersion");
    const status = input?.status;
    if (!status || !["ACKNOWLEDGED", "RESOLVED", "DISMISSED"].includes(status)) {
      throw new BadRequestException("status must be ACKNOWLEDGED, RESOLVED or DISMISSED.");
    }
    const reasonCode = this.reasonCode(input?.reasonCode);

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "DataQualityIssue" WHERE id = ${issueId} FOR UPDATE`);
      const issue = await tx.dataQualityIssue.findUnique({ where: { id: issueId } });
      if (!issue) throw new NotFoundException("Data quality issue not found.");
      if (issue.version !== expectedVersion) {
        throw new ConflictException({ message: "Data quality issue version conflict.", currentVersion: issue.version });
      }
      if (issue.status === "RESOLVED" || issue.status === "DISMISSED") {
        throw new ConflictException("Terminal data quality issues cannot be manually changed; a reproducible re-detection may reopen them.");
      }
      const updated = await tx.dataQualityIssue.update({
        where: { id: issue.id },
        data: {
          status,
          version: { increment: 1 },
          resolvedAt: status === "RESOLVED" || status === "DISMISSED" ? new Date() : null,
        },
      });
      await tx.dataQualityIssueAction.create({
        data: {
          issueId: issue.id,
          fromStatus: issue.status,
          toStatus: status,
          reasonCode,
          actorId: principal.accountId,
        },
      });
      await this.audit.writeInTransaction(tx, {
        actorId: principal.accountId,
        action: "DATA_QUALITY_ISSUE_STATUS_CHANGED",
        objectType: "DATA_QUALITY_ISSUE",
        objectId: issue.id,
        purpose: "SYSTEM_ACCESS",
        result: "SUCCESS",
        metadata: {
          ruleId: issue.ruleId,
          fromStatus: issue.status,
          toStatus: status,
          reasonCode,
          sourceEntityType: issue.sourceEntityType,
        },
      });
      return updated;
    });
    return result;
  }

  private async evaluate(ruleCode: string): Promise<Candidate[]> {
    if (ruleCode === "HOSPITALIZATION_INVALID_INTERVAL") return this.hospitalizationIntervals();
    if (ruleCode === "OBSERVATION_UNIT_CONFIGURATION") return this.observationUnitConfiguration();
    if (ruleCode === "SYMPTOM_REPORT_LOGICAL_DUPLICATE") return this.symptomReportDuplicates();
    if (ruleCode === "CLINICAL_PROFILE_PROVIDER_PROVENANCE") return this.providerProvenance();
    throw new Error(`Unsupported data quality rule '${ruleCode}'.`);
  }

  private async hospitalizationIntervals(): Promise<Candidate[]> {
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id
      FROM "Hospitalization"
      WHERE "dischargedOn" IS NOT NULL
        AND "dischargedOn" < "admittedOn"
      ORDER BY id
      LIMIT ${MAX_ISSUES_PER_RULE}
    `);
    return rows.map((row) => ({
      sourceEntityType: "HOSPITALIZATION",
      sourceEntityId: row.id,
      evidence: { check: "DISCHARGE_BEFORE_ADMISSION" },
    }));
  }

  private async observationUnitConfiguration(): Promise<Candidate[]> {
    const [versions, units] = await Promise.all([
      this.prisma.observationTypeVersion.findMany({
        where: { status: "ACTIVE" },
        select: { id: true, canonicalUnitCode: true, allowedUnitCodes: true },
        take: MAX_ISSUES_PER_RULE,
      }),
      this.prisma.measurementUnit.findMany({
        where: { active: true },
        select: { code: true },
      }),
    ]);
    const known = new Set(units.map((row) => row.code));
    const candidates: Candidate[] = [];
    for (const version of versions) {
      const allowed = this.jsonStringArray(version.allowedUnitCodes);
      const missing = [...new Set([version.canonicalUnitCode, ...allowed].filter((code) => !known.has(code)))].sort();
      if (missing.length === 0) continue;
      candidates.push({
        sourceEntityType: "OBSERVATION_TYPE_VERSION",
        sourceEntityId: version.id,
        evidence: {
          check: "UNKNOWN_ACTIVE_UNIT_DEFINITION",
          canonicalUnitCode: version.canonicalUnitCode,
          missingUnitCodes: missing,
          allowedUnitCount: allowed.length,
        },
      });
    }
    return candidates;
  }

  private async symptomReportDuplicates(): Promise<Candidate[]> {
    const rows = await this.prisma.$queryRaw<Array<{ id: string; canonicalId: string }>>(Prisma.sql`
      WITH ranked AS (
        SELECT
          id,
          FIRST_VALUE(id) OVER (
            PARTITION BY "patientId", "requestDigest"
            ORDER BY "createdAt" ASC, id ASC
          ) AS "canonicalId",
          ROW_NUMBER() OVER (
            PARTITION BY "patientId", "requestDigest"
            ORDER BY "createdAt" ASC, id ASC
          ) AS rn
        FROM "SymptomReport"
      )
      SELECT id, "canonicalId"
      FROM ranked
      WHERE rn > 1
      ORDER BY id
      LIMIT ${MAX_ISSUES_PER_RULE}
    `);
    return rows.map((row) => ({
      sourceEntityType: "SYMPTOM_REPORT",
      sourceEntityId: row.id,
      relatedEntityId: row.canonicalId,
      evidence: { check: "DUPLICATE_REQUEST_DIGEST", duplicateOfId: row.canonicalId },
    }));
  }

  private async providerProvenance(): Promise<Candidate[]> {
    const rows = await this.prisma.clinicalProfileEntry.findMany({
      where: {
        OR: [
          { sourceType: "PROVIDER", sourceActorId: null },
          {
            verificationStatus: { in: ["PROVIDER_VERIFIED", "PROVIDER_REJECTED"] },
            OR: [{ verifiedByActorId: null }, { verifiedAt: null }],
          },
        ],
      },
      select: {
        id: true,
        sourceType: true,
        sourceActorId: true,
        verificationStatus: true,
        verifiedByActorId: true,
        verifiedAt: true,
      },
      orderBy: { id: "asc" },
      take: MAX_ISSUES_PER_RULE,
    });
    return rows.map((row) => {
      const missingFields: string[] = [];
      if (row.sourceType === "PROVIDER" && !row.sourceActorId) missingFields.push("sourceActorId");
      if (["PROVIDER_VERIFIED", "PROVIDER_REJECTED"].includes(row.verificationStatus)) {
        if (!row.verifiedByActorId) missingFields.push("verifiedByActorId");
        if (!row.verifiedAt) missingFields.push("verifiedAt");
      }
      return {
        sourceEntityType: "CLINICAL_PROFILE_ENTRY",
        sourceEntityId: row.id,
        evidence: {
          check: "PROVIDER_PROVENANCE_INCOMPLETE",
          verificationStatus: row.verificationStatus,
          missingFields: missingFields.sort(),
        },
      };
    });
  }

  private async recordIssue(input: {
    runId: string;
    ruleId: string;
    ruleCode: string;
    ruleVersion: number;
    severity: string;
    candidate: Candidate;
  }): Promise<void> {
    const evidence = input.candidate.evidence;
    const fingerprint = createHash("sha256").update([
      input.ruleCode,
      String(input.ruleVersion),
      input.candidate.sourceEntityType,
      input.candidate.sourceEntityId,
      input.candidate.relatedEntityId ?? "",
      this.stableJson(evidence),
    ].join("|")).digest("hex");
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.dataQualityIssue.findUnique({ where: { fingerprint } });
      if (!existing) {
        await tx.dataQualityIssue.create({
          data: {
            fingerprint,
            ruleId: input.ruleId,
            ruleVersion: input.ruleVersion,
            runId: input.runId,
            sourceEntityType: input.candidate.sourceEntityType,
            sourceEntityId: input.candidate.sourceEntityId,
            relatedEntityId: input.candidate.relatedEntityId ?? null,
            severity: input.severity,
            evidence: evidence as Prisma.InputJsonValue,
            firstDetectedAt: now,
            lastDetectedAt: now,
          },
        });
        return;
      }
      const reopen = existing.status === "RESOLVED" || existing.status === "DISMISSED";
      await tx.dataQualityIssue.update({
        where: { id: existing.id },
        data: {
          runId: input.runId,
          lastDetectedAt: now,
          ...(reopen ? { status: "OPEN", version: { increment: 1 }, resolvedAt: null } : {}),
        },
      });
      if (reopen) {
        await tx.dataQualityIssueAction.create({
          data: {
            issueId: existing.id,
            fromStatus: existing.status,
            toStatus: "OPEN",
            reasonCode: "REDETECTED",
            actorId: "system:data-quality-engine",
          },
        });
      }
    });
  }

  private jsonStringArray(value: Prisma.JsonValue): string[] {
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim());
  }

  private stableJson(value: Record<string, unknown>): string {
    return JSON.stringify(Object.keys(value).sort().reduce<Record<string, unknown>>((result, key) => {
      const item = value[key];
      result[key] = Array.isArray(item) ? [...item].sort() : item;
      return result;
    }, {}));
  }

  private limit(input: string | number | undefined, fallback: number): number {
    if (input === undefined || input === null || input === "") return fallback;
    const value = Number(input);
    if (!Number.isInteger(value) || value < 1 || value > 500) throw new BadRequestException("limit must be between 1 and 500.");
    return value;
  }

  private positiveInteger(value: unknown, field: string): number {
    if (!Number.isInteger(value) || Number(value) < 1) throw new BadRequestException(`${field} must be a positive integer.`);
    return Number(value);
  }

  private reasonCode(value: unknown): string {
    if (typeof value !== "string") throw new BadRequestException("reasonCode is required.");
    const normalized = value.trim().toUpperCase();
    if (!/^[A-Z0-9_]{2,80}$/.test(normalized)) throw new BadRequestException("reasonCode is invalid.");
    return normalized;
  }

  private identifier(value: unknown, field: string): string {
    if (typeof value !== "string") throw new BadRequestException(`${field} is required.`);
    const normalized = value.trim();
    if (!/^[A-Za-z0-9_.:-]{1,180}$/.test(normalized)) throw new BadRequestException(`${field} is invalid.`);
    return normalized;
  }
}
