import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { decideClinicalResourceAccess, type AuthPrincipal } from "@carepoint/identity";
import type { EncryptedEnvelope } from "@carepoint/security";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { ClinicalEnvelopeService } from "../clinical/clinical-envelope.service";
import {
  normalizeGoalPayload,
  normalizeGoalStatus,
  normalizeIsoDate,
  normalizeMetricCode,
  normalizeOccurrenceKey,
  normalizePlanPayload,
  normalizePlanStatus,
  normalizeReasonCode,
  normalizeRecurrence,
  normalizeTaskAssignee,
  normalizeTaskOutcome,
  normalizeTaskPayload,
} from "./care-plan.engine";

const CARE_PLAN_CONSENT_VERSION = "care-plan-v1";
const TREATMENT_LOOKBACK_DAYS = 365;
const TREATMENT_LOOKAHEAD_DAYS = 30;
const MAX_ITEMS = 250;

type EnvelopeRow = { algorithm: string; keyId: string; wrappedKey: string; iv: string; ciphertext: string };

type CreateGoalInput = {
  metricCode?: string | null;
  periodStart: string;
  periodEnd?: string | null;
  data: unknown;
};

type CreateTaskInput = {
  assigneeType: "PATIENT" | "PROVIDER";
  dueAt?: string | null;
  recurrence?: unknown;
  data: unknown;
};

export interface CreateCarePlanInput {
  effectiveFrom: string;
  effectiveUntil?: string | null;
  reviewAt?: string | null;
  data: unknown;
  goals?: CreateGoalInput[];
  tasks?: CreateTaskInput[];
}

export interface UpdateCarePlanInput {
  expectedVersion: number;
  status?: string;
  effectiveUntil?: string | null;
  reviewAt?: string | null;
  reasonCode?: string | null;
  data?: unknown;
}

export interface UpdateGoalInput {
  expectedVersion: number;
  status?: string;
  periodEnd?: string | null;
  reasonCode?: string | null;
  data?: unknown;
}

export interface TaskCompletionInput {
  occurrenceKey: string;
  outcome: string;
  reasonCode?: string | null;
}

