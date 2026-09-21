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
import { normalizeIsoDate, normalizeRecurrence } from "../care-plan/care-plan.engine";
import { ClinicalEnvelopeService } from "../clinical/clinical-envelope.service";
import { ProviderCategoryCapabilityService } from "../providers/provider-category-capability.service";

const CARE_PLAN_CONSENT_VERSION = "care-plan-v1";
const ID_TOKEN = /^[A-Za-z0-9_.:-]{1,180}$/;
const CODE = /^[A-Z][A-Z0-9_]{1,79}$/;
const IDEMPOTENCY = /^[A-Za-z0-9_.:-]{1,120}$/;
const MAX_EXERCISES = 30;
const MAX_RESOURCES_PER_EXERCISE = 10;
const MAX_MATERIAL_CODES = 20;
const LOOKBACK_DAYS = 365;
const LOOKAHEAD_DAYS = 30;

type ResourceType = "DOCUMENT" | "CLINICAL_MEDIA";
type ApprovedResource = { type: ResourceType; id: string };
type PreparedExercise = {
  exerciseCode: string;
  label: string;
  instructions?: string;
  repetitions: number;
  sets: number;
  durationSeconds?: number;
  materialCodes: string[];
  approvedResources: ApprovedResource[];
  dueAt: Date | null;
  recurrence: Record<string, unknown> | null;
  envelope: EncryptedEnvelope;
};

type CreateHomeExercisePlanInput = {
  appointmentId?: unknown;
  idempotencyKey?: unknown;
  effectiveFrom?: unknown;
  reviewAt?: unknown;
  exercises?: unknown;
};

