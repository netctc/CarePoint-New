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
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { ClinicalEnvelopeService } from "../clinical/clinical-envelope.service";
import { NotificationsService } from "../communications/notifications.service";
import {
  diffQuestionnaireAnswers,
  normalizeQuestionnaireAnswers,
  normalizeQuestionnaireSchema,
} from "../questionnaire/questionnaire.engine";

const MAX_REQUEST_DAYS = 30;
const CONTEXTS = new Set(["PRE_VISIT", "POST_VISIT", "FOLLOW_UP"]);

type RequestContext = "PRE_VISIT" | "POST_VISIT" | "FOLLOW_UP";
type StoredResponse = {
  schemaVersion: 1;
  questionnaireCode: string;
  questionnaireVersion: number;
  healthChanged: boolean | null;
  answers: Record<string, unknown>;
};

export interface CreateQuestionnaireRequestInput {
  questionnaireCode: string;
  appointmentId: string;
  context: RequestContext;
  dueAt: string;
  idempotencyKey: string;
}

export interface SubmitRequestedQuestionnaireInput {
  expectedLatestSequence: number;
  answers: unknown;
  healthChanged?: boolean | null;
}

@Injectable()
export class QuestionnaireRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
    private readonly envelope: ClinicalEnvelopeService,
    private readonly notifications: NotificationsService,
  ) {}

  async available(principal: AuthPrincipal, patientId: string, appointmentId: string) {
    const doctor = await this.requireDoctor(principal);
    await this.requireAppointment(doctor.id, patientId, appointmentId);
    const versions = await this.prisma.questionnaireVersion.findMany({
      where: { status: "ACTIVE", questionnaire: { active: true } },
      include: { questionnaire: true },
      orderBy: [{ questionnaire: { code: "asc" } }, { version: "desc" }],
    });
    const seen = new Set<string>();
    const items = [];
    for (const version of versions) {
      if (seen.has(version.questionnaireId)) continue;
      seen.add(version.questionnaireId);
      items.push({
        questionnaireId: version.questionnaireId,
        questionnaireVersionId: version.id,
        code: version.questionnaire.code,
        labels: version.questionnaire.labels,
        descriptionLabels: version.questionnaire.descriptionLabels,
        version: version.version,
      });
    }
    return { patientId, appointmentId, items };
  }

  async doctorList(principal: AuthPrincipal, patientId: string) {
    const doctor = await this.requireDoctor(principal);
    await this.requireTreatmentRelationship(doctor.id, patientId);
    const rows = await this.prisma.questionnaireRequest.findMany({
      where: { providerId: doctor.id, patientId },
      orderBy: { requestedAt: "desc" },
      take: 250,
    });
    return { patientId, items: await this.presentRequests(rows) };
  }

  async create(principal: AuthPrincipal, patientId: string, input: CreateQuestionnaireRequestInput) {
    const doctor = await this.requireDoctor(principal);
    const appointmentId = this.id(input?.appointmentId, "appointmentId");
    const appointment = await this.requireAppointment(doctor.id, patientId, appointmentId);
    const context = this.context(input?.context);
    const dueAt = this.due(input?.dueAt);
    this.assertContext(appointment, context, dueAt);
    const code = this.code(input?.questionnaireCode);
    const idempotencyKey = this.idempotency(input?.idempotencyKey);

    const version = await this.prisma.questionnaireVersion.findFirst({
      where: {
        status: "ACTIVE",
        questionnaire: { code, active: true },
      },
      include: { questionnaire: true },
      orderBy: { version: "desc" },
    });
    if (!version) throw new NotFoundException("Active questionnaire template not found.");

    const existing = await this.prisma.questionnaireRequest.findUnique({ where: { idempotencyKey } });
    if (existing) {
      if (
        existing.patientId !== patientId ||
        existing.providerId !== doctor.id ||
        existing.appointmentId !== appointmentId ||
        existing.questionnaireVersionId !== version.id
      ) {
        throw new ConflictException("idempotencyKey is bound to another questionnaire request.");
      }
      return (await this.presentRequests([existing]))[0];
    }

    const patient = await this.prisma.patientProfile.findUnique({
      where: { id: patientId },
      select: { id: true, userId: true },
    });
    if (!patient) throw new NotFoundException("Patient not found.");

    const created = await this.prisma.$transaction(async (tx) => {
      await this.audit.reserveIntegrityChainForSerializableTransaction(tx);
      const request = await tx.questionnaireRequest.create({
        data: {
          idempotencyKey,
          patientId,
          providerId: doctor.id,
          questionnaireId: version.questionnaireId,
          questionnaireVersionId: version.id,
          appointmentId,
          context,
          dueAt,
          requestedByActorId: principal.accountId,
        },
      });
      await this.audit.writeClinicalInTransaction(tx, {
        actorId: principal.accountId,
        action: "QUESTIONNAIRE_REQUEST_CREATED",
        objectType: "QUESTIONNAIRE_REQUEST",
        objectId: request.id,
        purpose: "TREATMENT",
        result: "SUCCESS",
        metadata: {
          domain: "QUESTIONNAIRE_REQUEST",
          patientId,
          providerId: doctor.id,
          appointmentId,
          resourceId: request.id,
          resourceVersion: version.version,
          requestContext: context,
          decision: "ALLOW",
        },
      });
      await this.notifications.enqueueAccountInTransaction(tx, {
        accountId: patient.userId,
        dedupeKey: `questionnaire-request:${request.id}`,
        type: "CARE_COORDINATION",
        entityType: "QUESTIONNAIRE_REQUEST",
        entityId: request.id,
        safeTitleKey: "questionnaire.requested.title",
        safeBodyKey: "questionnaire.requested.body",
      });
      return request;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    this.notifications.wakeOutbox();
    return (await this.presentRequests([created]))[0];
  }

  async patientDue(principal: AuthPrincipal) {
    const patient = await this.requirePatient(principal);
    const now = new Date();
    const rows = await this.prisma.questionnaireRequest.findMany({
      where: { patientId: patient.id, status: "REQUESTED", dueAt: { gt: now } },
      orderBy: [{ dueAt: "asc" }, { requestedAt: "asc" }],
      take: 100,
    });
    if (rows.length === 0) return { patientId: patient.id, items: [] };

    const questionnaireIds = [...new Set(rows.map((item) => item.questionnaireId))];
    const versionIds = [...new Set(rows.map((item) => item.questionnaireVersionId))];
    const [definitions, versions, responses] = await Promise.all([
      this.prisma.questionnaireDefinition.findMany({ where: { id: { in: questionnaireIds } } }),
      this.prisma.questionnaireVersion.findMany({ where: { id: { in: versionIds } } }),
      this.prisma.questionnaireResponse.findMany({
        where: { patientId: patient.id, questionnaireId: { in: questionnaireIds } },
        select: { questionnaireId: true, sequence: true },
        orderBy: { sequence: "desc" },
      }),
    ]);
    const definitionsById = new Map(definitions.map((item) => [item.id, item]));
    const versionsById = new Map(versions.map((item) => [item.id, item]));
    const latestSequence = new Map<string, number>();
    for (const response of responses) {
      if (!latestSequence.has(response.questionnaireId)) latestSequence.set(response.questionnaireId, response.sequence);
    }

    const items = rows.flatMap((request) => {
      const definition = definitionsById.get(request.questionnaireId);
      const version = versionsById.get(request.questionnaireVersionId);
      if (!definition || !version) return [];
      return [{
        id: request.id,
        appointmentId: request.appointmentId,
        context: request.context,
        dueAt: request.dueAt,
        requestedAt: request.requestedAt,
        code: definition.code,
        labels: definition.labels,
        descriptionLabels: definition.descriptionLabels,
        questionnaireVersion: version.version,
        schema: version.schema,
        latestSequence: latestSequence.get(request.questionnaireId) ?? 0,
      }];
    });
    return { patientId: patient.id, items };
  }

  async submit(principal: AuthPrincipal, requestId: string, input: SubmitRequestedQuestionnaireInput) {
    const patient = await this.requirePatient(principal);
    const id = this.id(requestId, "requestId");
    const request = await this.prisma.questionnaireRequest.findUnique({ where: { id } });
    if (!request || request.patientId !== patient.id) throw new NotFoundException("Questionnaire request not found.");
    if (request.status !== "REQUESTED") throw new ConflictException("Questionnaire request is already completed.");
    if (request.dueAt.getTime() <= Date.now()) throw new ConflictException("Questionnaire request has expired.");

    const [definition, version] = await Promise.all([
      this.prisma.questionnaireDefinition.findUnique({ where: { id: request.questionnaireId } }),
      this.prisma.questionnaireVersion.findUnique({ where: { id: request.questionnaireVersionId } }),
    ]);
    if (!definition || !version || version.questionnaireId !== definition.id) {
      throw new ConflictException("Requested questionnaire version is unavailable.");
    }

    const expectedLatestSequence = this.nonNegativeInteger(input?.expectedLatestSequence, "expectedLatestSequence");
    const healthChanged = this.optionalBoolean(input?.healthChanged, "healthChanged");
    const schema = normalizeQuestionnaireSchema(version.schema);
    const answers = normalizeQuestionnaireAnswers(schema, input?.answers);

    const observed = await this.prisma.questionnaireResponse.findFirst({
      where: { patientId: patient.id, questionnaireId: definition.id },
      orderBy: { sequence: "desc" },
    });
    if ((observed?.sequence ?? 0) !== expectedLatestSequence) {
      throw new ConflictException({
        message: "Questionnaire response sequence conflict.",
        currentSequence: observed?.sequence ?? 0,
      });
    }
    const previousPayload = observed ? await this.decryptResponse(observed) : null;
    const diff = diffQuestionnaireAnswers(previousPayload?.answers ?? null, answers);
    const payload: StoredResponse = {
      schemaVersion: 1,
      questionnaireCode: definition.code,
      questionnaireVersion: version.version,
      healthChanged,
      answers,
    };
    const encrypted = await this.envelope.encryptRecord(payload);
    const nextSequence = expectedLatestSequence + 1;

    const result = await this.prisma.$transaction(async (tx) => {
      await this.audit.reserveIntegrityChainForSerializableTransaction(tx);
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "PatientProfile" WHERE id = ${patient.id} FOR UPDATE`);
      const currentRequest = await tx.questionnaireRequest.findUnique({ where: { id } });
      if (
        !currentRequest ||
        currentRequest.patientId !== patient.id ||
        currentRequest.status !== "REQUESTED" ||
        currentRequest.dueAt.getTime() <= Date.now()
      ) {
        throw new ConflictException("Questionnaire request is no longer available.");
      }
      const current = await tx.questionnaireResponse.findFirst({
        where: { patientId: patient.id, questionnaireId: definition.id },
        orderBy: { sequence: "desc" },
        select: { id: true, sequence: true },
      });
      if ((current?.sequence ?? 0) !== expectedLatestSequence) {
        throw new ConflictException({
          message: "Questionnaire response sequence conflict.",
          currentSequence: current?.sequence ?? 0,
        });
      }

      const response = await tx.questionnaireResponse.create({
        data: {
          questionnaireId: definition.id,
          questionnaireVersionId: version.id,
          patientId: patient.id,
          sequence: nextSequence,
          previousResponseId: current?.id ?? null,
          healthChanged,
          changedQuestionIds: diff.changedQuestionIds as unknown as Prisma.InputJsonValue,
          sourceType: "PATIENT",
          sourceActorId: principal.accountId,
          ...this.envelopeData(encrypted),
        },
      });
      const changed = await tx.questionnaireRequest.updateMany({
        where: { id, patientId: patient.id, status: "REQUESTED" },
        data: {
          status: "COMPLETED",
          completedResponseId: response.id,
          completedAt: response.completedAt,
        },
      });
      if (changed.count !== 1) throw new ConflictException("Questionnaire request changed concurrently.");

      await this.audit.writeClinicalInTransaction(tx, {
        actorId: principal.accountId,
        action: "QUESTIONNAIRE_RESPONSE_SUBMITTED",
        objectType: "QUESTIONNAIRE_RESPONSE",
        objectId: response.id,
        purpose: "PATIENT_ACCESS",
        result: "SUCCESS",
        metadata: {
          domain: "QUESTIONNAIRE",
          accessBasis: "PATIENT_SELF",
          patientId: patient.id,
          resourceId: response.id,
          resourceVersion: response.sequence,
          changedFields: diff.changedQuestionIds,
          requestId: id,
          decision: "ALLOW",
        },
      });
      await this.audit.writeClinicalInTransaction(tx, {
        actorId: principal.accountId,
        action: "QUESTIONNAIRE_REQUEST_COMPLETED",
        objectType: "QUESTIONNAIRE_REQUEST",
        objectId: id,
        purpose: "PATIENT_ACCESS",
        result: "SUCCESS",
        metadata: {
          domain: "QUESTIONNAIRE_REQUEST",
          patientId: patient.id,
          providerId: currentRequest.providerId,
          resourceId: id,
          resourceVersion: response.sequence,
          decision: "ALLOW",
        },
      });

      const provider = await tx.provider.findUnique({
        where: { id: currentRequest.providerId },
        select: { userId: true },
      });
      if (provider?.userId) {
        await this.notifications.enqueueAccountInTransaction(tx, {
          accountId: provider.userId,
          dedupeKey: `questionnaire-request:${id}:completed`,
          type: "CARE_COORDINATION",
          entityType: "QUESTIONNAIRE_REQUEST",
          entityId: id,
          safeTitleKey: "questionnaire.completed.title",
          safeBodyKey: "questionnaire.completed.body",
        });
      }
      return response;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    this.notifications.wakeOutbox();
    return {
      requestId: id,
      status: "COMPLETED",
      response: {
        id: result.id,
        sequence: result.sequence,
        questionnaireVersion: version.version,
        completedAt: result.completedAt,
        changedQuestionIds: diff.changedQuestionIds,
        encryptedAtRest: true,
      },
    };
  }

  private async requireDoctor(principal: AuthPrincipal) {
    if (principal.role !== "DOCTOR") throw new ForbiddenException("Doctor questionnaire requests require DOCTOR role.");
    const provider = await this.prisma.provider.findUnique({
      where: { userId: principal.accountId },
      select: { id: true, status: true, class: true },
    });
    if (!provider || provider.class !== "DOCTOR" || provider.status !== "ACTIVE") {
      throw new ForbiddenException("An active Doctor provider profile is required.");
    }
    return provider;
  }

  private async requirePatient(principal: AuthPrincipal) {
    if (principal.role !== "PATIENT") throw new ForbiddenException("Patient questionnaire request access requires PATIENT role.");
    const patient = await this.prisma.patientProfile.findUnique({
      where: { userId: principal.accountId },
      select: { id: true, userId: true },
    });
    if (!patient) throw new NotFoundException("Patient profile not found.");
    return patient;
  }

  private async requireAppointment(providerId: string, patientId: string, appointmentId: string) {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      select: { id: true, patientId: true, providerId: true, status: true, startsAt: true, endsAt: true },
    });
    if (!appointment || appointment.patientId !== patientId || appointment.providerId !== providerId) {
      throw new ForbiddenException("Questionnaire request requires this Doctor's patient appointment.");
    }
    if (!["CONFIRMED", "COMPLETED"].includes(appointment.status)) {
      throw new ConflictException("Questionnaire requests require a confirmed or completed appointment.");
    }
    return appointment;
  }

  private async requireTreatmentRelationship(providerId: string, patientId: string) {
    const now = new Date();
    const from = new Date(now.getTime() - 365 * 86400000);
    const to = new Date(now.getTime() + 30 * 86400000);
    const appointment = await this.prisma.appointment.findFirst({
      where: {
        providerId,
        patientId,
        status: { in: ["CONFIRMED", "COMPLETED"] },
        startsAt: { gte: from, lte: to },
      },
      select: { id: true },
    });
    if (!appointment) throw new ForbiddenException("A current treatment relationship is required.");
  }

  private assertContext(
    appointment: { status: string; startsAt: Date; endsAt: Date },
    context: RequestContext,
    dueAt: Date,
  ) {
    const now = Date.now();
    if (dueAt.getTime() <= now) throw new BadRequestException("dueAt must be in the future.");
    if (dueAt.getTime() > now + MAX_REQUEST_DAYS * 86400000) {
      throw new BadRequestException(`dueAt cannot exceed ${MAX_REQUEST_DAYS} days.`);
    }
    if (context === "PRE_VISIT") {
      if (appointment.status !== "CONFIRMED") throw new ConflictException("PRE_VISIT requires a confirmed appointment.");
      if (dueAt.getTime() >= appointment.startsAt.getTime()) {
        throw new BadRequestException("PRE_VISIT dueAt must be before appointment start.");
      }
      return;
    }
    if (appointment.status !== "COMPLETED") {
      throw new ConflictException(`${context} requires a completed appointment.`);
    }
  }

  private async presentRequests(rows: Array<{
    id: string;
    patientId: string;
    providerId: string;
    questionnaireId: string;
    questionnaireVersionId: string;
    appointmentId: string;
    context: string;
    dueAt: Date;
    status: string;
    requestedAt: Date;
    completedAt: Date | null;
  }>) {
    if (rows.length === 0) return [];
    const definitions = await this.prisma.questionnaireDefinition.findMany({
      where: { id: { in: [...new Set(rows.map((item) => item.questionnaireId))] } },
      select: { id: true, code: true, labels: true },
    });
    const versions = await this.prisma.questionnaireVersion.findMany({
      where: { id: { in: [...new Set(rows.map((item) => item.questionnaireVersionId))] } },
      select: { id: true, version: true },
    });
    const byDefinition = new Map(definitions.map((item) => [item.id, item]));
    const byVersion = new Map(versions.map((item) => [item.id, item.version]));
    const now = Date.now();
    return rows.map((item) => ({
      id: item.id,
      patientId: item.patientId,
      appointmentId: item.appointmentId,
      context: item.context,
      dueAt: item.dueAt,
      status: item.status === "REQUESTED" && item.dueAt.getTime() <= now ? "EXPIRED" : item.status,
      requestedAt: item.requestedAt,
      completedAt: item.completedAt,
      code: byDefinition.get(item.questionnaireId)?.code ?? null,
      labels: byDefinition.get(item.questionnaireId)?.labels ?? null,
      questionnaireVersion: byVersion.get(item.questionnaireVersionId) ?? null,
    }));
  }

  private async decryptResponse(row: {
    algorithm: string;
    keyId: string;
    wrappedKey: string;
    iv: string;
    ciphertext: string;
  }) {
    return this.envelope.decryptRecord<StoredResponse>(this.responseEnvelope(row));
  }

  private responseEnvelope(row: {
    algorithm: string;
    keyId: string;
    wrappedKey: string;
    iv: string;
    ciphertext: string;
  }): EncryptedEnvelope {
    if (row.algorithm !== "AES-256-GCM") throw new ConflictException("Unsupported questionnaire response encryption.");
    return {
      version: 1,
      algorithm: "AES-256-GCM",
      keyId: row.keyId,
      wrappedKey: row.wrappedKey,
      iv: row.iv,
      ciphertext: row.ciphertext,
    };
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

  private code(value: unknown) {
    if (typeof value !== "string") throw new BadRequestException("questionnaireCode is required.");
    const normalized = value.trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9_]{2,79}$/.test(normalized)) throw new BadRequestException("questionnaireCode is invalid.");
    return normalized;
  }

  private id(value: unknown, field: string) {
    if (typeof value !== "string" || !/^[A-Za-z0-9_.:-]{1,180}$/.test(value.trim())) {
      throw new BadRequestException(`${field} is invalid.`);
    }
    return value.trim();
  }

  private idempotency(value: unknown) {
    if (typeof value !== "string") throw new BadRequestException("idempotencyKey is required.");
    const normalized = value.trim();
    if (normalized.length < 8 || normalized.length > 128 || /\p{Cc}/u.test(normalized)) {
      throw new BadRequestException("idempotencyKey is invalid.");
    }
    return normalized;
  }

  private context(value: unknown): RequestContext {
    const normalized = String(value ?? "").trim().toUpperCase();
    if (!CONTEXTS.has(normalized)) throw new BadRequestException("context is invalid.");
    return normalized as RequestContext;
  }

  private due(value: unknown) {
    if (typeof value !== "string") throw new BadRequestException("dueAt must be an ISO date-time.");
    const parsed = new Date(value);
    if (!Number.isFinite(parsed.getTime())) throw new BadRequestException("dueAt must be a valid ISO date-time.");
    return parsed;
  }

  private nonNegativeInteger(value: unknown, field: string) {
    if (!Number.isInteger(value) || Number(value) < 0) {
      throw new BadRequestException(`${field} must be a non-negative integer.`);
    }
    return Number(value);
  }

  private optionalBoolean(value: unknown, field: string): boolean | null {
    if (value == null) return null;
    if (typeof value !== "boolean") throw new BadRequestException(`${field} must be boolean.`);
    return value;
  }
}
