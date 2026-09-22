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

const MAX_ROWS_PER_MERGE = 10_000;
const SUPPORTED_PATIENT_TABLES = new Set([
  "Appointment",
  "EmergencyAmbulanceRequest",
  "ClinicalRecord",
  "Consent",
  "PatientHealthProfile",
  "QuestionnaireResponse",
  "Observation",
  "ClinicalProfileEntry",
  "MedicationReconciliation",
  "ProviderCategoryFormResponse",
  "ProviderWorkflowEvent",
  "TemporaryClinicalShare",
  "ClinicalDocument",
  "DiagnosticReport",
  "ClinicalMedia",
  "ConsentEvidence",
  "CarePlan",
  "CarePlanAlertRule",
  "ClinicalAlert",
  "SymptomReport",
  "Hospitalization",
  "Immunization",
  "PatientAccessNeed",
  "OperationalAccessNeedSnapshot",
  "AnthropometricMeasurement",
  "NutritionPlan",
  "PhysioAssessment",
  "HomeExercisePlan",
  "ProviderFollowUp",
  "ProviderFieldMedia",
  "ServiceSignature",
  "OfflineFieldDraft",
  "SpecimenCustodyEvent",
  "RefillRequest",
  "Referral",
  "ImagingOrder",
  "DataCorrectionRequest",
]);

type DbClient = Prisma.TransactionClient;
type TablePlan = { tableName: string; entityIds: string[] };
type ConflictDraft = {
  code: string;
  domain: string;
  entityType?: string | null;
  entityId?: string | null;
  blocking: boolean;
  evidence: Record<string, unknown>;
};
type MergePlan = {
  canonicalPatientId: string;
  duplicatePatientId: string;
  duplicateUserId: string;
  duplicateAccountStatus: "ACTIVE" | "SUSPENDED" | "ARCHIVED";
  tables: TablePlan[];
  conflicts: ConflictDraft[];
  sourceRowCount: number;
  digest: string;
};

export interface PreviewPatientMergeInput {
  canonicalPatientId: string;
  duplicatePatientId: string;
}

export interface ExecutePatientMergeInput {
  previewDigest: string;
}

export interface RollbackPatientMergeInput {
  reasonCode: string;
}

