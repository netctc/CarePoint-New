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

const RETENTION_DOMAINS = [
  "CLINICAL_DOCUMENT",
  "CLINICAL_MEDIA",
  "CLINICAL_DOCUMENT_ACCESS_GRANT",
  "CLINICAL_MEDIA_ACCESS_GRANT",
  "AUDIT_EVENT",
] as const;
const RETENTION_ACTIONS = ["SOFT_REMOVE", "PURGE_EXPIRED_GRANTS", "PROTECT_ONLY"] as const;
const HOLD_DOMAINS = ["CLINICAL_DOCUMENT", "CLINICAL_MEDIA", "AUDIT_EVENT"] as const;
const HOLD_SUBJECT_TYPES = ["GLOBAL", "PATIENT", "ENTITY"] as const;
const BATCH_SIZE = 500;

type RetentionDomain = (typeof RETENTION_DOMAINS)[number];
type RetentionAction = (typeof RETENTION_ACTIONS)[number];
type HoldDomain = (typeof HOLD_DOMAINS)[number];
type HoldSubjectType = (typeof HOLD_SUBJECT_TYPES)[number];

type Candidate = {
  entityType: string;
  entityId: string;
  patientId: string | null;
};

export interface CreateRetentionPolicyInput {
  code: string;
  domain: string;
  jurisdiction: string;
  retentionDays: number;
  action: string;
}

export interface PublishRetentionPolicyVersionInput {
  expectedVersion: number;
  retentionDays: number;
  action: string;
}

export interface CreateLegalHoldInput {
  domain: string;
  jurisdiction: string;
  subjectType: string;
  subjectId?: string | null;
  reasonCode: string;
  startsAt?: string;
  expiresAt?: string | null;
}

export interface ReleaseLegalHoldInput {
  reasonCode: string;
}

export interface DryRunRetentionInput {
  expectedVersion: number;
}

export interface ExecuteRetentionJobInput {
  planDigest: string;
}

