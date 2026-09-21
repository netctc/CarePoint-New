import { createHash } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { AuthPrincipal } from "@carepoint/identity";
import type { EncryptedEnvelope } from "@carepoint/security";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { normalizeIsoDate, normalizeReasonCode, normalizeRecurrence } from "../care-plan/care-plan.engine";
import { ClinicalEnvelopeService } from "../clinical/clinical-envelope.service";
import { ProviderCategoryCapabilityService } from "../providers/provider-category-capability.service";

const CARE_PLAN_CONSENT_VERSION = "care-plan-v1";
const SAFE_ID = /^[A-Za-z0-9_.:-]{1,180}$/;
const CODE = /^[A-Z][A-Z0-9_]{1,79}$/;
const IDEMPOTENCY = /^[A-Za-z0-9_.:-]{8,128}$/;
const LOOKBACK_DAYS = 365;
const LOOKAHEAD_DAYS = 30;
const MAX_RECOMMENDATIONS = 30;
const MAX_GOALS = 20;
const MAX_TASKS = 30;

type Recommendation = {
  code: string;
  label: string;
  instructions?: string;
};

type Goal = {
  metricCode: string | null;
  label: string;
  target?: string;
  unit?: string;
  periodStart: Date;
  periodEnd: Date | null;
};

type Task = {
  taskCode: string;
  label: string;
  instructions?: string;
  dueAt: Date | null;
  recurrence: Record<string, unknown> | null;
};

type PreparedGoal = Goal & { envelope: EncryptedEnvelope };
type PreparedTask = Task & { envelope: EncryptedEnvelope };

type CreateNutritionPlanInput = {
  appointmentId?: unknown;
  idempotencyKey?: unknown;
  effectiveFrom?: unknown;
  effectiveUntil?: unknown;
  reviewAt?: unknown;
  recommendations?: unknown;
  goals?: unknown;
  tasks?: unknown;
};

type UpdateNutritionPlanInput = {
  expectedVersion?: unknown;
  effectiveUntil?: unknown;
  reviewAt?: unknown;
  recommendations?: unknown;
  goals?: unknown;
  tasks?: unknown;
  reasonCode?: unknown;
};

type PreparedSnapshot = {
  effectiveFrom: Date;
  effectiveUntil: Date | null;
  reviewAt: Date;
  recommendations: Recommendation[];
  goals: Goal[];
  tasks: Task[];
  snapshot: Record<string, unknown>;
  snapshotEnvelope: EncryptedEnvelope;
  preparedGoals: PreparedGoal[];
  preparedTasks: PreparedTask[];
  digest: string;
};

