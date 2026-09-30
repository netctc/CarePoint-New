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

const PLAN_VERSION = "patient-merge-v1";
const MAX_ALIAS_HOPS = 16;
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;

export interface PreviewPatientMergeInput {
  sourcePatientId: string;
  targetPatientId: string;
}

export interface ExecutePatientMergeInput {
  planDigest: string;
}

type TablePlan = {
  tableName: string;
  sourceCount: number;
  targetCount: number;
  hasUpdateTrigger: boolean;
  hasPatientScopedUniqueIndex: boolean;
  action: "REASSIGN" | "BLOCK";
  conflictCode: string | null;
};

type MergePlan = {
  sourcePatientId: string;
  targetPatientId: string;
  tables: TablePlan[];
  domainCount: number;
  recordCount: number;
  blockingConflictCount: number;
  digest: string;
};

@Injectable()
export class PatientMergeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
  ) {}

  async preview(principal: AuthPrincipal, input: PreviewPatientMergeInput) {
    const sourcePatientId = this.identifier(input?.sourcePatientId, "sourcePatientId");
    const targetInput = this.identifier(input?.targetPatientId, "targetPatientId");
    const targetPatientId = await this.resolveCanonical(targetInput);
    if (sourcePatientId === targetPatientId) throw new BadRequestException("Source and canonical target patient must differ.");

    return this.prisma.$transaction(async (tx) => {
      await this.lockPatients(tx, sourcePatientId, targetPatientId);
      await this.assertMergeEndpoints(tx, sourcePatientId, targetPatientId);
      const existingAlias = await tx.patientAlias.findUnique({ where: { aliasPatientId: sourcePatientId } });
      if (existingAlias) throw new ConflictException({
        message: "Source patient is already an alias.",
        canonicalPatientId: existingAlias.canonicalPatientId,
      });

      const plan = await this.buildPlan(tx, sourcePatientId, targetPatientId);
      const job = await tx.patientMergeJob.create({
        data: {
          sourcePatientId,
          targetPatientId,
          state: "PREVIEWED",
          planVersion: PLAN_VERSION,
          planDigest: plan.digest,
          domainCount: plan.domainCount,
          recordCount: plan.recordCount,
          blockingConflictCount: plan.blockingConflictCount,
          createdByActorId: principal.accountId,
        },
      });
      const conflicts = plan.tables.filter((row) => row.action === "BLOCK");
      if (conflicts.length > 0) {
        await tx.patientMergeConflict.createMany({
          data: conflicts.map((row) => ({
            jobId: job.id,
            domain: row.tableName,
            code: row.conflictCode ?? "UNSAFE_DOMAIN",
            blocking: true,
            sourceCount: row.sourceCount,
            targetCount: row.targetCount,
            structuralEvidence: {
              hasUpdateTrigger: row.hasUpdateTrigger,
              hasPatientScopedUniqueIndex: row.hasPatientScopedUniqueIndex,
            },
          })),
        });
      }
      await this.audit.writeInTransaction(tx, {
        actorId: principal.accountId,
        action: "PATIENT_MERGE_PREVIEW_CREATED",
        objectType: "PATIENT_MERGE_JOB",
        objectId: job.id,
        purpose: "SYSTEM_ACCESS",
        result: "SUCCESS",
        metadata: {
          planVersion: PLAN_VERSION,
          domainCount: plan.domainCount,
          recordCount: plan.recordCount,
          blockingConflictCount: plan.blockingConflictCount,
        },
      });
      return {
        ...job,
        executionAllowed: plan.blockingConflictCount === 0,
        domains: plan.tables,
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async getJob(jobIdInput: string) {
    const jobId = this.identifier(jobIdInput, "jobId");
    const job = await this.prisma.patientMergeJob.findUnique({
      where: { id: jobId },
      include: { conflicts: { orderBy: [{ domain: "asc" }, { id: "asc" }] }, aliases: true },
    });
    if (!job) throw new NotFoundException("Patient merge job not found.");
    return job;
  }

  async execute(principal: AuthPrincipal, jobIdInput: string, input: ExecutePatientMergeInput) {
    const jobId = this.identifier(jobIdInput, "jobId");
    const suppliedDigest = this.digest(input?.planDigest, "planDigest");

    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "PatientMergeJob" WHERE id = ${jobId} FOR UPDATE`);
      const job = await tx.patientMergeJob.findUnique({ where: { id: jobId } });
      if (!job) throw new NotFoundException("Patient merge job not found.");
      if (job.state !== "PREVIEWED") throw new ConflictException("Only PREVIEWED patient merges may execute.");
      if (job.planDigest !== suppliedDigest) throw new ConflictException("Patient merge plan digest mismatch; create a new preview.");
      if (job.blockingConflictCount > 0) throw new ConflictException("Patient merge contains blocking conflicts and cannot execute.");

      await this.lockPatients(tx, job.sourcePatientId, job.targetPatientId);
      await this.assertMergeEndpoints(tx, job.sourcePatientId, job.targetPatientId);
      const alias = await tx.patientAlias.findUnique({ where: { aliasPatientId: job.sourcePatientId } });
      if (alias) throw new ConflictException("Source patient was merged after this preview; create a new preview.");

      const currentPlan = await this.buildPlan(tx, job.sourcePatientId, job.targetPatientId);
      if (currentPlan.digest !== job.planDigest || currentPlan.blockingConflictCount > 0) {
        throw new ConflictException({
          message: "Patient merge source/target state changed after preview; create a new preview.",
          currentPlanDigest: currentPlan.digest,
          blockingConflictCount: currentPlan.blockingConflictCount,
        });
      }

      let movedRecords = 0;
      for (const row of currentPlan.tables) {
        if (row.action !== "REASSIGN" || row.sourceCount === 0) continue;
        movedRecords += await this.reassignTable(tx, row.tableName, job.sourcePatientId, job.targetPatientId);
      }
      if (movedRecords !== currentPlan.recordCount) {
        throw new ConflictException("Patient merge record counts changed during execution; transaction rolled back.");
      }

      await tx.patientAlias.create({
        data: {
          aliasPatientId: job.sourcePatientId,
          canonicalPatientId: job.targetPatientId,
          mergeJobId: job.id,
        },
      });

      const sourceProfile = await tx.patientProfile.findUnique({
        where: { id: job.sourcePatientId },
        select: { userId: true },
      });
      if (!sourceProfile) throw new ConflictException("Source patient disappeared during merge.");
      const now = new Date();
      await tx.user.update({ where: { id: sourceProfile.userId }, data: { status: "ARCHIVED" } });
      await tx.authSession.updateMany({
        where: { userId: sourceProfile.userId, revokedAt: null },
        data: { revokedAt: now },
      });
      const executed = await tx.patientMergeJob.update({
        where: { id: job.id },
        data: {
          state: "EXECUTED",
          executedByActorId: principal.accountId,
          executedAt: now,
        },
      });
      await this.audit.writeInTransaction(tx, {
        actorId: principal.accountId,
        action: "PATIENT_MERGE_EXECUTED",
        objectType: "PATIENT_MERGE_JOB",
        objectId: job.id,
        purpose: "SYSTEM_ACCESS",
        result: "SUCCESS",
        metadata: {
          planVersion: job.planVersion,
          domainCount: currentPlan.domainCount,
          movedRecords,
          sourceAccountArchived: true,
          sourceSessionsRevoked: true,
        },
      });
      return {
        ...executed,
        canonicalPatientId: job.targetPatientId,
        aliasPatientId: job.sourcePatientId,
        movedRecords,
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async resolve(patientIdInput: string) {
    const patientId = this.identifier(patientIdInput, "patientId");
    const canonicalPatientId = await this.resolveCanonical(patientId);
    const exists = await this.prisma.patientProfile.findUnique({
      where: { id: canonicalPatientId },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException("Canonical patient profile not found.");
    return { requestedPatientId: patientId, canonicalPatientId, isAlias: patientId !== canonicalPatientId };
  }

  async resolveCanonical(patientIdInput: string): Promise<string> {
    let current = this.identifier(patientIdInput, "patientId");
    const seen = new Set<string>();
    for (let hop = 0; hop < MAX_ALIAS_HOPS; hop += 1) {
      if (seen.has(current)) throw new ConflictException("Patient alias cycle detected.");
      seen.add(current);
      const alias = await this.prisma.patientAlias.findUnique({
        where: { aliasPatientId: current },
        select: { canonicalPatientId: true },
      });
      if (!alias) return current;
      current = alias.canonicalPatientId;
    }
    throw new ConflictException("Patient alias chain exceeds the allowed depth.");
  }

  private async buildPlan(
    tx: Prisma.TransactionClient,
    sourcePatientId: string,
    targetPatientId: string,
  ): Promise<MergePlan> {
    const tables = await tx.$queryRaw<Array<{ tableName: string }>>(Prisma.sql`
      SELECT table_name AS "tableName"
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND column_name = 'patientId'
      ORDER BY table_name ASC
    `);

    const plans: TablePlan[] = [];
    for (const table of tables) {
      const tableName = this.safeTableName(table.tableName);
      const [sourceCount, targetCount, hasUpdateTrigger, hasPatientScopedUniqueIndex] = await Promise.all([
        this.countRows(tx, tableName, sourcePatientId),
        this.countRows(tx, tableName, targetPatientId),
        this.hasUserUpdateTrigger(tx, tableName),
        this.hasPatientScopedUniqueIndex(tx, tableName),
      ]);
      if (sourceCount === 0) continue;

      let conflictCode: string | null = null;
      if (hasUpdateTrigger) conflictCode = "IMMUTABLE_OR_GOVERNED_DOMAIN";
      else if (hasPatientScopedUniqueIndex && targetCount > 0) conflictCode = "PATIENT_SCOPED_UNIQUE_COLLISION_RISK";

      plans.push({
        tableName,
        sourceCount,
        targetCount,
        hasUpdateTrigger,
        hasPatientScopedUniqueIndex,
        action: conflictCode ? "BLOCK" : "REASSIGN",
        conflictCode,
      });
    }

    const domainCount = plans.length;
    const recordCount = plans.filter((row) => row.action === "REASSIGN").reduce((sum, row) => sum + row.sourceCount, 0);
    const blockingConflictCount = plans.filter((row) => row.action === "BLOCK").length;
    const digest = this.planDigest(sourcePatientId, targetPatientId, plans);
    return { sourcePatientId, targetPatientId, tables: plans, domainCount, recordCount, blockingConflictCount, digest };
  }

  private async countRows(tx: Prisma.TransactionClient, tableName: string, patientId: string): Promise<number> {
    const quoted = this.quoteTable(tableName);
    const rows = await tx.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT COUNT(*)::bigint AS count FROM ${quoted} WHERE "patientId" = $1`,
      patientId,
    );
    return Number(rows[0]?.count ?? 0n);
  }

  private async hasUserUpdateTrigger(tx: Prisma.TransactionClient, tableName: string): Promise<boolean> {
    const rows = await tx.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
      SELECT COUNT(*)::bigint AS count
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = ${tableName}
        AND NOT t.tgisinternal
        AND (t.tgtype & 16) <> 0
    `);
    return Number(rows[0]?.count ?? 0n) > 0;
  }

  private async hasPatientScopedUniqueIndex(tx: Prisma.TransactionClient, tableName: string): Promise<boolean> {
    const rows = await tx.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
      SELECT COUNT(*)::bigint AS count
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = ${tableName}
        AND indexdef ILIKE 'CREATE UNIQUE INDEX%'
        AND indexdef LIKE '%"patientId"%'
    `);
    return Number(rows[0]?.count ?? 0n) > 0;
  }

  private async reassignTable(
    tx: Prisma.TransactionClient,
    tableName: string,
    sourcePatientId: string,
    targetPatientId: string,
  ): Promise<number> {
    const quoted = this.quoteTable(tableName);
    return tx.$executeRawUnsafe(
      `UPDATE ${quoted} SET "patientId" = $1 WHERE "patientId" = $2`,
      targetPatientId,
      sourcePatientId,
    );
  }

  private async lockPatients(tx: Prisma.TransactionClient, sourcePatientId: string, targetPatientId: string) {
    const ids = [sourcePatientId, targetPatientId].sort();
    await tx.$queryRaw(Prisma.sql`
      SELECT id FROM "PatientProfile"
      WHERE id IN (${Prisma.join(ids)})
      ORDER BY id
      FOR UPDATE
    `);
  }

  private async assertMergeEndpoints(tx: Prisma.TransactionClient, sourcePatientId: string, targetPatientId: string) {
    const rows = await tx.patientProfile.findMany({
      where: { id: { in: [sourcePatientId, targetPatientId] } },
      select: { id: true, user: { select: { status: true } } },
    });
    if (rows.length !== 2) throw new NotFoundException("Both source and target patient profiles must exist.");
    const source = rows.find((row) => row.id === sourcePatientId);
    const target = rows.find((row) => row.id === targetPatientId);
    if (!source || !target) throw new NotFoundException("Both source and target patient profiles must exist.");
    if (source.user.status !== "ACTIVE") throw new ConflictException("Source patient account must be ACTIVE before merge.");
    if (target.user.status !== "ACTIVE") throw new ConflictException("Target canonical patient account must be ACTIVE.");
  }

  private planDigest(sourcePatientId: string, targetPatientId: string, plans: TablePlan[]): string {
    const rows = [...plans]
      .sort((a, b) => a.tableName.localeCompare(b.tableName))
      .map((row) => [
        row.tableName,
        row.sourceCount,
        row.targetCount,
        row.hasUpdateTrigger ? 1 : 0,
        row.hasPatientScopedUniqueIndex ? 1 : 0,
        row.action,
        row.conflictCode ?? "",
      ].join(":"));
    return createHash("sha256")
      .update([PLAN_VERSION, sourcePatientId, targetPatientId, ...rows].join("|"))
      .digest("hex");
  }

  private safeTableName(value: string): string {
    if (!IDENTIFIER.test(value)) throw new ConflictException("Database table identifier is not safe for patient merge planning.");
    return value;
  }

  private quoteTable(value: string): string {
    return `"${this.safeTableName(value)}"`;
  }

  private identifier(value: unknown, field: string): string {
    if (typeof value !== "string") throw new BadRequestException(`${field} is required.`);
    const normalized = value.trim();
    if (!/^[A-Za-z0-9_.:-]{1,180}$/.test(normalized)) throw new BadRequestException(`${field} is invalid.`);
    return normalized;
  }

  private digest(value: unknown, field: string): string {
    if (typeof value !== "string" || !/^[a-f0-9]{64}$/i.test(value.trim())) {
      throw new BadRequestException(`${field} is invalid.`);
    }
    return value.trim().toLowerCase();
  }
}