@Injectable()
export class CarePlanService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
    private readonly envelope: ClinicalEnvelopeService,
  ) {}

  async createForDoctor(principal: AuthPrincipal, patientId: string, input: CreateCarePlanInput) {
    const access = await this.requireDoctorAccess(principal, patientId, "WRITE");
    const effectiveFrom = normalizeIsoDate(input?.effectiveFrom, "effectiveFrom")!;
    const effectiveUntil = normalizeIsoDate(input?.effectiveUntil, "effectiveUntil", false);
    const reviewAt = normalizeIsoDate(input?.reviewAt, "reviewAt", false);
    if (effectiveUntil && effectiveUntil <= effectiveFrom) throw new BadRequestException("effectiveUntil must be after effectiveFrom.");
    const goals = input?.goals ?? [];
    const tasks = input?.tasks ?? [];
    if (!Array.isArray(goals) || !Array.isArray(tasks) || goals.length + tasks.length === 0) {
      throw new BadRequestException("A Care Plan requires at least one goal or task.");
    }
    const planPayload = normalizePlanPayload(input?.data);
    const planEnvelope = await this.envelope.encryptRecord({ schemaVersion: 1, ...planPayload });
    const preparedGoals = await Promise.all(goals.map(async (goal) => this.prepareGoal(goal)));
    const preparedTasks = await Promise.all(tasks.map(async (task) => this.prepareTask(task)));

    const result = await this.prisma.$transaction(async (tx) => {
      const plan = await tx.carePlan.create({
        data: {
          patientId,
          ownerProviderId: access.provider.id,
          status: "ACTIVE",
          version: 1,
          effectiveFrom,
          ...(effectiveUntil ? { effectiveUntil } : {}),
          ...(reviewAt ? { reviewAt } : {}),
          createdByActorId: principal.accountId,
        },
      });
      const revision = await tx.carePlanRevision.create({
        data: {
          carePlanId: plan.id,
          version: 1,
          authorActorId: principal.accountId,
          ...this.envelopeData(planEnvelope),
        },
      });
      for (const goal of preparedGoals) {
        const created = await tx.carePlanGoal.create({
          data: {
            carePlanId: plan.id,
            ownerProviderId: access.provider.id,
            metricCode: goal.metricCode,
            status: "ACTIVE",
            version: 1,
            periodStart: goal.periodStart,
            ...(goal.periodEnd ? { periodEnd: goal.periodEnd } : {}),
            ...this.envelopeData(goal.envelope),
          },
        });
        await tx.carePlanGoalRevision.create({
          data: {
            goalId: created.id,
            version: 1,
            authorActorId: principal.accountId,
            ...this.envelopeData(goal.envelope),
          },
        });
      }
      for (const task of preparedTasks) {
        await tx.careTask.create({
          data: {
            carePlanId: plan.id,
            ownerProviderId: access.provider.id,
            assigneeType: task.assigneeType,
            status: "ACTIVE",
            version: 1,
            ...(task.dueAt ? { dueAt: task.dueAt } : {}),
            ...(task.recurrence ? { recurrence: task.recurrence as Prisma.InputJsonValue } : {}),
            ...this.envelopeData(task.envelope),
          },
        });
      }
      await this.audit.writeClinicalInTransaction(tx, {
        actorId: principal.accountId,
        action: "CARE_PLAN_CREATED",
        objectType: "CARE_PLAN",
        objectId: plan.id,
        purpose: "TREATMENT",
        result: "SUCCESS",
        metadata: {
          domain: "CARE_PLAN",
          patientId,
          providerId: access.provider.id,
          resourceId: plan.id,
          resourceVersion: 1,
          itemCount: preparedGoals.length + preparedTasks.length,
          decision: "ALLOW",
        },
      });
      return { plan, revision };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return this.presentPlan(result.plan, planPayload, access.basis);
  }

  async listMine(principal: AuthPrincipal) {
    const patient = await this.requirePatient(principal);
    const now = new Date();
    const rows = await this.prisma.carePlan.findMany({
      where: {
        patientId: patient.id,
        status: { in: ["ACTIVE", "PAUSED"] },
        effectiveFrom: { lte: now },
        AND: [{ OR: [{ effectiveUntil: null }, { effectiveUntil: { gte: now } }] }],
      },
      include: { revisions: { orderBy: { version: "desc" }, take: 1 } },
      orderBy: [{ reviewAt: "asc" }, { createdAt: "desc" }],
      take: MAX_ITEMS,
    });
    const items = [];
    for (const row of rows) {
      const revision = row.revisions[0];
      if (!revision) continue;
      items.push(this.presentPlan(row, await this.decrypt(revision), "PATIENT_SELF"));
    }
    return { patientId: patient.id, items };
  }

  async patientGoals(principal: AuthPrincipal, carePlanId: string) {
    const { patient, plan } = await this.patientPlan(principal, carePlanId);
    const rows = await this.prisma.carePlanGoal.findMany({
      where: { carePlanId: plan.id, status: { in: ["ACTIVE", "ACHIEVED"] } },
      orderBy: [{ status: "asc" }, { periodStart: "asc" }],
      take: MAX_ITEMS,
    });
    const items = [];
    for (const row of rows) items.push(this.presentGoal(row, await this.decrypt(row), "PATIENT_SELF"));
    return { patientId: patient.id, carePlanId: plan.id, items };
  }

  async patientTasks(principal: AuthPrincipal, carePlanId: string) {
    const { patient, plan } = await this.patientPlan(principal, carePlanId);
    const rows = await this.prisma.careTask.findMany({
      where: { carePlanId: plan.id, assigneeType: "PATIENT", status: { in: ["ACTIVE", "PAUSED"] } },
      orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }],
      take: MAX_ITEMS,
    });
    const items = [];
    for (const row of rows) items.push(this.presentTask(row, await this.decrypt(row), "PATIENT_SELF"));
    return { patientId: patient.id, carePlanId: plan.id, items };
  }

  async completePatientTask(principal: AuthPrincipal, taskId: string, input: TaskCompletionInput) {
    const patient = await this.requirePatient(principal);
    const task = await this.prisma.careTask.findUnique({ where: { id: taskId } });
    if (!task || task.assigneeType !== "PATIENT" || task.status !== "ACTIVE") throw new NotFoundException("Active patient Care Task not found.");
    const plan = await this.prisma.carePlan.findUnique({ where: { id: task.carePlanId } });
    if (!plan || plan.patientId !== patient.id || !["ACTIVE", "PAUSED"].includes(plan.status)) throw new ForbiddenException("Care Task access denied.");
    const occurrenceKey = normalizeOccurrenceKey(input?.occurrenceKey);
    const outcome = normalizeTaskOutcome(input?.outcome);
    const reasonCode = normalizeReasonCode(input?.reasonCode);
    const existing = await this.prisma.careTaskCompletion.findUnique({
      where: { taskId_occurrenceKey: { taskId: task.id, occurrenceKey } },
    });
    if (existing) return existing;
    try {
      const completion = await this.prisma.$transaction(async (tx) => {
        const created = await tx.careTaskCompletion.create({
          data: {
            taskId: task.id,
            occurrenceKey,
            outcome,
            ...(reasonCode ? { reasonCode } : {}),
            actorId: principal.accountId,
            actorRole: principal.role,
          },
        });
        await this.audit.writeClinicalInTransaction(tx, {
          actorId: principal.accountId,
          action: "CARE_TASK_COMPLETED",
          objectType: "CARE_TASK",
          objectId: task.id,
          purpose: "PATIENT_ACCESS",
          result: "SUCCESS",
          metadata: {
            domain: "CARE_PLAN",
            patientId: patient.id,
            resourceId: task.id,
            decision: "ALLOW",
          },
        });
        return created;
      });
      return completion;
    } catch (error) {
      if (!this.isUniqueConflict(error)) throw error;
      return this.prisma.careTaskCompletion.findUniqueOrThrow({
        where: { taskId_occurrenceKey: { taskId: task.id, occurrenceKey } },
      });
    }
  }

  async providerList(principal: AuthPrincipal, patientId: string) {
    const access = await this.requireDoctorAccess(principal, patientId, "READ");
    const rows = await this.prisma.carePlan.findMany({
      where: { patientId },
      include: { revisions: { orderBy: { version: "desc" }, take: 1 } },
      orderBy: { updatedAt: "desc" },
      take: MAX_ITEMS,
    });
    const items = [];
    for (const row of rows) {
      const revision = row.revisions[0];
      if (!revision) continue;
      items.push(this.presentPlan(row, await this.decrypt(revision), access.basis));
    }
    return { patientId, accessBasis: access.basis, items };
  }

  async updatePlan(principal: AuthPrincipal, carePlanId: string, input: UpdateCarePlanInput) {
    const row = await this.prisma.carePlan.findUnique({
      where: { id: carePlanId },
      include: { revisions: { orderBy: { version: "desc" }, take: 1 } },
    });
    if (!row) throw new NotFoundException("Care Plan not found.");
    const access = await this.requireDoctorAccess(principal, row.patientId, "WRITE");
    this.requireOwner(row.ownerProviderId, access.provider.id);
    const expectedVersion = this.positiveInteger(input?.expectedVersion, "expectedVersion");
    if (row.version !== expectedVersion) throw new ConflictException({ message: "Care Plan version conflict.", currentVersion: row.version });
    const currentRevision = row.revisions[0];
    if (!currentRevision) throw new ConflictException("Care Plan revision is missing.");
    const currentPayload = await this.decrypt(currentRevision);
    const payload = input?.data === undefined ? currentPayload : normalizePlanPayload(input.data);
    const encrypted = await this.envelope.encryptRecord({ schemaVersion: 1, ...payload });
    const status = input?.status === undefined ? row.status : normalizePlanStatus(input.status);
    const effectiveUntil = input?.effectiveUntil === undefined ? row.effectiveUntil : normalizeIsoDate(input.effectiveUntil, "effectiveUntil", false);
    const reviewAt = input?.reviewAt === undefined ? row.reviewAt : normalizeIsoDate(input.reviewAt, "reviewAt", false);
    const reasonCode = normalizeReasonCode(input?.reasonCode);
    const nextVersion = expectedVersion + 1;

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "CarePlan" WHERE id = ${row.id} FOR UPDATE`);
      const current = await tx.carePlan.findUnique({ where: { id: row.id } });
      if (!current || current.version !== expectedVersion) throw new ConflictException({ message: "Care Plan version conflict.", currentVersion: current?.version ?? null });
      const plan = await tx.carePlan.update({
        where: { id: row.id },
        data: {
          version: nextVersion,
          status,
          effectiveUntil,
          reviewAt,
        },
      });
      await tx.carePlanRevision.create({
        data: {
          carePlanId: plan.id,
          version: nextVersion,
          authorActorId: principal.accountId,
          ...(reasonCode ? { reasonCode } : {}),
          ...this.envelopeData(encrypted),
        },
      });
      await this.audit.writeClinicalInTransaction(tx, {
        actorId: principal.accountId,
        action: "CARE_PLAN_UPDATED",
        objectType: "CARE_PLAN",
        objectId: plan.id,
        purpose: "TREATMENT",
        result: "SUCCESS",
        metadata: {
          domain: "CARE_PLAN",
          patientId: plan.patientId,
          providerId: access.provider.id,
          resourceId: plan.id,
          resourceVersion: nextVersion,
          decision: "ALLOW",
        },
      });
      return plan;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return this.presentPlan(updated, payload, access.basis);
  }

  async addGoal(principal: AuthPrincipal, carePlanId: string, input: CreateGoalInput) {
    const plan = await this.requireOwnedPlan(principal, carePlanId);
    const prepared = await this.prepareGoal(input);
    const goal = await this.prisma.$transaction(async (tx) => {
      const created = await tx.carePlanGoal.create({
        data: {
          carePlanId: plan.plan.id,
          ownerProviderId: plan.provider.id,
          metricCode: prepared.metricCode,
          status: "ACTIVE",
          version: 1,
          periodStart: prepared.periodStart,
          ...(prepared.periodEnd ? { periodEnd: prepared.periodEnd } : {}),
          ...this.envelopeData(prepared.envelope),
        },
      });
      await tx.carePlanGoalRevision.create({
        data: {
          goalId: created.id,
          version: 1,
          authorActorId: principal.accountId,
          ...this.envelopeData(prepared.envelope),
        },
      });
      return created;
    });
    return this.presentGoal(goal, prepared.payload, plan.basis);
  }

  async updateGoal(principal: AuthPrincipal, carePlanId: string, goalId: string, input: UpdateGoalInput) {
    const owned = await this.requireOwnedPlan(principal, carePlanId);
    const goal = await this.prisma.carePlanGoal.findFirst({ where: { id: goalId, carePlanId } });
    if (!goal) throw new NotFoundException("Care Plan Goal not found.");
    const expectedVersion = this.positiveInteger(input?.expectedVersion, "expectedVersion");
    if (goal.version !== expectedVersion) throw new ConflictException({ message: "Care Plan Goal version conflict.", currentVersion: goal.version });
    const currentPayload = await this.decrypt(goal);
    const payload = input?.data === undefined ? currentPayload : normalizeGoalPayload(input.data);
    const encrypted = await this.envelope.encryptRecord({ schemaVersion: 1, ...payload });
    const status = input?.status === undefined ? goal.status : normalizeGoalStatus(input.status);
    const periodEnd = input?.periodEnd === undefined ? goal.periodEnd : normalizeIsoDate(input.periodEnd, "periodEnd", false);
    const reasonCode = normalizeReasonCode(input?.reasonCode);
    const nextVersion = expectedVersion + 1;
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "CarePlanGoal" WHERE id = ${goal.id} FOR UPDATE`);
      const current = await tx.carePlanGoal.findUnique({ where: { id: goal.id } });
      if (!current || current.version !== expectedVersion) throw new ConflictException({ message: "Care Plan Goal version conflict.", currentVersion: current?.version ?? null });
      const row = await tx.carePlanGoal.update({
        where: { id: goal.id },
        data: { version: nextVersion, status, periodEnd, ...this.envelopeData(encrypted) },
      });
      await tx.carePlanGoalRevision.create({
        data: {
          goalId: goal.id,
          version: nextVersion,
          authorActorId: principal.accountId,
          ...(reasonCode ? { reasonCode } : {}),
          ...this.envelopeData(encrypted),
        },
      });
      return row;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return this.presentGoal(updated, payload, owned.basis);
  }

  async addTask(principal: AuthPrincipal, carePlanId: string, input: CreateTaskInput) {
    const owned = await this.requireOwnedPlan(principal, carePlanId);
    const prepared = await this.prepareTask(input);
    const task = await this.prisma.careTask.create({
      data: {
        carePlanId: owned.plan.id,
        ownerProviderId: owned.provider.id,
        assigneeType: prepared.assigneeType,
        status: "ACTIVE",
        version: 1,
        ...(prepared.dueAt ? { dueAt: prepared.dueAt } : {}),
        ...(prepared.recurrence ? { recurrence: prepared.recurrence as Prisma.InputJsonValue } : {}),
        ...this.envelopeData(prepared.envelope),
      },
    });
    return this.presentTask(task, prepared.payload, owned.basis);
  }

  async progress(principal: AuthPrincipal, carePlanId: string, fromRaw?: string, toRaw?: string) {
    const owned = await this.requireReadablePlan(principal, carePlanId);
    const from = fromRaw ? normalizeIsoDate(fromRaw, "from")! : owned.plan.effectiveFrom;
    const to = toRaw ? normalizeIsoDate(toRaw, "to")! : new Date();
    if (to < from) throw new BadRequestException("to must be on or after from.");
    const [tasks, goals] = await Promise.all([
      this.prisma.careTask.findMany({ where: { carePlanId }, select: { id: true, status: true } }),
      this.prisma.carePlanGoal.findMany({ where: { carePlanId }, select: { id: true, status: true, metricCode: true } }),
    ]);
    const taskIds = tasks.map((task) => task.id);
    const completions = taskIds.length === 0 ? [] : await this.prisma.careTaskCompletion.findMany({
      where: { taskId: { in: taskIds }, occurredAt: { gte: from, lte: to } },
      orderBy: { occurredAt: "asc" },
    });
    const observationSummaries = [];
    for (const metricCode of [...new Set(goals.map((goal) => goal.metricCode).filter((value): value is string => Boolean(value)))]) {
      const type = await this.prisma.observationType.findUnique({ where: { code: metricCode }, select: { id: true } });
      if (!type) {
        observationSummaries.push({ metricCode, count: 0, latestObservedAt: null });
        continue;
      }
      const [count, latest] = await Promise.all([
        this.prisma.observation.count({ where: { patientId: owned.plan.patientId, observationTypeId: type.id, observedAt: { gte: from, lte: to } } }),
        this.prisma.observation.findFirst({ where: { patientId: owned.plan.patientId, observationTypeId: type.id, observedAt: { gte: from, lte: to } }, orderBy: { observedAt: "desc" }, select: { observedAt: true } }),
      ]);
      observationSummaries.push({ metricCode, count, latestObservedAt: latest?.observedAt ?? null });
    }
    return {
      carePlanId,
      patientId: owned.plan.patientId,
      period: { from, to },
      tasks: {
        totalDefinitions: tasks.length,
        completionEvents: completions.length,
        done: completions.filter((item) => item.outcome === "DONE").length,
        omitted: completions.filter((item) => item.outcome === "OMITTED").length,
      },
      goals: {
        total: goals.length,
        active: goals.filter((item) => item.status === "ACTIVE").length,
        achieved: goals.filter((item) => item.status === "ACHIEVED").length,
        observations: observationSummaries,
      },
      automatedClinicalInference: false,
    };
  }

  private async prepareGoal(input: CreateGoalInput) {
    const periodStart = normalizeIsoDate(input?.periodStart, "periodStart")!;
    const periodEnd = normalizeIsoDate(input?.periodEnd, "periodEnd", false);
    if (periodEnd && periodEnd <= periodStart) throw new BadRequestException("periodEnd must be after periodStart.");
    const metricCode = normalizeMetricCode(input?.metricCode);
    const payload = normalizeGoalPayload(input?.data);
    if ((payload as { kind?: string }).kind === "MEASURABLE" && !metricCode) throw new BadRequestException("MEASURABLE goals require metricCode.");
    if (metricCode) {
      const metric = await this.prisma.observationType.findUnique({ where: { code: metricCode }, select: { id: true, active: true } });
      if (!metric?.active) throw new BadRequestException("An active ObservationType is required for metricCode.");
    }
    const envelope = await this.envelope.encryptRecord({ schemaVersion: 1, ...payload });
    return { periodStart, periodEnd, metricCode, payload, envelope };
  }

  private async prepareTask(input: CreateTaskInput) {
    const assigneeType = normalizeTaskAssignee(input?.assigneeType);
    const dueAt = normalizeIsoDate(input?.dueAt, "dueAt", false);
    const recurrence = normalizeRecurrence(input?.recurrence);
    const payload = normalizeTaskPayload(input?.data);
    const envelope = await this.envelope.encryptRecord({ schemaVersion: 1, ...payload });
    return { assigneeType, dueAt, recurrence, payload, envelope };
  }

  private async patientPlan(principal: AuthPrincipal, carePlanId: string) {
    const patient = await this.requirePatient(principal);
    const plan = await this.prisma.carePlan.findUnique({ where: { id: carePlanId } });
    if (!plan || plan.patientId !== patient.id || plan.status === "CLOSED") throw new NotFoundException("Care Plan not found.");
    return { patient, plan };
  }

  private async requireOwnedPlan(principal: AuthPrincipal, carePlanId: string) {
    const plan = await this.prisma.carePlan.findUnique({ where: { id: carePlanId } });
    if (!plan) throw new NotFoundException("Care Plan not found.");
    const access = await this.requireDoctorAccess(principal, plan.patientId, "WRITE");
    this.requireOwner(plan.ownerProviderId, access.provider.id);
    return { plan, provider: access.provider, basis: access.basis };
  }

  private async requireReadablePlan(principal: AuthPrincipal, carePlanId: string) {
    const plan = await this.prisma.carePlan.findUnique({ where: { id: carePlanId } });
    if (!plan) throw new NotFoundException("Care Plan not found.");
    const access = await this.requireDoctorAccess(principal, plan.patientId, "READ");
    return { plan, provider: access.provider, basis: access.basis };
  }

  private async requireDoctorAccess(principal: AuthPrincipal, patientId: string, action: "READ" | "WRITE") {
    if (principal.role !== "DOCTOR") throw new ForbiddenException("Care Plan clinician access requires DOCTOR role.");
    const provider = await this.prisma.provider.findUnique({
      where: { userId: principal.accountId },
      select: { id: true, class: true, status: true },
    });
    if (!provider || provider.class !== "DOCTOR" || provider.status !== "ACTIVE") throw new ForbiddenException("An active doctor provider profile is required.");
    const patient = await this.prisma.patientProfile.findUnique({ where: { id: patientId }, select: { id: true } });
    if (!patient) throw new NotFoundException("Patient not found.");
    const now = new Date();
    const from = new Date(now.getTime() - TREATMENT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    const to = new Date(now.getTime() + TREATMENT_LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000);
    const scopes = action === "WRITE" ? ["CARE_PLAN_WRITE"] : ["CARE_PLAN_READ", "CARE_PLAN_WRITE"];
    const [relationship, consent] = await Promise.all([
      this.prisma.appointment.findFirst({
        where: { providerId: provider.id, patientId, status: { in: ["CONFIRMED", "COMPLETED"] }, startsAt: { gte: from, lte: to } },
        select: { id: true },
      }),
      this.prisma.consent.findFirst({
        where: {
          patientId,
          scope: { in: scopes },
          version: CARE_PLAN_CONSENT_VERSION,
          purpose: "TREATMENT",
          state: "GRANTED",
          AND: [{ OR: [{ providerId: provider.id }, { providerId: null }] }, { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }],
        },
        select: { id: true },
        orderBy: { grantedAt: "desc" },
      }),
    ]);
    const decision = decideClinicalResourceAccess({
      principal,
      action,
      providerActive: true,
      capabilityAllowed: true,
      purpose: "TREATMENT",
      allowedPurposes: ["TREATMENT"],
      withinAccessWindow: Boolean(relationship),
      sensitivityAllowed: true,
      isAssignedProvider: action === "WRITE" && Boolean(relationship),
      hasTreatmentRelationship: Boolean(relationship),
      hasPatientConsent: Boolean(consent),
    });
    if (!relationship || !consent || !decision.allowed) throw new ForbiddenException("Care Plan access denied.");
    return { provider, basis: action === "WRITE" ? "TREATMENT_RELATIONSHIP" : decision.basis };
  }

  private async requirePatient(principal: AuthPrincipal) {
    if (principal.role !== "PATIENT") throw new ForbiddenException("Patient Care Plan access requires PATIENT role.");
    const patient = await this.prisma.patientProfile.findUnique({ where: { userId: principal.accountId }, select: { id: true } });
    if (!patient) throw new NotFoundException("Patient profile not found.");
    return patient;
  }

  private requireOwner(ownerProviderId: string, providerId: string) {
    if (ownerProviderId !== providerId) throw new ForbiddenException("Only the responsible clinician can modify this Care Plan.");
  }

  private async decrypt(row: EnvelopeRow) {
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
    return { algorithm: envelope.algorithm, keyId: envelope.keyId, wrappedKey: envelope.wrappedKey, iv: envelope.iv, ciphertext: envelope.ciphertext };
  }

  private presentPlan(row: any, payload: Record<string, unknown>, accessBasis: string) {
    return {
      id: row.id,
      patientId: row.patientId,
      responsibleProviderId: row.ownerProviderId,
      status: row.status,
      version: row.version,
      effectiveFrom: row.effectiveFrom,
      effectiveUntil: row.effectiveUntil,
      reviewAt: row.reviewAt,
      data: payload,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      accessBasis,
    };
  }

  private presentGoal(row: any, payload: Record<string, unknown>, accessBasis: string) {
    return {
      id: row.id,
      carePlanId: row.carePlanId,
      status: row.status,
      version: row.version,
      metricCode: row.metricCode,
      periodStart: row.periodStart,
      periodEnd: row.periodEnd,
      data: payload,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      accessBasis,
      automatedClinicalInference: false,
    };
  }

  private presentTask(row: any, payload: Record<string, unknown>, accessBasis: string) {
    return {
      id: row.id,
      carePlanId: row.carePlanId,
      assigneeType: row.assigneeType,
      status: row.status,
      version: row.version,
      dueAt: row.dueAt,
      recurrence: row.recurrence,
      data: payload,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      accessBasis,
    };
  }

  private positiveInteger(value: unknown, field: string): number {
    if (!Number.isInteger(value) || Number(value) < 1) throw new BadRequestException(`${field} must be a positive integer.`);
    return Number(value);
  }

  private isUniqueConflict(error: unknown): boolean {
    return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "P2002";
  }
}