@Injectable()
export class NutritionPlanService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
    private readonly envelope: ClinicalEnvelopeService,
    private readonly capabilities: ProviderCategoryCapabilityService,
  ) {}

  async create(principal: AuthPrincipal, input: CreateNutritionPlanInput) {
    const context = await this.requireNutritionCapability(principal);
    const appointmentId = this.requiredId(input?.appointmentId, "appointmentId");
    const appointment = await this.requireAppointment(context.providerId, appointmentId);
    await this.requireCarePlanConsent(context.providerId, appointment.patientId, "WRITE");
    const idempotencyKey = this.idempotencyKey(input?.idempotencyKey);
    const effectiveFrom = this.requiredDate(input?.effectiveFrom, "effectiveFrom");
    const prepared = await this.prepareSnapshot(input, effectiveFrom);
    const requestDigest = this.digest({
      appointmentId: appointment.id,
      effectiveFrom: prepared.effectiveFrom.toISOString(),
      effectiveUntil: prepared.effectiveUntil?.toISOString() ?? null,
      reviewAt: prepared.reviewAt.toISOString(),
      recommendations: prepared.recommendations,
      goals: prepared.goals.map((item) => this.serializedGoal(item)),
      tasks: prepared.tasks.map((item) => this.serializedTask(item)),
    });

    const existing = await this.prisma.nutritionPlan.findUnique({ where: { idempotencyKey } });
    if (existing) {
      if (existing.providerId !== context.providerId || existing.requestDigest !== requestDigest) {
        throw new ConflictException("idempotencyKey was already used for a different nutrition plan.");
      }
      return this.present(existing.id, "IDEMPOTENT_REPLAY");
    }
    const forAppointment = await this.prisma.nutritionPlan.findUnique({
      where: { providerId_appointmentId: { providerId: context.providerId, appointmentId: appointment.id } },
    });
    if (forAppointment) {
      throw new ConflictException("A nutrition plan already exists for this appointment. Update its version instead.");
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const carePlan = await tx.carePlan.create({
        data: {
          patientId: appointment.patientId,
          ownerProviderId: context.providerId,
          status: "ACTIVE",
          version: 1,
          effectiveFrom: prepared.effectiveFrom,
          ...(prepared.effectiveUntil ? { effectiveUntil: prepared.effectiveUntil } : {}),
          reviewAt: prepared.reviewAt,
          createdByActorId: principal.accountId,
        },
      });
      await tx.carePlanRevision.create({
        data: {
          carePlanId: carePlan.id,
          version: 1,
          authorActorId: principal.accountId,
          ...this.envelopeData(prepared.snapshotEnvelope),
        },
      });
      await this.createCurrentGoalsAndTasks(tx, carePlan.id, context.providerId, principal.accountId, prepared, 1);
      const plan = await tx.nutritionPlan.create({
        data: {
          idempotencyKey,
          requestDigest,
          patientId: appointment.patientId,
          providerId: context.providerId,
          appointmentId: appointment.id,
          carePlanId: carePlan.id,
          status: "ACTIVE",
          version: 1,
        },
      });
      await tx.nutritionPlanRevision.create({
        data: {
          nutritionPlanId: plan.id,
          version: 1,
          authorActorId: principal.accountId,
          ...this.envelopeData(prepared.snapshotEnvelope),
        },
      });
      await this.audit.writeClinicalInTransaction(tx, {
        actorId: principal.accountId,
        action: "NUTRITION_PLAN_CREATED",
        objectType: "NUTRITION_PLAN",
        objectId: plan.id,
        purpose: "TREATMENT",
        result: "SUCCESS",
        metadata: {
          domain: "NUTRITION",
          patientId: plan.patientId,
          providerId: plan.providerId,
          resourceId: plan.id,
          resourceVersion: 1,
          carePlanId: carePlan.id,
          recommendationCount: prepared.recommendations.length,
          goalCount: prepared.goals.length,
          taskCount: prepared.tasks.length,
          decision: "ALLOW",
        },
      });
      return plan;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return this.present(created.id, "CREATED");
  }

  async update(principal: AuthPrincipal, planId: string, input: UpdateNutritionPlanInput) {
    const context = await this.requireNutritionCapability(principal);
    const id = this.requiredId(planId, "planId");
    const row = await this.prisma.nutritionPlan.findUnique({ where: { id } });
    if (!row || row.providerId !== context.providerId) throw new NotFoundException("Nutrition plan not found.");
    await this.requireTreatmentRelationship(context.providerId, row.patientId);
    await this.requireCarePlanConsent(context.providerId, row.patientId, "WRITE");
    const carePlan = await this.prisma.carePlan.findUnique({ where: { id: row.carePlanId } });
    if (!carePlan) throw new ConflictException("Nutrition Care Plan is missing.");
    const expectedVersion = this.positiveInteger(input?.expectedVersion, "expectedVersion");
    if (row.version !== expectedVersion || carePlan.version !== expectedVersion) {
      throw new ConflictException({
        message: "Nutrition plan version conflict.",
        currentVersion: row.version,
        carePlanVersion: carePlan.version,
      });
    }
    const prepared = await this.prepareSnapshot(input, carePlan.effectiveFrom);
    const reasonCode = normalizeReasonCode(input?.reasonCode as string | null | undefined);
    const nextVersion = expectedVersion + 1;
    const requestDigest = this.digest({
      nutritionPlanId: row.id,
      version: nextVersion,
      effectiveFrom: prepared.effectiveFrom.toISOString(),
      effectiveUntil: prepared.effectiveUntil?.toISOString() ?? null,
      reviewAt: prepared.reviewAt.toISOString(),
      recommendations: prepared.recommendations,
      goals: prepared.goals.map((item) => this.serializedGoal(item)),
      tasks: prepared.tasks.map((item) => this.serializedTask(item)),
    });

    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "NutritionPlan" WHERE id = ${row.id} FOR UPDATE`);
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "CarePlan" WHERE id = ${carePlan.id} FOR UPDATE`);
      const currentPlan = await tx.nutritionPlan.findUnique({ where: { id: row.id } });
      const currentCarePlan = await tx.carePlan.findUnique({ where: { id: carePlan.id } });
      if (!currentPlan || !currentCarePlan || currentPlan.version !== expectedVersion || currentCarePlan.version !== expectedVersion) {
        throw new ConflictException({
          message: "Nutrition plan version conflict.",
          currentVersion: currentPlan?.version ?? null,
          carePlanVersion: currentCarePlan?.version ?? null,
        });
      }

      await tx.nutritionPlan.update({
        where: { id: row.id },
        data: { version: nextVersion, requestDigest },
      });
      await tx.nutritionPlanRevision.create({
        data: {
          nutritionPlanId: row.id,
          version: nextVersion,
          authorActorId: principal.accountId,
          ...(reasonCode ? { reasonCode } : {}),
          ...this.envelopeData(prepared.snapshotEnvelope),
        },
      });
      await tx.carePlan.update({
        where: { id: carePlan.id },
        data: {
          version: nextVersion,
          effectiveUntil: prepared.effectiveUntil,
          reviewAt: prepared.reviewAt,
        },
      });
      await tx.carePlanRevision.create({
        data: {
          carePlanId: carePlan.id,
          version: nextVersion,
          authorActorId: principal.accountId,
          ...(reasonCode ? { reasonCode } : {}),
          ...this.envelopeData(prepared.snapshotEnvelope),
        },
      });
      await tx.carePlanGoal.updateMany({
        where: { carePlanId: carePlan.id, status: { in: ["ACTIVE", "PAUSED", "ACHIEVED"] } },
        data: { status: "SUPERSEDED" },
      });
      await tx.careTask.updateMany({
        where: { carePlanId: carePlan.id, status: { in: ["ACTIVE", "PAUSED"] } },
        data: { status: "SUPERSEDED" },
      });
      await this.createCurrentGoalsAndTasks(tx, carePlan.id, context.providerId, principal.accountId, prepared, nextVersion);
      await this.audit.writeClinicalInTransaction(tx, {
        actorId: principal.accountId,
        action: "NUTRITION_PLAN_UPDATED",
        objectType: "NUTRITION_PLAN",
        objectId: row.id,
        purpose: "TREATMENT",
        result: "SUCCESS",
        metadata: {
          domain: "NUTRITION",
          patientId: row.patientId,
          providerId: row.providerId,
          resourceId: row.id,
          resourceVersion: nextVersion,
          carePlanId: row.carePlanId,
          recommendationCount: prepared.recommendations.length,
          goalCount: prepared.goals.length,
          taskCount: prepared.tasks.length,
          decision: "ALLOW",
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return this.present(row.id, "UPDATED");
  }

  async list(principal: AuthPrincipal, patientId: string) {
    const context = await this.requireNutritionCapability(principal);
    const patient = this.requiredId(patientId, "patientId");
    await this.requireTreatmentRelationship(context.providerId, patient);
    await this.requireCarePlanConsent(context.providerId, patient, "READ");
    const rows = await this.prisma.nutritionPlan.findMany({
      where: { providerId: context.providerId, patientId: patient },
      orderBy: { updatedAt: "desc" },
      take: 100,
    });
    const items = [];
    for (const row of rows) items.push(await this.present(row.id, "TREATMENT_RELATIONSHIP"));
    await this.audit.writeClinical({
      actorId: principal.accountId,
      action: "NUTRITION_PLAN_LIST_READ",
      objectType: "PATIENT",
      objectId: patient,
      purpose: "TREATMENT",
      result: "SUCCESS",
      metadata: {
        domain: "NUTRITION",
        patientId: patient,
        providerId: context.providerId,
        itemCount: items.length,
        decision: "ALLOW",
      },
    });
    return { patientId: patient, items, automatedClinicalInference: false };
  }

  async get(principal: AuthPrincipal, planId: string) {
    const context = await this.requireNutritionCapability(principal);
    const id = this.requiredId(planId, "planId");
    const row = await this.prisma.nutritionPlan.findUnique({ where: { id } });
    if (!row || row.providerId !== context.providerId) throw new NotFoundException("Nutrition plan not found.");
    await this.requireTreatmentRelationship(context.providerId, row.patientId);
    await this.requireCarePlanConsent(context.providerId, row.patientId, "READ");
    const result = await this.present(row.id, "TREATMENT_RELATIONSHIP");
    await this.audit.writeClinical({
      actorId: principal.accountId,
      action: "NUTRITION_PLAN_READ",
      objectType: "NUTRITION_PLAN",
      objectId: row.id,
      purpose: "TREATMENT",
      result: "SUCCESS",
      metadata: {
        domain: "NUTRITION",
        patientId: row.patientId,
        providerId: row.providerId,
        resourceId: row.id,
        resourceVersion: row.version,
        decision: "ALLOW",
      },
    });
    return result;
  }

  private async prepareSnapshot(input: CreateNutritionPlanInput | UpdateNutritionPlanInput, effectiveFrom: Date): Promise<PreparedSnapshot> {
    const effectiveUntil = normalizeIsoDate(input?.effectiveUntil, "effectiveUntil", false);
    if (effectiveUntil && effectiveUntil <= effectiveFrom) throw new BadRequestException("effectiveUntil must be after effectiveFrom.");
    const reviewAt = this.requiredDate(input?.reviewAt, "reviewAt");
    if (reviewAt <= effectiveFrom) throw new BadRequestException("reviewAt must be after effectiveFrom.");
    if (effectiveUntil && reviewAt > effectiveUntil) throw new BadRequestException("reviewAt cannot be after effectiveUntil.");

    const recommendations = this.recommendations(input?.recommendations);
    const goals = this.goals(input?.goals, effectiveFrom);
    const tasks = this.tasks(input?.tasks);
    if (recommendations.length + goals.length + tasks.length === 0) {
      throw new BadRequestException("A nutrition plan requires at least one recommendation, goal, or task.");
    }

    const snapshot: Record<string, unknown> = {
      schemaVersion: 1,
      kind: "NUTRITION_PLAN",
      title: "Nutrition plan",
      reviewAt: reviewAt.toISOString(),
      recommendations,
      goals: goals.map((item) => this.serializedGoal(item)),
      tasks: tasks.map((item) => this.serializedTask(item)),
      automatedClinicalInference: false,
    };
    const snapshotEnvelope = await this.envelope.encryptRecord(snapshot);
    const preparedGoals = await Promise.all(goals.map(async (item) => ({
      ...item,
      envelope: await this.envelope.encryptRecord({
        schemaVersion: 1,
        kind: "NUTRITION_GOAL",
        label: item.label,
        target: item.target ?? null,
        unit: item.unit ?? null,
        automatedClinicalInference: false,
      }),
    })));
    const preparedTasks = await Promise.all(tasks.map(async (item) => ({
      ...item,
      envelope: await this.envelope.encryptRecord({
        schemaVersion: 1,
        kind: "NUTRITION_TASK",
        taskCode: item.taskCode,
        label: item.label,
        instructions: item.instructions ?? null,
        automatedClinicalInference: false,
      }),
    })));
    return {
      effectiveFrom,
      effectiveUntil,
      reviewAt,
      recommendations,
      goals,
      tasks,
      snapshot,
      snapshotEnvelope,
      preparedGoals,
      preparedTasks,
      digest: this.digest(snapshot),
    };
  }

  private async createCurrentGoalsAndTasks(
    tx: Prisma.TransactionClient,
    carePlanId: string,
    providerId: string,
    actorId: string,
    prepared: PreparedSnapshot,
    version: number,
  ) {
    for (const goal of prepared.preparedGoals) {
      const created = await tx.carePlanGoal.create({
        data: {
          carePlanId,
          ownerProviderId: providerId,
          metricCode: goal.metricCode,
          status: "ACTIVE",
          version,
          periodStart: goal.periodStart,
          ...(goal.periodEnd ? { periodEnd: goal.periodEnd } : {}),
          ...this.envelopeData(goal.envelope),
        },
      });
      await tx.carePlanGoalRevision.create({
        data: {
          goalId: created.id,
          version,
          authorActorId: actorId,
          ...this.envelopeData(goal.envelope),
        },
      });
    }
    for (const task of prepared.preparedTasks) {
      await tx.careTask.create({
        data: {
          carePlanId,
          ownerProviderId: providerId,
          assigneeType: "PATIENT",
          status: "ACTIVE",
          version,
          ...(task.dueAt ? { dueAt: task.dueAt } : {}),
          ...(task.recurrence ? { recurrence: task.recurrence as Prisma.InputJsonValue } : {}),
          ...this.envelopeData(task.envelope),
        },
      });
    }
  }

  private async present(planId: string, accessBasis: string) {
    const row = await this.prisma.nutritionPlan.findUnique({ where: { id: planId } });
    if (!row) throw new NotFoundException("Nutrition plan not found.");
    const [carePlan, revision] = await Promise.all([
      this.prisma.carePlan.findUnique({ where: { id: row.carePlanId } }),
      this.prisma.nutritionPlanRevision.findFirst({
        where: { nutritionPlanId: row.id },
        orderBy: { version: "desc" },
      }),
    ]);
    if (!carePlan || !revision) throw new ConflictException("Nutrition plan version evidence is incomplete.");
    const data = await this.decrypt(revision);
    return {
      id: row.id,
      patientId: row.patientId,
      providerId: row.providerId,
      appointmentId: row.appointmentId,
      carePlanId: row.carePlanId,
      status: row.status,
      version: row.version,
      effectiveFrom: carePlan.effectiveFrom,
      effectiveUntil: carePlan.effectiveUntil,
      reviewAt: carePlan.reviewAt,
      data,
      accessBasis,
      patientDelivery: "CARE_PLAN_CURRENT_REVISION",
      versioned: true,
      automatedClinicalInference: false,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private recommendations(value: unknown): Recommendation[] {
    const rows = this.objectArray(value, "recommendations", MAX_RECOMMENDATIONS);
    return rows.map((raw, index) => ({
      code: this.code(raw.code, `recommendations[${index}].code`),
      label: this.text(raw.label, `recommendations[${index}].label`, 240, true)!,
      ...(this.text(raw.instructions, `recommendations[${index}].instructions`, 2000, false) === undefined
        ? {}
        : { instructions: this.text(raw.instructions, `recommendations[${index}].instructions`, 2000, false)! }),
    }));
  }

  private goals(value: unknown, defaultStart: Date): Goal[] {
    const rows = this.objectArray(value, "goals", MAX_GOALS);
    return rows.map((raw, index) => {
      const prefix = `goals[${index}]`;
      const periodStart = raw.periodStart == null ? defaultStart : normalizeIsoDate(raw.periodStart, `${prefix}.periodStart`)!;
      const periodEnd = normalizeIsoDate(raw.periodEnd, `${prefix}.periodEnd`, false);
      if (periodEnd && periodEnd <= periodStart) throw new BadRequestException(`${prefix}.periodEnd must be after periodStart.`);
      return {
        metricCode: raw.metricCode == null || raw.metricCode === "" ? null : this.code(raw.metricCode, `${prefix}.metricCode`),
        label: this.text(raw.label, `${prefix}.label`, 240, true)!,
        ...(this.text(raw.target, `${prefix}.target`, 240, false) === undefined ? {} : { target: this.text(raw.target, `${prefix}.target`, 240, false)! }),
        ...(this.text(raw.unit, `${prefix}.unit`, 40, false) === undefined ? {} : { unit: this.text(raw.unit, `${prefix}.unit`, 40, false)! }),
        periodStart,
        periodEnd,
      };
    });
  }

  private tasks(value: unknown): Task[] {
    const rows = this.objectArray(value, "tasks", MAX_TASKS);
    return rows.map((raw, index) => {
      const prefix = `tasks[${index}]`;
      return {
        taskCode: this.code(raw.taskCode, `${prefix}.taskCode`),
        label: this.text(raw.label, `${prefix}.label`, 240, true)!,
        ...(this.text(raw.instructions, `${prefix}.instructions`, 2000, false) === undefined
          ? {}
          : { instructions: this.text(raw.instructions, `${prefix}.instructions`, 2000, false)! }),
        dueAt: normalizeIsoDate(raw.dueAt, `${prefix}.dueAt`, false),
        recurrence: normalizeRecurrence(raw.recurrence),
      };
    });
  }

  private objectArray(value: unknown, field: string, max: number): Record<string, unknown>[] {
    if (value == null) return [];
    if (!Array.isArray(value) || value.length > max) throw new BadRequestException(`${field} must contain at most ${max} items.`);
    return value.map((item, index) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) throw new BadRequestException(`${field}[${index}] must be an object.`);
      return item as Record<string, unknown>;
    });
  }

  private serializedGoal(item: Goal) {
    return {
      metricCode: item.metricCode,
      label: item.label,
      target: item.target ?? null,
      unit: item.unit ?? null,
      periodStart: item.periodStart.toISOString(),
      periodEnd: item.periodEnd?.toISOString() ?? null,
    };
  }

  private serializedTask(item: Task) {
    return {
      taskCode: item.taskCode,
      label: item.label,
      instructions: item.instructions ?? null,
      dueAt: item.dueAt?.toISOString() ?? null,
      recurrence: item.recurrence,
    };
  }

  private async requireNutritionCapability(principal: AuthPrincipal) {
    const context = await this.capabilities.workspaceContext(principal);
    if (!context.clinicalOrderCapabilities.has("NUTRITION")) {
      throw new ForbiddenException("Other Provider category is not authorized for NUTRITION.");
    }
    return context;
  }

  private async requireAppointment(providerId: string, appointmentId: string) {
    const appointment = await this.prisma.appointment.findFirst({
      where: { id: appointmentId, providerId, status: { in: ["CONFIRMED", "COMPLETED"] } },
      select: { id: true, patientId: true, status: true, startsAt: true },
    });
    if (!appointment) throw new ForbiddenException("Authorized nutrition appointment context is required.");
    return appointment;
  }

  private async requireTreatmentRelationship(providerId: string, patientId: string) {
    const now = new Date();
    const from = new Date(now.getTime() - LOOKBACK_DAYS * 86400000);
    const to = new Date(now.getTime() + LOOKAHEAD_DAYS * 86400000);
    const relationship = await this.prisma.appointment.findFirst({
      where: {
        providerId,
        patientId,
        status: { in: ["CONFIRMED", "COMPLETED"] },
        startsAt: { gte: from, lte: to },
      },
      select: { id: true },
    });
    if (!relationship) throw new ForbiddenException("Current nutrition treatment relationship is required.");
  }

  private async requireCarePlanConsent(providerId: string, patientId: string, action: "READ" | "WRITE") {
    const now = new Date();
    const scopes = action === "WRITE" ? ["CARE_PLAN_WRITE"] : ["CARE_PLAN_READ", "CARE_PLAN_WRITE"];
    const consent = await this.prisma.consent.findFirst({
      where: {
        patientId,
        scope: { in: scopes },
        version: CARE_PLAN_CONSENT_VERSION,
        purpose: "TREATMENT",
        state: "GRANTED",
        AND: [
          { OR: [{ providerId }, { providerId: null }] },
          { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
        ],
      },
      select: { id: true },
      orderBy: { grantedAt: "desc" },
    });
    if (!consent) throw new ForbiddenException(`Patient consent is required for Care Plan ${action.toLowerCase()}.`);
  }

  private requiredId(value: unknown, field: string): string {
    if (typeof value !== "string" || !SAFE_ID.test(value.trim())) throw new BadRequestException(`${field} is invalid.`);
    return value.trim();
  }

  private idempotencyKey(value: unknown): string {
    if (typeof value !== "string" || !IDEMPOTENCY.test(value.trim())) throw new BadRequestException("idempotencyKey is invalid.");
    return value.trim();
  }

  private requiredDate(value: unknown, field: string): Date {
    if (value == null || (typeof value === "string" && !value.trim())) throw new BadRequestException(`${field} is required.`);
    return normalizeIsoDate(value, field)!;
  }

  private positiveInteger(value: unknown, field: string): number {
    if (!Number.isInteger(value) || Number(value) < 1) throw new BadRequestException(`${field} must be a positive integer.`);
    return Number(value);
  }

  private code(value: unknown, field: string): string {
    if (typeof value !== "string") throw new BadRequestException(`${field} is required.`);
    const normalized = value.trim().toUpperCase();
    if (!CODE.test(normalized)) throw new BadRequestException(`${field} is invalid.`);
    return normalized;
  }

  private text(value: unknown, field: string, max: number, required: boolean): string | undefined {
    if (value == null || value === "") {
      if (required) throw new BadRequestException(`${field} is required.`);
      return undefined;
    }
    if (typeof value !== "string") throw new BadRequestException(`${field} must be text.`);
    const normalized = value.trim();
    if (!normalized || normalized.length > max || /\p{Cc}/u.test(normalized)) throw new BadRequestException(`${field} is invalid.`);
    return normalized;
  }

  private digest(value: unknown): string {
    return createHash("sha256").update(JSON.stringify(value)).digest("hex");
  }

  private async decrypt(row: { algorithm: string; keyId: string; wrappedKey: string; iv: string; ciphertext: string }) {
    return this.envelope.decryptRecord<Record<string, unknown>>({
      version: 1,
      algorithm: row.algorithm as "AES-256-GCM",
      keyId: row.keyId,
      wrappedKey: row.wrappedKey,
      iv: row.iv,
      ciphertext: row.ciphertext,
    });
  }

  private envelopeData(envelope: EncryptedEnvelope) {
    return {
      algorithm: envelope.algorithm,
      keyId: envelope.keyId,
      wrappedKey: envelope.wrappedKey,
      iv: envelope.iv,
      ciphertext: envelope.ciphertext,
    };
  }
}
