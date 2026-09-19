import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { AuthPrincipal } from "@carepoint/identity";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import {
  normalizeGoalPayload,
  normalizeMetricCode,
  normalizeRecurrence,
  normalizeTaskAssignee,
  normalizeTaskPayload,
} from "./care-plan.engine";

export interface CreateCarePlanTemplateInput {
  code: string;
  labels: Record<string, string>;
}

export interface CreateCarePlanTemplateVersionInput {
  schema: unknown;
}

type TemplateSchema = {
  schemaVersion: 1;
  goals: Array<{ metricCode: string | null; data: Record<string, unknown> }>;
  tasks: Array<{ assigneeType: "PATIENT" | "PROVIDER"; recurrence: Record<string, unknown> | null; data: Record<string, unknown> }>;
};

@Injectable()
export class CarePlanTemplateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
  ) {}

  async adminList() {
    return this.prisma.carePlanTemplate.findMany({
      include: { versions: { orderBy: { version: "desc" } } },
      orderBy: { code: "asc" },
    });
  }

  async create(principal: AuthPrincipal, input: CreateCarePlanTemplateInput) {
    const code = this.code(input?.code);
    const labels = this.labels(input?.labels);
    const row = await this.prisma.carePlanTemplate.create({
      data: { code, labels: labels as unknown as Prisma.InputJsonValue },
    });
    await this.audit.writeClinical({
      actorId: principal.accountId,
      action: "CARE_PLAN_TEMPLATE_CREATED",
      objectType: "CARE_PLAN_TEMPLATE",
      objectId: row.id,
      purpose: "CLINICAL_CONFIGURATION",
      result: "SUCCESS",
      metadata: { domain: "CARE_PLAN", resourceId: row.id, decision: "ALLOW" },
    });
    return row;
  }

  async createVersion(
    principal: AuthPrincipal,
    templateId: string,
    input: CreateCarePlanTemplateVersionInput,
  ) {
    const id = this.id(templateId, "templateId");
    const schema = this.schema(input?.schema);
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "CarePlanTemplate" WHERE id = ${id} FOR UPDATE`);
      const template = await tx.carePlanTemplate.findUnique({ where: { id } });
      if (!template) throw new NotFoundException("Care Plan template not found.");
      if (!template.active) throw new ConflictException("Care Plan template is inactive.");
      const latest = await tx.carePlanTemplateVersion.findFirst({
        where: { templateId: id },
        orderBy: { version: "desc" },
        select: { version: true },
      });
      const created = await tx.carePlanTemplateVersion.create({
        data: {
          templateId: id,
          version: (latest?.version ?? 0) + 1,
          status: "DRAFT",
          schema: schema as unknown as Prisma.InputJsonValue,
          createdByActorId: principal.accountId,
        },
      });
      return created;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async activate(principal: AuthPrincipal, templateId: string, version: number) {
    const id = this.id(templateId, "templateId");
    if (!Number.isInteger(version) || version < 1) throw new BadRequestException("version must be a positive integer.");
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "CarePlanTemplate" WHERE id = ${id} FOR UPDATE`);
      const target = await tx.carePlanTemplateVersion.findUnique({
        where: { templateId_version: { templateId: id, version } },
      });
      if (!target) throw new NotFoundException("Care Plan template version not found.");
      if (target.status === "ACTIVE") return target;
      if (target.status !== "DRAFT") throw new ConflictException("Only a DRAFT Care Plan template version can be activated.");
      const now = new Date();
      await tx.carePlanTemplateVersion.updateMany({
        where: { templateId: id, status: "ACTIVE" },
        data: { status: "RETIRED", retiredAt: now },
      });
      const active = await tx.carePlanTemplateVersion.update({
        where: { id: target.id },
        data: { status: "ACTIVE", activatedAt: now, retiredAt: null },
      });
      await this.audit.writeClinicalInTransaction(tx, {
        actorId: principal.accountId,
        action: "CARE_PLAN_TEMPLATE_ACTIVATED",
        objectType: "CARE_PLAN_TEMPLATE_VERSION",
        objectId: active.id,
        purpose: "CLINICAL_CONFIGURATION",
        result: "SUCCESS",
        metadata: { domain: "CARE_PLAN", resourceId: active.id, resourceVersion: active.version, decision: "ALLOW" },
      });
      return active;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async activeForClinician() {
    const rows = await this.prisma.carePlanTemplate.findMany({
      where: { active: true },
      include: {
        versions: { where: { status: "ACTIVE" }, orderBy: { version: "desc" }, take: 1 },
      },
      orderBy: { code: "asc" },
    });
    return {
      requiresClinicianReviewBeforeUse: true,
      items: rows
        .filter((row) => row.versions.length > 0)
        .map((row) => ({
          id: row.id,
          code: row.code,
          labels: row.labels,
          version: row.versions[0]!.version,
          schema: row.versions[0]!.schema,
        })),
    };
  }

  private schema(value: unknown): TemplateSchema {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new BadRequestException("schema must be an object.");
    const raw = value as Record<string, unknown>;
    const goalsRaw = raw.goals ?? [];
    const tasksRaw = raw.tasks ?? [];
    if (!Array.isArray(goalsRaw) || !Array.isArray(tasksRaw)) throw new BadRequestException("schema goals/tasks must be arrays.");
    if (goalsRaw.length + tasksRaw.length === 0) throw new BadRequestException("A Care Plan template requires at least one goal or task blueprint.");
    if (goalsRaw.length > 50 || tasksRaw.length > 100) throw new BadRequestException("Care Plan template is too large.");
    const goals = goalsRaw.map((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new BadRequestException("Goal blueprint must be an object.");
      const item = value as Record<string, unknown>;
      const metricCode = normalizeMetricCode(item.metricCode);
      const data = normalizeGoalPayload(item.data);
      if ((data as { kind?: string }).kind === "MEASURABLE" && !metricCode) throw new BadRequestException("MEASURABLE goal blueprint requires metricCode.");
      return { metricCode, data };
    });
    const tasks = tasksRaw.map((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new BadRequestException("Task blueprint must be an object.");
      const item = value as Record<string, unknown>;
      return {
        assigneeType: normalizeTaskAssignee(item.assigneeType),
        recurrence: normalizeRecurrence(item.recurrence),
        data: normalizeTaskPayload(item.data),
      };
    });
    return { schemaVersion: 1, goals, tasks };
  }

  private code(value: unknown): string {
    if (typeof value !== "string") throw new BadRequestException("code is required.");
    const normalized = value.trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9_]{2,79}$/.test(normalized)) throw new BadRequestException("code is invalid.");
    return normalized;
  }

  private labels(value: unknown): Record<string, string> {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new BadRequestException("labels must be an object.");
    const raw = value as Record<string, unknown>;
    const output: Record<string, string> = {};
    for (const locale of ["en", "ar", "fr", "es"] as const) {
      const candidate = raw[locale];
      if (candidate == null) continue;
      if (typeof candidate !== "string") throw new BadRequestException(`labels.${locale} must be text.`);
      const normalized = candidate.trim();
      if (!normalized || normalized.length > 300) throw new BadRequestException(`labels.${locale} is invalid.`);
      output[locale] = normalized;
    }
    if (!output.en) throw new BadRequestException("labels.en is required.");
    return output;
  }

  private id(value: unknown, field: string): string {
    if (typeof value !== "string") throw new BadRequestException(`${field} is required.`);
    const normalized = value.trim();
    if (!/^[A-Za-z0-9_.:-]{1,180}$/.test(normalized)) throw new BadRequestException(`${field} is invalid.`);
    return normalized;
  }
}