@Injectable()
export class RetentionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
  ) {}

  listPolicies() {
    return this.prisma.retentionPolicy.findMany({
      include: { versions: { orderBy: { version: "desc" }, take: 1 } },
      orderBy: [{ domain: "asc" }, { jurisdiction: "asc" }, { code: "asc" }],
    });
  }

  async createPolicy(principal: AuthPrincipal, input: CreateRetentionPolicyInput) {
    const code = this.code(input?.code, "code");
    const domain = this.domain(input?.domain);
    const jurisdiction = this.jurisdiction(input?.jurisdiction);
    const retentionDays = this.retentionDays(input?.retentionDays);
    const action = this.action(input?.action);
    this.assertDomainAction(domain, action);

    return this.prisma.$transaction(async (tx) => {
      const policy = await tx.retentionPolicy.create({
        data: { code, domain, jurisdiction, currentVersion: 1 },
      });
      await tx.retentionPolicyVersion.create({
        data: {
          policyId: policy.id,
          version: 1,
          retentionDays,
          action,
          createdByActorId: principal.accountId,
        },
      });
      await this.audit.writeInTransaction(tx, {
        actorId: principal.accountId,
        action: "RETENTION_POLICY_CREATED",
        objectType: "RETENTION_POLICY",
        objectId: policy.id,
        purpose: "SYSTEM_ACCESS",
        result: "SUCCESS",
        metadata: { code, domain, jurisdiction, version: 1, retentionDays, action },
      });
      return { ...policy, version: 1, retentionDays, action };
    });
  }

  async publishPolicyVersion(principal: AuthPrincipal, policyIdInput: string, input: PublishRetentionPolicyVersionInput) {
    const policyId = this.identifier(policyIdInput, "policyId");
    const expectedVersion = this.positiveInteger(input?.expectedVersion, "expectedVersion");
    const retentionDays = this.retentionDays(input?.retentionDays);
    const action = this.action(input?.action);

    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "RetentionPolicy" WHERE id = ${policyId} FOR UPDATE`);
      const policy = await tx.retentionPolicy.findUnique({ where: { id: policyId } });
      if (!policy) throw new NotFoundException("Retention policy not found.");
      if (policy.currentVersion !== expectedVersion) {
        throw new ConflictException({ message: "Retention policy version conflict.", currentVersion: policy.currentVersion });
      }
      this.assertDomainAction(policy.domain as RetentionDomain, action);
      const nextVersion = policy.currentVersion + 1;
      await tx.retentionPolicyVersion.create({
        data: {
          policyId,
          version: nextVersion,
          retentionDays,
          action,
          createdByActorId: principal.accountId,
        },
      });
      const updated = await tx.retentionPolicy.update({
        where: { id: policyId },
        data: { currentVersion: nextVersion },
      });
      await this.audit.writeInTransaction(tx, {
        actorId: principal.accountId,
        action: "RETENTION_POLICY_VERSION_PUBLISHED",
        objectType: "RETENTION_POLICY",
        objectId: policyId,
        purpose: "SYSTEM_ACCESS",
        result: "SUCCESS",
        metadata: {
          code: policy.code,
          domain: policy.domain,
          jurisdiction: policy.jurisdiction,
          version: nextVersion,
          retentionDays,
          action,
        },
      });
      return { ...updated, version: nextVersion, retentionDays, action };
    });
  }

  listLegalHolds(domainInput?: string) {
    const domain = domainInput?.trim() ? this.holdDomain(domainInput) : undefined;
    return this.prisma.legalHold.findMany({
      where: domain ? { domain } : undefined,
      orderBy: [{ releasedAt: "asc" }, { startsAt: "desc" }],
      take: 500,
    });
  }

  async createLegalHold(principal: AuthPrincipal, input: CreateLegalHoldInput) {
    const domain = this.holdDomain(input?.domain);
    const jurisdiction = this.jurisdiction(input?.jurisdiction);
    const subjectType = this.holdSubjectType(input?.subjectType);
    const subjectId = subjectType === "GLOBAL" ? null : this.identifier(input?.subjectId, "subjectId");
    const reasonCode = this.reasonCode(input?.reasonCode);
    const startsAt = input?.startsAt ? this.date(input.startsAt, "startsAt") : new Date();
    const expiresAt = input?.expiresAt ? this.date(input.expiresAt, "expiresAt") : null;
    if (expiresAt && expiresAt <= startsAt) throw new BadRequestException("expiresAt must be after startsAt.");

    const hold = await this.prisma.legalHold.create({
      data: {
        domain,
        jurisdiction,
        subjectType,
        subjectId,
        reasonCode,
        startsAt,
        expiresAt,
        createdByActorId: principal.accountId,
      },
    });
    await this.audit.write({
      actorId: principal.accountId,
      action: "LEGAL_HOLD_CREATED",
      objectType: "LEGAL_HOLD",
      objectId: hold.id,
      purpose: "SYSTEM_ACCESS",
      result: "SUCCESS",
      metadata: { domain, jurisdiction, subjectType, reasonCode, expiresAt: expiresAt?.toISOString() ?? null },
    });
    return hold;
  }

  async releaseLegalHold(principal: AuthPrincipal, holdIdInput: string, input: ReleaseLegalHoldInput) {
    const holdId = this.identifier(holdIdInput, "holdId");
    const reasonCode = this.reasonCode(input?.reasonCode);
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "LegalHold" WHERE id = ${holdId} FOR UPDATE`);
      const hold = await tx.legalHold.findUnique({ where: { id: holdId } });
      if (!hold) throw new NotFoundException("Legal hold not found.");
      if (hold.releasedAt) return hold;
      const updated = await tx.legalHold.update({
        where: { id: holdId },
        data: { releasedAt: new Date(), releasedByActorId: principal.accountId },
      });
      await this.audit.writeInTransaction(tx, {
        actorId: principal.accountId,
        action: "LEGAL_HOLD_RELEASED",
        objectType: "LEGAL_HOLD",
        objectId: holdId,
        purpose: "SYSTEM_ACCESS",
        result: "SUCCESS",
        metadata: { domain: hold.domain, jurisdiction: hold.jurisdiction, subjectType: hold.subjectType, reasonCode },
      });
      return updated;
    });
  }

  async dryRun(principal: AuthPrincipal, policyIdInput: string, input: DryRunRetentionInput) {
    const policyId = this.identifier(policyIdInput, "policyId");
    const expectedVersion = this.positiveInteger(input?.expectedVersion, "expectedVersion");
    const policy = await this.prisma.retentionPolicy.findUnique({ where: { id: policyId } });
    if (!policy || !policy.active) throw new NotFoundException("Active retention policy not found.");
    if (policy.currentVersion !== expectedVersion) {
      throw new ConflictException({ message: "Retention policy version conflict.", currentVersion: policy.currentVersion });
    }
    const version = await this.prisma.retentionPolicyVersion.findUnique({
      where: { policyId_version: { policyId, version: expectedVersion } },
    });
    if (!version) throw new NotFoundException("Retention policy version not found.");
    const domain = policy.domain as RetentionDomain;
    const action = version.action as RetentionAction;
    this.assertDomainAction(domain, action);
    const cutoffAt = new Date(Date.now() - version.retentionDays * 86_400_000);
    const candidates = await this.candidates(domain, action, cutoffAt);
    const now = new Date();
    const holds = await this.activeHolds(policy.domain, policy.jurisdiction, now);
    const items = candidates.map((candidate) => {
      const blockReason = this.holdReason(candidate, holds);
      return {
        ...candidate,
        action,
        status: blockReason ? "BLOCKED" : "PLANNED",
        blockReason,
      };
    });
    const planDigest = this.planDigest({
      policyId,
      policyVersion: expectedVersion,
      domain,
      jurisdiction: policy.jurisdiction,
      action,
      cutoffAt,
      items,
    });
    const blockedCount = items.filter((item) => item.status === "BLOCKED").length;
    const job = await this.prisma.$transaction(async (tx) => {
      const created = await tx.deletionJob.create({
        data: {
          policyId,
          policyVersion: expectedVersion,
          jurisdiction: policy.jurisdiction,
          domain,
          action,
          cutoffAt,
          status: action === "PROTECT_ONLY" ? "BLOCKED" : "PREVIEWED",
          planDigest,
          candidateCount: items.length,
          blockedCount,
          createdByActorId: principal.accountId,
        },
      });
      if (items.length > 0) {
        await tx.deletionJobItem.createMany({
          data: items.map((item) => ({
            jobId: created.id,
            entityType: item.entityType,
            entityId: item.entityId,
            patientId: item.patientId,
            action,
            status: item.status,
            blockReason: item.blockReason,
          })),
        });
      }
      await this.audit.writeInTransaction(tx, {
        actorId: principal.accountId,
        action: "RETENTION_DRY_RUN_CREATED",
        objectType: "DELETION_JOB",
        objectId: created.id,
        purpose: "SYSTEM_ACCESS",
        result: "SUCCESS",
        metadata: {
          policyId,
          policyVersion: expectedVersion,
          domain,
          jurisdiction: policy.jurisdiction,
          action,
          candidateCount: items.length,
          blockedCount,
          batchLimit: BATCH_SIZE,
        },
      });
      return created;
    });
    return {
      ...job,
      items,
      moreAvailable: candidates.length === BATCH_SIZE,
      executionAllowed: action !== "PROTECT_ONLY",
    };
  }

  async execute(principal: AuthPrincipal, jobIdInput: string, input: ExecuteRetentionJobInput) {
    const jobId = this.identifier(jobIdInput, "jobId");
    const planDigest = this.digest(input?.planDigest, "planDigest");
    const job = await this.prisma.deletionJob.findUnique({
      where: { id: jobId },
      include: { items: { orderBy: [{ entityType: "asc" }, { entityId: "asc" }] } },
    });
    if (!job) throw new NotFoundException("Retention job not found.");
    if (job.status !== "PREVIEWED") throw new ConflictException("Only PREVIEWED retention jobs may be executed.");
    if (job.planDigest !== planDigest) throw new ConflictException("Retention job plan digest mismatch; create a new dry-run.");
    if (job.action === "PROTECT_ONLY") throw new ConflictException("Protected domains cannot be executed by the retention deletion engine.");

    const policy = await this.prisma.retentionPolicy.findUnique({ where: { id: job.policyId } });
    if (!policy || !policy.active || policy.currentVersion !== job.policyVersion) {
      throw new ConflictException("Retention policy changed after preview; create a new dry-run.");
    }

    const now = new Date();
    const holds = await this.activeHolds(job.domain, job.jurisdiction, now);
    let appliedCount = 0;
    let blockedCount = 0;
    for (const item of job.items) {
      if (item.status === "BLOCKED") {
        blockedCount += 1;
        continue;
      }
      const candidate: Candidate = { entityType: item.entityType, entityId: item.entityId, patientId: item.patientId };
      const newHoldReason = this.holdReason(candidate, holds);
      if (newHoldReason) {
        await this.prisma.deletionJobItem.update({
          where: { id: item.id },
          data: { status: "BLOCKED", blockReason: newHoldReason },
        });
        blockedCount += 1;
        continue;
      }
      const applied = await this.applyItem(job.domain as RetentionDomain, job.action as RetentionAction, item.entityId, now);
      await this.prisma.deletionJobItem.update({
        where: { id: item.id },
        data: {
          status: applied ? "APPLIED" : "FAILED",
          appliedAt: applied ? now : null,
          blockReason: applied ? null : "SOURCE_STATE_CHANGED",
        },
      });
      if (applied) appliedCount += 1;
    }
    const finalStatus = appliedCount === 0 && blockedCount > 0 ? "BLOCKED" : "COMPLETED";
    const updated = await this.prisma.deletionJob.update({
      where: { id: jobId },
      data: {
        status: finalStatus,
        appliedCount,
        blockedCount,
        executedAt: new Date(),
      },
    });
    await this.audit.write({
      actorId: principal.accountId,
      action: "RETENTION_JOB_EXECUTED",
      objectType: "DELETION_JOB",
      objectId: jobId,
      purpose: "SYSTEM_ACCESS",
      result: "SUCCESS",
      metadata: {
        policyId: job.policyId,
        policyVersion: job.policyVersion,
        domain: job.domain,
        action: job.action,
        candidateCount: job.candidateCount,
        appliedCount,
        blockedCount,
      },
    });
    return updated;
  }

  listJobs(limitInput?: string | number) {
    const limit = this.limit(limitInput, 100);
    return this.prisma.deletionJob.findMany({
      include: { items: { orderBy: { createdAt: "asc" }, take: BATCH_SIZE } },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  }

  private async candidates(domain: RetentionDomain, action: RetentionAction, cutoffAt: Date): Promise<Candidate[]> {
    if (domain === "CLINICAL_DOCUMENT" && action === "SOFT_REMOVE") {
      const rows = await this.prisma.clinicalDocument.findMany({
        where: { status: { not: "REMOVED" }, createdAt: { lt: cutoffAt } },
        select: { id: true, patientId: true },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: BATCH_SIZE,
      });
      return rows.map((row) => ({ entityType: "CLINICAL_DOCUMENT", entityId: row.id, patientId: row.patientId }));
    }
    if (domain === "CLINICAL_MEDIA" && action === "SOFT_REMOVE") {
      const rows = await this.prisma.clinicalMedia.findMany({
        where: { status: { not: "REMOVED" }, createdAt: { lt: cutoffAt } },
        select: { id: true, patientId: true },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: BATCH_SIZE,
      });
      return rows.map((row) => ({ entityType: "CLINICAL_MEDIA", entityId: row.id, patientId: row.patientId }));
    }
    if (domain === "CLINICAL_DOCUMENT_ACCESS_GRANT" && action === "PURGE_EXPIRED_GRANTS") {
      const rows = await this.prisma.clinicalDocumentDownloadGrant.findMany({
        where: { expiresAt: { lt: cutoffAt } },
        select: { id: true },
        orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
        take: BATCH_SIZE,
      });
      return rows.map((row) => ({ entityType: "CLINICAL_DOCUMENT_ACCESS_GRANT", entityId: row.id, patientId: null }));
    }
    if (domain === "CLINICAL_MEDIA_ACCESS_GRANT" && action === "PURGE_EXPIRED_GRANTS") {
      const rows = await this.prisma.clinicalMediaAccessGrant.findMany({
        where: { expiresAt: { lt: cutoffAt } },
        select: { id: true },
        orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
        take: BATCH_SIZE,
      });
      return rows.map((row) => ({ entityType: "CLINICAL_MEDIA_ACCESS_GRANT", entityId: row.id, patientId: null }));
    }
    if (domain === "AUDIT_EVENT" && action === "PROTECT_ONLY") return [];
    throw new BadRequestException("Unsupported retention domain/action combination.");
  }

  private async applyItem(domain: RetentionDomain, action: RetentionAction, entityId: string, now: Date): Promise<boolean> {
    if (domain === "CLINICAL_DOCUMENT" && action === "SOFT_REMOVE") {
      const result = await this.prisma.clinicalDocument.updateMany({
        where: { id: entityId, status: { not: "REMOVED" } },
        data: { status: "REMOVED", removedAt: now },
      });
      return result.count === 1;
    }
    if (domain === "CLINICAL_MEDIA" && action === "SOFT_REMOVE") {
      const result = await this.prisma.clinicalMedia.updateMany({
        where: { id: entityId, status: { not: "REMOVED" } },
        data: { status: "REMOVED", removedAt: now },
      });
      return result.count === 1;
    }
    if (domain === "CLINICAL_DOCUMENT_ACCESS_GRANT" && action === "PURGE_EXPIRED_GRANTS") {
      const result = await this.prisma.clinicalDocumentDownloadGrant.deleteMany({ where: { id: entityId, expiresAt: { lt: now } } });
      return result.count === 1;
    }
    if (domain === "CLINICAL_MEDIA_ACCESS_GRANT" && action === "PURGE_EXPIRED_GRANTS") {
      const result = await this.prisma.clinicalMediaAccessGrant.deleteMany({ where: { id: entityId, expiresAt: { lt: now } } });
      return result.count === 1;
    }
    return false;
  }

  private async activeHolds(domain: string, jurisdiction: string, now: Date) {
    if (!HOLD_DOMAINS.includes(domain as HoldDomain)) return [];
    return this.prisma.legalHold.findMany({
      where: {
        domain,
        jurisdiction,
        releasedAt: null,
        startsAt: { lte: now },
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      select: { id: true, subjectType: true, subjectId: true },
      orderBy: { createdAt: "asc" },
      take: 5000,
    });
  }

  private holdReason(candidate: Candidate, holds: Array<{ id: string; subjectType: string; subjectId: string | null }>): string | null {
    for (const hold of holds) {
      if (hold.subjectType === "GLOBAL") return `LEGAL_HOLD:${hold.id}`;
      if (hold.subjectType === "PATIENT" && candidate.patientId && hold.subjectId === candidate.patientId) return `LEGAL_HOLD:${hold.id}`;
      if (hold.subjectType === "ENTITY" && hold.subjectId === candidate.entityId) return `LEGAL_HOLD:${hold.id}`;
    }
    return null;
  }

  private planDigest(input: {
    policyId: string;
    policyVersion: number;
    domain: RetentionDomain;
    jurisdiction: string;
    action: RetentionAction;
    cutoffAt: Date;
    items: Array<Candidate & { action: RetentionAction; status: string; blockReason: string | null }>;
  }): string {
    const serializedItems = [...input.items]
      .sort((a, b) => `${a.entityType}:${a.entityId}`.localeCompare(`${b.entityType}:${b.entityId}`))
      .map((item) => [item.entityType, item.entityId, item.patientId ?? "", item.action, item.status, item.blockReason ?? ""].join(":"));
    return createHash("sha256").update([
      input.policyId,
      String(input.policyVersion),
      input.domain,
      input.jurisdiction,
      input.action,
      input.cutoffAt.toISOString(),
      ...serializedItems,
    ].join("|")).digest("hex");
  }

  private assertDomainAction(domain: RetentionDomain, action: RetentionAction): void {
    const valid = (domain === "CLINICAL_DOCUMENT" || domain === "CLINICAL_MEDIA")
      ? action === "SOFT_REMOVE"
      : (domain === "CLINICAL_DOCUMENT_ACCESS_GRANT" || domain === "CLINICAL_MEDIA_ACCESS_GRANT")
        ? action === "PURGE_EXPIRED_GRANTS"
        : domain === "AUDIT_EVENT" && action === "PROTECT_ONLY";
    if (!valid) throw new BadRequestException("Retention action is not allowed for the selected domain.");
  }

  private domain(value: unknown): RetentionDomain {
    const normalized = typeof value === "string" ? value.trim().toUpperCase() : "";
    if (!RETENTION_DOMAINS.includes(normalized as RetentionDomain)) throw new BadRequestException("domain is invalid.");
    return normalized as RetentionDomain;
  }

  private action(value: unknown): RetentionAction {
    const normalized = typeof value === "string" ? value.trim().toUpperCase() : "";
    if (!RETENTION_ACTIONS.includes(normalized as RetentionAction)) throw new BadRequestException("action is invalid.");
    return normalized as RetentionAction;
  }

  private holdDomain(value: unknown): HoldDomain {
    const normalized = typeof value === "string" ? value.trim().toUpperCase() : "";
    if (!HOLD_DOMAINS.includes(normalized as HoldDomain)) throw new BadRequestException("legal hold domain is invalid.");
    return normalized as HoldDomain;
  }

  private holdSubjectType(value: unknown): HoldSubjectType {
    const normalized = typeof value === "string" ? value.trim().toUpperCase() : "";
    if (!HOLD_SUBJECT_TYPES.includes(normalized as HoldSubjectType)) throw new BadRequestException("subjectType is invalid.");
    return normalized as HoldSubjectType;
  }

  private retentionDays(value: unknown): number {
    if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > 36500) throw new BadRequestException("retentionDays must be between 1 and 36500.");
    return Number(value);
  }

  private positiveInteger(value: unknown, field: string): number {
    if (!Number.isInteger(value) || Number(value) < 1) throw new BadRequestException(`${field} must be a positive integer.`);
    return Number(value);
  }

  private jurisdiction(value: unknown): string {
    if (typeof value !== "string") throw new BadRequestException("jurisdiction is required.");
    const normalized = value.trim().toUpperCase();
    if (!/^[A-Z0-9_-]{2,32}$/.test(normalized)) throw new BadRequestException("jurisdiction is invalid.");
    return normalized;
  }

  private code(value: unknown, field: string): string {
    if (typeof value !== "string") throw new BadRequestException(`${field} is required.`);
    const normalized = value.trim().toUpperCase();
    if (!/^[A-Z0-9_:-]{3,100}$/.test(normalized)) throw new BadRequestException(`${field} is invalid.`);
    return normalized;
  }

  private reasonCode(value: unknown): string {
    return this.code(value, "reasonCode");
  }

  private identifier(value: unknown, field: string): string {
    if (typeof value !== "string") throw new BadRequestException(`${field} is required.`);
    const normalized = value.trim();
    if (!/^[A-Za-z0-9_.:-]{1,180}$/.test(normalized)) throw new BadRequestException(`${field} is invalid.`);
    return normalized;
  }

  private digest(value: unknown, field: string): string {
    if (typeof value !== "string" || !/^[a-f0-9]{64}$/i.test(value.trim())) throw new BadRequestException(`${field} is invalid.`);
    return value.trim().toLowerCase();
  }

  private date(value: string, field: string): Date {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) throw new BadRequestException(`${field} must be a valid datetime.`);
    return parsed;
  }

  private limit(value: string | number | undefined, fallback: number): number {
    if (value === undefined || value === null || value === "") return fallback;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 500) throw new BadRequestException("limit must be between 1 and 500.");
    return parsed;
  }
}