@Injectable()
export class HomeExercisePlanService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
    private readonly envelope: ClinicalEnvelopeService,
    private readonly capabilities: ProviderCategoryCapabilityService,
  ) {}

  async create(principal: AuthPrincipal, input: CreateHomeExercisePlanInput) {
    const context = await this.requirePhysiotherapyCapability(principal);
    const appointmentId = this.requiredId(input?.appointmentId, "appointmentId");
    const appointment = await this.requireAppointment(context.providerId, appointmentId);
    await this.requireCarePlanConsent(context.providerId, appointment.patientId, "WRITE");

    const idempotencyKey = this.idempotencyKey(input?.idempotencyKey);
    const effectiveFrom = input?.effectiveFrom == null
      ? new Date()
      : normalizeIsoDate(input.effectiveFrom, "effectiveFrom")!;
    const reviewAt = normalizeIsoDate(input?.reviewAt, "reviewAt", false);
    if (reviewAt && reviewAt <= effectiveFrom) {
      throw new BadRequestException("reviewAt must be after effectiveFrom.");
    }
    const rawExercises = this.exerciseArray(input?.exercises);
    const normalized = rawExercises.map((item, index) => this.normalizeExercise(item, index));
    await this.validateApprovedResources(
      appointment.patientId,
      context.providerId,
      normalized.flatMap((item) => item.approvedResources),
    );

    const digestInput = {
      appointmentId: appointment.id,
      effectiveFrom: effectiveFrom.toISOString(),
      reviewAt: reviewAt?.toISOString() ?? null,
      exercises: normalized.map((item) => ({
        exerciseCode: item.exerciseCode,
        label: item.label,
        instructions: item.instructions ?? null,
        repetitions: item.repetitions,
        sets: item.sets,
        durationSeconds: item.durationSeconds ?? null,
        materialCodes: item.materialCodes,
        approvedResources: item.approvedResources,
        dueAt: item.dueAt?.toISOString() ?? null,
        recurrence: item.recurrence,
      })),
    };
    const requestDigest = createHash("sha256").update(JSON.stringify(digestInput)).digest("hex");

    const existingByKey = await this.prisma.homeExercisePlan.findUnique({ where: { idempotencyKey } });
    if (existingByKey) {
      if (existingByKey.providerId !== context.providerId || existingByKey.requestDigest !== requestDigest) {
        throw new ConflictException("idempotencyKey was already used for a different home exercise plan.");
      }
      return this.presentExisting(existingByKey.id, "IDEMPOTENT_REPLAY");
    }
    const existingForAppointment = await this.prisma.homeExercisePlan.findUnique({
      where: { providerId_appointmentId: { providerId: context.providerId, appointmentId: appointment.id } },
    });
    if (existingForAppointment) {
      throw new ConflictException("A home exercise plan already exists for this physiotherapy appointment.");
    }

    const planEnvelope = await this.envelope.encryptRecord({
      schemaVersion: 1,
      kind: "HOME_EXERCISE_PLAN",
      title: "Home exercise programme",
      sourceAppointmentId: appointment.id,
      exerciseCount: normalized.length,
    });
    const prepared: PreparedExercise[] = await Promise.all(normalized.map(async (item) => ({
      ...item,
      envelope: await this.envelope.encryptRecord({
        schemaVersion: 1,
        kind: "EXERCISE",
        exerciseCode: item.exerciseCode,
        label: item.label,
        ...(item.instructions === undefined ? {} : { instructions: item.instructions }),
        repetitions: item.repetitions,
        sets: item.sets,
        ...(item.durationSeconds === undefined ? {} : { durationSeconds: item.durationSeconds }),
        materialCodes: item.materialCodes,
        approvedResources: item.approvedResources,
      }),
    })));

    const created = await this.prisma.$transaction(async (tx) => {
      const carePlan = await tx.carePlan.create({
        data: {
          patientId: appointment.patientId,
          ownerProviderId: context.providerId,
          status: "ACTIVE",
          version: 1,
          effectiveFrom,
          ...(reviewAt ? { reviewAt } : {}),
          createdByActorId: principal.accountId,
        },
      });
      await tx.carePlanRevision.create({
        data: {
          carePlanId: carePlan.id,
          version: 1,
          authorActorId: principal.accountId,
          ...this.envelopeData(planEnvelope),
        },
      });

      const tasks: Array<{ id: string; exerciseCode: string }> = [];
      for (const exercise of prepared) {
        const task = await tx.careTask.create({
          data: {
            carePlanId: carePlan.id,
            ownerProviderId: context.providerId,
            assigneeType: "PATIENT",
            status: "ACTIVE",
            version: 1,
            ...(exercise.dueAt ? { dueAt: exercise.dueAt } : {}),
            ...(exercise.recurrence ? { recurrence: exercise.recurrence as Prisma.InputJsonValue } : {}),
            ...this.envelopeData(exercise.envelope),
          },
        });
        tasks.push({ id: task.id, exerciseCode: exercise.exerciseCode });
      }

      const homePlan = await tx.homeExercisePlan.create({
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
      await this.audit.writeClinicalInTransaction(tx, {
        actorId: principal.accountId,
        action: "HOME_EXERCISE_PLAN_CREATED",
        objectType: "HOME_EXERCISE_PLAN",
        objectId: homePlan.id,
        purpose: "TREATMENT",
        result: "SUCCESS",
        metadata: {
          domain: "PHYSIOTHERAPY",
          providerId: context.providerId,
          patientId: appointment.patientId,
          resourceId: homePlan.id,
          resourceVersion: 1,
          carePlanId: carePlan.id,
          exerciseCount: tasks.length,
          decision: "ALLOW",
        },
      });
      return { homePlan, carePlan, tasks };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return {
      id: created.homePlan.id,
      patientId: created.homePlan.patientId,
      providerId: created.homePlan.providerId,
      appointmentId: created.homePlan.appointmentId,
      carePlanId: created.homePlan.carePlanId,
      status: created.homePlan.status,
      version: created.homePlan.version,
      effectiveFrom: created.carePlan.effectiveFrom,
      reviewAt: created.carePlan.reviewAt,
      exercises: created.tasks,
      patientTaskDelivery: "CARE_PLAN_TASKS",
      patientDeclaredCompliance: true,
      automatedClinicalInference: false,
    };
  }

  async list(principal: AuthPrincipal, patientId: string) {
    const context = await this.requirePhysiotherapyCapability(principal);
    const patient = this.requiredId(patientId, "patientId");
    await this.requireTreatmentRelationship(context.providerId, patient);
    await this.requireCarePlanConsent(context.providerId, patient, "READ");
    const rows = await this.prisma.homeExercisePlan.findMany({
      where: { providerId: context.providerId, patientId: patient },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    const items = [];
    for (const row of rows) items.push(await this.presentExisting(row.id, "TREATMENT_RELATIONSHIP"));
    await this.audit.writeClinical({
      actorId: principal.accountId,
      action: "HOME_EXERCISE_PLAN_LIST_READ",
      objectType: "PATIENT",
      objectId: patient,
      purpose: "TREATMENT",
      result: "SUCCESS",
      metadata: {
        domain: "PHYSIOTHERAPY",
        providerId: context.providerId,
        patientId: patient,
        itemCount: items.length,
        decision: "ALLOW",
      },
    });
    return { patientId: patient, items, automatedClinicalInference: false };
  }

  async compliance(principal: AuthPrincipal, planId: string) {
    const context = await this.requirePhysiotherapyCapability(principal);
    const id = this.requiredId(planId, "planId");
    const plan = await this.prisma.homeExercisePlan.findUnique({ where: { id } });
    if (!plan || plan.providerId !== context.providerId) throw new NotFoundException("Home exercise plan not found.");
    await this.requireTreatmentRelationship(context.providerId, plan.patientId);
    await this.requireCarePlanConsent(context.providerId, plan.patientId, "READ");
    const tasks = await this.prisma.careTask.findMany({
      where: { carePlanId: plan.carePlanId, assigneeType: "PATIENT" },
      orderBy: { createdAt: "asc" },
    });
    const taskIds = tasks.map((item) => item.id);
    const completions = taskIds.length === 0 ? [] : await this.prisma.careTaskCompletion.findMany({
      where: { taskId: { in: taskIds }, actorRole: "PATIENT" },
      orderBy: { occurredAt: "asc" },
      take: 1000,
    });
    const items = [];
    for (const task of tasks) {
      const payload = await this.decrypt(task);
      const events = completions.filter((item) => item.taskId === task.id);
      const done = events.filter((item) => item.outcome === "DONE").length;
      const omitted = events.filter((item) => item.outcome === "OMITTED").length;
      items.push({
        taskId: task.id,
        exerciseCode: typeof payload.exerciseCode === "string" ? payload.exerciseCode : null,
        label: typeof payload.label === "string" ? payload.label : null,
        declared: events.length,
        done,
        omitted,
        latest: events.length === 0 ? null : events[events.length - 1],
      });
    }
    await this.audit.writeClinical({
      actorId: principal.accountId,
      action: "HOME_EXERCISE_COMPLIANCE_READ",
      objectType: "HOME_EXERCISE_PLAN",
      objectId: plan.id,
      purpose: "TREATMENT",
      result: "SUCCESS",
      metadata: {
        domain: "PHYSIOTHERAPY",
        providerId: context.providerId,
        patientId: plan.patientId,
        resourceId: plan.id,
        exerciseCount: tasks.length,
        completionEventCount: completions.length,
        decision: "ALLOW",
      },
    });
    return {
      planId: plan.id,
      patientId: plan.patientId,
      declaredByPatientOnly: true,
      automatedClinicalInference: false,
      totals: {
        exercises: tasks.length,
        declarations: completions.length,
        done: completions.filter((item) => item.outcome === "DONE").length,
        omitted: completions.filter((item) => item.outcome === "OMITTED").length,
      },
      items,
    };
  }

  private async presentExisting(planId: string, accessBasis: string) {
    const row = await this.prisma.homeExercisePlan.findUnique({ where: { id: planId } });
    if (!row) throw new NotFoundException("Home exercise plan not found.");
    const carePlan = await this.prisma.carePlan.findUnique({
      where: { id: row.carePlanId },
      include: { revisions: { orderBy: { version: "desc" }, take: 1 } },
    });
    if (!carePlan) throw new ConflictException("Home exercise Care Plan is missing.");
    const tasks = await this.prisma.careTask.findMany({
      where: { carePlanId: row.carePlanId, assigneeType: "PATIENT" },
      orderBy: { createdAt: "asc" },
    });
    const exercises = [];
    for (const task of tasks) {
      exercises.push({
        taskId: task.id,
        status: task.status,
        dueAt: task.dueAt,
        recurrence: task.recurrence,
        data: await this.decrypt(task),
      });
    }
    return {
      id: row.id,
      patientId: row.patientId,
      providerId: row.providerId,
      appointmentId: row.appointmentId,
      carePlanId: row.carePlanId,
      status: row.status,
      version: row.version,
      effectiveFrom: carePlan.effectiveFrom,
      reviewAt: carePlan.reviewAt,
      exercises,
      accessBasis,
      patientTaskDelivery: "CARE_PLAN_TASKS",
      patientDeclaredCompliance: true,
      automatedClinicalInference: false,
    };
  }

  private async requirePhysiotherapyCapability(principal: AuthPrincipal) {
    const context = await this.capabilities.workspaceContext(principal);
    if (!context.clinicalOrderCapabilities.has("PHYSIOTHERAPY")) {
      throw new ForbiddenException("Other Provider category is not authorized for PHYSIOTHERAPY.");
    }
    return context;
  }

  private async requireAppointment(providerId: string, appointmentId: string) {
    const appointment = await this.prisma.appointment.findFirst({
      where: { id: appointmentId, providerId, status: { in: ["CONFIRMED", "COMPLETED"] } },
      select: { id: true, patientId: true, status: true, startsAt: true },
    });
    if (!appointment) throw new ForbiddenException("Authorized physiotherapy appointment context is required.");
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
    if (!relationship) throw new ForbiddenException("Current physiotherapy treatment relationship is required.");
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

  private exerciseArray(value: unknown): Record<string, unknown>[] {
    if (!Array.isArray(value) || value.length < 1 || value.length > MAX_EXERCISES) {
      throw new BadRequestException(`exercises must contain between 1 and ${MAX_EXERCISES} items.`);
    }
    return value.map((item, index) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        throw new BadRequestException(`exercises[${index}] must be an object.`);
      }
      return item as Record<string, unknown>;
    });
  }

  private normalizeExercise(raw: Record<string, unknown>, index: number) {
    const prefix = `exercises[${index}]`;
    const exerciseCode = this.code(raw.exerciseCode, `${prefix}.exerciseCode`);
    const label = this.text(raw.label, `${prefix}.label`, 240, true)!;
    const instructions = this.text(raw.instructions, `${prefix}.instructions`, 1600, false);
    const repetitions = this.integer(raw.repetitions, `${prefix}.repetitions`, 1, 1000);
    const sets = this.integer(raw.sets ?? 1, `${prefix}.sets`, 1, 100);
    const durationSeconds = raw.durationSeconds == null
      ? undefined
      : this.integer(raw.durationSeconds, `${prefix}.durationSeconds`, 1, 86400);
    const materialCodes = this.codeList(raw.materialCodes, `${prefix}.materialCodes`, MAX_MATERIAL_CODES);
    const approvedResources = this.resources(raw.approvedResources, `${prefix}.approvedResources`);
    const dueAt = normalizeIsoDate(raw.dueAt, `${prefix}.dueAt`, false);
    const recurrence = normalizeRecurrence(raw.recurrence);
    return {
      exerciseCode,
      label,
      ...(instructions === undefined ? {} : { instructions }),
      repetitions,
      sets,
      ...(durationSeconds === undefined ? {} : { durationSeconds }),
      materialCodes,
      approvedResources,
      dueAt,
      recurrence,
    };
  }

  private resources(value: unknown, field: string): ApprovedResource[] {
    if (value == null) return [];
    if (!Array.isArray(value) || value.length > MAX_RESOURCES_PER_EXERCISE) {
      throw new BadRequestException(`${field} must contain at most ${MAX_RESOURCES_PER_EXERCISE} resources.`);
    }
    const result: ApprovedResource[] = [];
    for (const raw of value) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new BadRequestException(`${field} entries must be objects.`);
      const item = raw as Record<string, unknown>;
      const type = typeof item.type === "string" ? item.type.trim().toUpperCase() : "";
      if (type !== "DOCUMENT" && type !== "CLINICAL_MEDIA") throw new BadRequestException(`${field}.type is invalid.`);
      const id = this.requiredId(item.id, `${field}.id`);
      result.push({ type, id });
    }
    const unique = new Map(result.map((item) => [`${item.type}:${item.id}`, item]));
    return [...unique.values()];
  }

  private async validateApprovedResources(patientId: string, providerId: string, resources: ApprovedResource[]) {
    const documents = [...new Set(resources.filter((item) => item.type === "DOCUMENT").map((item) => item.id))];
    const media = [...new Set(resources.filter((item) => item.type === "CLINICAL_MEDIA").map((item) => item.id))];
    if (documents.length > 0) {
      const rows = await this.prisma.clinicalDocument.findMany({
        where: { id: { in: documents }, patientId, status: "AVAILABLE", releasedToPatient: true },
        select: { id: true },
      });
      if (rows.length !== documents.length) throw new BadRequestException("Every DOCUMENT resource must be available and released to this patient.");
    }
    if (media.length > 0) {
      const rows = await this.prisma.clinicalMedia.findMany({
        where: { id: { in: media }, patientId, providerId, status: "AVAILABLE", purpose: "TREATMENT" },
        select: { id: true },
      });
      if (rows.length !== media.length) throw new BadRequestException("Every CLINICAL_MEDIA resource must be available treatment media owned by this physiotherapist and patient.");
    }
  }

  private requiredId(value: unknown, field: string): string {
    if (typeof value !== "string" || !ID_TOKEN.test(value.trim())) throw new BadRequestException(`${field} is invalid.`);
    return value.trim();
  }

  private idempotencyKey(value: unknown): string {
    if (typeof value !== "string" || !IDEMPOTENCY.test(value.trim())) throw new BadRequestException("idempotencyKey is invalid.");
    return value.trim();
  }

  private code(value: unknown, field: string): string {
    if (typeof value !== "string") throw new BadRequestException(`${field} is required.`);
    const normalized = value.trim().toUpperCase();
    if (!CODE.test(normalized)) throw new BadRequestException(`${field} is invalid.`);
    return normalized;
  }

  private codeList(value: unknown, field: string, max: number): string[] {
    if (value == null) return [];
    if (!Array.isArray(value) || value.length > max) throw new BadRequestException(`${field} must contain at most ${max} codes.`);
    return [...new Set(value.map((item) => this.code(item, field)))];
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

  private integer(value: unknown, field: string, min: number, max: number): number {
    if (!Number.isInteger(value) || Number(value) < min || Number(value) > max) {
      throw new BadRequestException(`${field} must be an integer between ${min} and ${max}.`);
    }
    return Number(value);
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