@Injectable()
export class PatientMergeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
  ) {}

  async preview(principal: AuthPrincipal, input: PreviewPatientMergeInput) {
    const canonicalPatientId = this.identifier(input?.canonicalPatientId, "canonicalPatientId");
    const duplicatePatientId = this.identifier(input?.duplicatePatientId, "duplicatePatientId");
    if (canonicalPatientId === duplicatePatientId) throw new BadRequestException("canonical and duplicate patient must differ.");

    const plan = await this.buildPlan(this.prisma as unknown as DbClient, canonicalPatientId, duplicatePatientId);
    const blocking = plan.conflicts.filter((conflict) => conflict.blocking).length;
    const job = await this.prisma.$transaction(async (tx) => {
      const created = await tx.patientMergeJob.create({
        data: {
          canonicalPatientId,
          duplicatePatientId,
          duplicateUserId: plan.duplicateUserId,
          duplicateAccountStatus: plan.duplicateAccountStatus,
          status: blocking > 0 ? "BLOCKED" : "PREVIEWED",
          previewDigest: plan.digest,
          sourceRowCount: plan.sourceRowCount,
          conflictCount: blocking,
          createdByActorId: principal.accountId,
        },
      });
      if (plan.conflicts.length > 0) {
        await tx.mergeConflict.createMany({
          data: plan.conflicts.map((conflict) => ({
            mergeJobId: created.id,
            code: conflict.code,
            domain: conflict.domain,
            entityType: conflict.entityType ?? null,
            entityId: conflict.entityId ?? null,
            blocking: conflict.blocking,
            evidence: conflict.evidence as Prisma.InputJsonValue,
          })),
        });
      }
      await this.audit.writeInTransaction(tx, {
        actorId: principal.accountId,
        action: "PATIENT_MERGE_PREVIEW_CREATED",
        objectType: "PATIENT_MERGE_JOB",
        objectId: created.id,
        purpose: "SYSTEM_ACCESS",
        result: blocking > 0 ? "DENIED" : "SUCCESS",
        metadata: {
          canonicalPatientId,
          duplicatePatientId,
          sourceRowCount: plan.sourceRowCount,
          conflictCount: blocking,
          domainCount: plan.tables.length,
        },
      });
      return created;
    });
    return {
      ...job,
      domains: plan.tables.map((table) => ({ tableName: table.tableName, rowCount: table.entityIds.length })),
      conflicts: plan.conflicts,
      executable: blocking === 0,
    };
  }

  async execute(principal: AuthPrincipal, jobIdInput: string, input: ExecutePatientMergeInput) {
    const jobId = this.identifier(jobIdInput, "jobId");
    const previewDigest = this.digest(input?.previewDigest, "previewDigest");
    return this.prisma.$transaction(async (tx) => {
      await this.audit.reserveIntegrityChainForSerializableTransaction(tx);
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "PatientMergeJob" WHERE id = ${jobId} FOR UPDATE`);
      const job = await tx.patientMergeJob.findUnique({ where: { id: jobId } });
      if (!job) throw new NotFoundException("Patient merge job not found.");
      if (job.status !== "PREVIEWED") throw new ConflictException("Only PREVIEWED patient merge jobs may execute.");
      if (job.previewDigest !== previewDigest) throw new ConflictException("Patient merge preview digest mismatch.");

      await tx.$queryRaw(Prisma.sql`
        SELECT id FROM "PatientProfile"
        WHERE id IN (${job.canonicalPatientId}, ${job.duplicatePatientId})
        ORDER BY id FOR UPDATE
      `);
      const refreshed = await this.buildPlan(tx, job.canonicalPatientId, job.duplicatePatientId, job.id);
      if (refreshed.digest !== job.previewDigest) {
        throw new ConflictException("Patient data changed after preview; create a new merge preview.");
      }
      const blocking = refreshed.conflicts.filter((conflict) => conflict.blocking);
      if (blocking.length > 0) throw new ConflictException("Patient merge is blocked by preview conflicts.");

      let movementCount = 0;
      for (const table of refreshed.tables) {
        const identifier = Prisma.raw(`"${table.tableName}"`);
        for (const entityId of table.entityIds) {
          const changed = await tx.$executeRaw(Prisma.sql`
            UPDATE ${identifier}
            SET "patientId" = ${job.canonicalPatientId}
            WHERE id = ${entityId} AND "patientId" = ${job.duplicatePatientId}
          `);
          if (changed !== 1) throw new ConflictException(`Patient merge source row changed in ${table.tableName}.`);
          await tx.patientMergeMovement.create({
            data: {
              mergeJobId: job.id,
              tableName: table.tableName,
              entityId,
              fromPatientId: job.duplicatePatientId,
              toPatientId: job.canonicalPatientId,
            },
          });
          movementCount += 1;
        }
      }

      await tx.patientAlias.create({
        data: {
          aliasPatientId: job.duplicatePatientId,
          canonicalPatientId: job.canonicalPatientId,
          mergeJobId: job.id,
          status: "ACTIVE",
        },
      });
      await tx.authSession.updateMany({
        where: { userId: job.duplicateUserId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.user.update({
        where: { id: job.duplicateUserId },
        data: { status: "ARCHIVED" },
      });
      const updated = await tx.patientMergeJob.update({
        where: { id: job.id },
        data: { status: "EXECUTED", movementCount, executedAt: new Date() },
      });
      await this.audit.writeInTransaction(tx, {
        actorId: principal.accountId,
        action: "PATIENT_MERGE_EXECUTED",
        objectType: "PATIENT_MERGE_JOB",
        objectId: job.id,
        purpose: "SYSTEM_ACCESS",
        result: "SUCCESS",
        metadata: {
          canonicalPatientId: job.canonicalPatientId,
          duplicatePatientId: job.duplicatePatientId,
          movementCount,
          domainCount: refreshed.tables.length,
        },
      });
      return updated;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async rollback(principal: AuthPrincipal, jobIdInput: string, input: RollbackPatientMergeInput) {
    const jobId = this.identifier(jobIdInput, "jobId");
    const reasonCode = this.reasonCode(input?.reasonCode);
    return this.prisma.$transaction(async (tx) => {
      await this.audit.reserveIntegrityChainForSerializableTransaction(tx);
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "PatientMergeJob" WHERE id = ${jobId} FOR UPDATE`);
      const job = await tx.patientMergeJob.findUnique({ where: { id: jobId } });
      if (!job) throw new NotFoundException("Patient merge job not found.");
      if (job.status !== "EXECUTED") throw new ConflictException("Only EXECUTED patient merge jobs may be rolled back.");
      await tx.$queryRaw(Prisma.sql`
        SELECT id FROM "PatientProfile"
        WHERE id IN (${job.canonicalPatientId}, ${job.duplicatePatientId})
        ORDER BY id FOR UPDATE
      `);

      const movements = await tx.patientMergeMovement.findMany({
        where: { mergeJobId: job.id, status: "APPLIED" },
        orderBy: [{ tableName: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      });
      for (const movement of movements) {
        if (!SUPPORTED_PATIENT_TABLES.has(movement.tableName)) {
          throw new ConflictException(`Rollback adapter missing for ${movement.tableName}.`);
        }
        const identifier = Prisma.raw(`"${movement.tableName}"`);
        const changed = await tx.$executeRaw(Prisma.sql`
          UPDATE ${identifier}
          SET "patientId" = ${movement.fromPatientId}
          WHERE id = ${movement.entityId} AND "patientId" = ${movement.toPatientId}
        `);
        if (changed !== 1) throw new ConflictException(`Merged row changed after execution in ${movement.tableName}; rollback aborted atomically.`);
        await tx.patientMergeMovement.update({
          where: { id: movement.id },
          data: { status: "ROLLED_BACK", rolledBackAt: new Date() },
        });
      }
      await tx.patientAlias.updateMany({
        where: { mergeJobId: job.id, status: "ACTIVE" },
        data: { status: "REVERSED", reversedAt: new Date() },
      });
      await tx.user.update({
        where: { id: job.duplicateUserId },
        data: { status: job.duplicateAccountStatus as "ACTIVE" | "SUSPENDED" | "ARCHIVED" },
      });
      const updated = await tx.patientMergeJob.update({
        where: { id: job.id },
        data: { status: "ROLLED_BACK", rolledBackAt: new Date() },
      });
      await this.audit.writeInTransaction(tx, {
        actorId: principal.accountId,
        action: "PATIENT_MERGE_ROLLED_BACK",
        objectType: "PATIENT_MERGE_JOB",
        objectId: job.id,
        purpose: "SYSTEM_ACCESS",
        result: "SUCCESS",
        metadata: {
          canonicalPatientId: job.canonicalPatientId,
          duplicatePatientId: job.duplicatePatientId,
          movementCount: movements.length,
          reasonCode,
        },
      });
      return updated;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async getJob(jobIdInput: string) {
    const jobId = this.identifier(jobIdInput, "jobId");
    const job = await this.prisma.patientMergeJob.findUnique({
      where: { id: jobId },
      include: {
        conflicts: { orderBy: [{ blocking: "desc" }, { domain: "asc" }, { code: "asc" }] },
        aliases: true,
        movements: { orderBy: [{ tableName: "asc" }, { entityId: "asc" }], take: MAX_ROWS_PER_MERGE },
      },
    });
    if (!job) throw new NotFoundException("Patient merge job not found.");
    return job;
  }

  async resolvePatientId(patientIdInput: string) {
    const patientId = this.identifier(patientIdInput, "patientId");
    const alias = await this.prisma.patientAlias.findUnique({ where: { aliasPatientId: patientId } });
    return {
      requestedPatientId: patientId,
      canonicalPatientId: alias?.status === "ACTIVE" ? alias.canonicalPatientId : patientId,
      resolution: alias?.status === "ACTIVE" ? "ACTIVE_ALIAS" : "DIRECT",
      mergeJobId: alias?.status === "ACTIVE" ? alias.mergeJobId : null,
    };
  }

  private async buildPlan(
    tx: DbClient,
    canonicalPatientId: string,
    duplicatePatientId: string,
    ignoreMergeJobId?: string,
  ): Promise<MergePlan> {
    const [canonical, duplicate] = await Promise.all([
      tx.patientProfile.findUnique({
        where: { id: canonicalPatientId },
        select: { id: true, userId: true, user: { select: { status: true } } },
      }),
      tx.patientProfile.findUnique({
        where: { id: duplicatePatientId },
        select: { id: true, userId: true, user: { select: { status: true } } },
      }),
    ]);
    if (!canonical) throw new NotFoundException("Canonical patient not found.");
    if (!duplicate) throw new NotFoundException("Duplicate patient not found.");
    if (canonical.user.status === "ARCHIVED") throw new ConflictException("Canonical patient account is archived.");

    const conflicts: ConflictDraft[] = [];
    const [canonicalAlias, duplicateAlias, activeMerge] = await Promise.all([
      tx.patientAlias.findUnique({ where: { aliasPatientId: canonicalPatientId } }),
      tx.patientAlias.findUnique({ where: { aliasPatientId: duplicatePatientId } }),
      tx.patientMergeJob.findFirst({
        where: {
          status: { in: ["PREVIEWED", "EXECUTED"] },
          ...(ignoreMergeJobId ? { id: { not: ignoreMergeJobId } } : {}),
          OR: [
            { canonicalPatientId },
            { duplicatePatientId: canonicalPatientId },
            { canonicalPatientId: duplicatePatientId },
            { duplicatePatientId },
          ],
        },
        select: { id: true, status: true },
        orderBy: { createdAt: "desc" },
      }),
    ]);
    if (canonicalAlias?.status === "ACTIVE") conflicts.push(this.conflict("CANONICAL_IS_ALIAS", "IDENTITY", "PATIENT_ALIAS", canonicalPatientId));
    if (duplicateAlias?.status === "ACTIVE") conflicts.push(this.conflict("DUPLICATE_ALREADY_ALIAS", "IDENTITY", "PATIENT_ALIAS", duplicatePatientId));
    if (activeMerge) conflicts.push(this.conflict("PATIENT_ALREADY_IN_ACTIVE_MERGE", "IDENTITY", "PATIENT_MERGE_JOB", activeMerge.id));

    const discovered = await tx.$queryRaw<Array<{ tableName: string }>>(Prisma.sql`
      SELECT table_name AS "tableName"
      FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name = 'patientId'
      ORDER BY table_name
    `);
    const tables: TablePlan[] = [];
    const allSourceIds: string[] = [];
    let sourceRowCount = 0;
    for (const row of discovered) {
      if (!/^[A-Za-z0-9_]+$/.test(row.tableName)) throw new ConflictException("Unsafe patient table identifier discovered.");
      const identifier = Prisma.raw(`"${row.tableName}"`);
      const counts = await tx.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
        SELECT COUNT(*)::bigint AS count FROM ${identifier} WHERE "patientId" = ${duplicatePatientId}
      `);
      const count = Number(counts[0]?.count ?? 0n);
      if (count === 0) continue;
      sourceRowCount += count;
      if (!SUPPORTED_PATIENT_TABLES.has(row.tableName)) {
        conflicts.push({
          code: "UNSUPPORTED_PATIENT_DOMAIN",
          domain: "SCHEMA_COVERAGE",
          entityType: row.tableName,
          blocking: true,
          evidence: { tableName: row.tableName, rowCount: count },
        });
        continue;
      }
      if (count > MAX_ROWS_PER_MERGE) {
        conflicts.push({
          code: "DOMAIN_ROW_LIMIT_EXCEEDED",
          domain: "SCHEMA_COVERAGE",
          entityType: row.tableName,
          blocking: true,
          evidence: { tableName: row.tableName, rowCount: count, maxRows: MAX_ROWS_PER_MERGE },
        });
        continue;
      }
      const ids = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT id FROM ${identifier}
        WHERE "patientId" = ${duplicatePatientId}
        ORDER BY id
        LIMIT ${MAX_ROWS_PER_MERGE + 1}
      `);
      const entityIds = ids.map((item) => item.id);
      tables.push({ tableName: row.tableName, entityIds });
      allSourceIds.push(...entityIds);
    }

    await this.addKnownUniqueConflicts(tx, canonicalPatientId, duplicatePatientId, conflicts);
    if (allSourceIds.length > 0) {
      const qualityIssues = await tx.dataQualityIssue.findMany({
        where: {
          sourceEntityId: { in: allSourceIds.slice(0, MAX_ROWS_PER_MERGE) },
          status: { in: ["OPEN", "ACKNOWLEDGED"] },
          severity: { in: ["HIGH", "CRITICAL"] },
        },
        select: { id: true, sourceEntityType: true, sourceEntityId: true, severity: true },
        orderBy: { id: "asc" },
        take: 100,
      });
      for (const issue of qualityIssues) {
        conflicts.push({
          code: "UNRESOLVED_HIGH_DATA_QUALITY_ISSUE",
          domain: "DATA_QUALITY",
          entityType: issue.sourceEntityType,
          entityId: issue.sourceEntityId,
          blocking: true,
          evidence: { dataQualityIssueId: issue.id, severity: issue.severity },
        });
      }
    }

    tables.sort((a, b) => a.tableName.localeCompare(b.tableName));
    conflicts.sort((a, b) => `${a.code}:${a.domain}:${a.entityId ?? ""}`.localeCompare(`${b.code}:${b.domain}:${b.entityId ?? ""}`));
    const digest = createHash("sha256").update(JSON.stringify({
      canonicalPatientId,
      duplicatePatientId,
      tables: tables.map((table) => [table.tableName, table.entityIds]),
      conflicts: conflicts.map((conflict) => [conflict.code, conflict.domain, conflict.entityType ?? null, conflict.entityId ?? null, conflict.blocking, conflict.evidence]),
    })).digest("hex");

    return {
      canonicalPatientId,
      duplicatePatientId,
      duplicateUserId: duplicate.userId,
      duplicateAccountStatus: duplicate.user.status,
      tables,
      conflicts,
      sourceRowCount,
      digest,
    };
  }

  private async addKnownUniqueConflicts(
    tx: DbClient,
    canonicalPatientId: string,
    duplicatePatientId: string,
    conflicts: ConflictDraft[],
  ): Promise<void> {
    const oneToOneTables = ["PatientHealthProfile", "PatientAccessNeed"];
    for (const tableName of oneToOneTables) {
      const exists = await tx.$queryRaw<Array<{ present: boolean }>>(Prisma.sql`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = ${tableName} AND column_name = 'patientId'
        ) AS present
      `);
      if (!exists[0]?.present) continue;
      const identifier = Prisma.raw(`"${tableName}"`);
      const rows = await tx.$queryRaw<Array<{ canonicalCount: bigint; duplicateCount: bigint }>>(Prisma.sql`
        SELECT
          COUNT(*) FILTER (WHERE "patientId" = ${canonicalPatientId})::bigint AS "canonicalCount",
          COUNT(*) FILTER (WHERE "patientId" = ${duplicatePatientId})::bigint AS "duplicateCount"
        FROM ${identifier}
      `);
      if (Number(rows[0]?.canonicalCount ?? 0n) > 0 && Number(rows[0]?.duplicateCount ?? 0n) > 0) {
        conflicts.push({
          code: "ONE_TO_ONE_DOMAIN_COLLISION",
          domain: tableName,
          entityType: tableName,
          blocking: true,
          evidence: { tableName, key: "patientId" },
        });
      }
    }

    const questionnaire = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT d.id
      FROM "QuestionnaireResponse" d
      JOIN "QuestionnaireResponse" c
        ON c."patientId" = ${canonicalPatientId}
       AND c."questionnaireId" = d."questionnaireId"
       AND c.sequence = d.sequence
      WHERE d."patientId" = ${duplicatePatientId}
      ORDER BY d.id LIMIT 100
    `);
    for (const row of questionnaire) conflicts.push(this.conflict("PATIENT_SCOPED_UNIQUE_COLLISION", "QuestionnaireResponse", "QUESTIONNAIRE_RESPONSE", row.id));

    const symptoms = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT d.id
      FROM "SymptomReport" d
      JOIN "SymptomReport" c
        ON c."patientId" = ${canonicalPatientId}
       AND c."idempotencyKey" = d."idempotencyKey"
      WHERE d."patientId" = ${duplicatePatientId}
      ORDER BY d.id LIMIT 100
    `);
    for (const row of symptoms) conflicts.push(this.conflict("PATIENT_SCOPED_UNIQUE_COLLISION", "SymptomReport", "SYMPTOM_REPORT", row.id));

    const immunizations = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT d.id
      FROM "Immunization" d
      JOIN "Immunization" c
        ON c."patientId" = ${canonicalPatientId}
       AND c."logicalKey" = d."logicalKey"
      WHERE d."patientId" = ${duplicatePatientId}
      ORDER BY d.id LIMIT 100
    `);
    for (const row of immunizations) conflicts.push(this.conflict("PATIENT_SCOPED_UNIQUE_COLLISION", "Immunization", "IMMUNIZATION", row.id));
  }

  private conflict(code: string, domain: string, entityType: string, entityId: string): ConflictDraft {
    return { code, domain, entityType, entityId, blocking: true, evidence: { code, domain } };
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

  private reasonCode(value: unknown): string {
    if (typeof value !== "string") throw new BadRequestException("reasonCode is required.");
    const normalized = value.trim().toUpperCase();
    if (!/^[A-Z0-9_]{2,80}$/.test(normalized)) throw new BadRequestException("reasonCode is invalid.");
    return normalized;
  }
}
