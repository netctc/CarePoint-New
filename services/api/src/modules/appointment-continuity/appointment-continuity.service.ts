import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { AuthPrincipal } from "@carepoint/identity";
import type { EncryptedEnvelope } from "@carepoint/security";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { ClinicalEnvelopeService } from "../clinical/clinical-envelope.service";
import { NotificationsService } from "../communications/notifications.service";
import { PatientContextService } from "../dependents/dependents.service";
import {
  diffQuestionnaireAnswers,
  normalizeQuestionnaireAnswers,
  normalizeQuestionnaireSchema,
} from "../questionnaire/questionnaire.engine";
import {
  normalizeDueAt,
  normalizeFollowUpPayload,
  normalizePrepTask,
  normalizePrepTaskStatus,
  normalizeReasonCode,
  normalizeSourceRef,
  readinessProjection,
} from "./appointment-continuity.engine";

export interface ConfigurePrepInput { tasks: unknown[]; }
export interface UpdatePrepTaskInput { status: string; sourceRef?: string | null; }
export interface QuestionnaireRequestInput { questionnaireVersionId: string; appointmentId?: string | null; dueAt?: string | null; }
export interface DoctorQuestionnaireRequestInput {
  questionnaireVersionId: string;
  appointmentId: string;
  context: "PRE_VISIT" | "POST_VISIT" | "FOLLOW_UP";
  dueAt: string;
  idempotencyKey: string;
}
export interface SubmitRequestedQuestionnaireInput {
  expectedLatestSequence: number;
  answers: unknown;
  healthChanged?: boolean | null;
}
export interface FollowUpInput { expectedVersion?: number; release?: boolean; reasonCode?: string | null; followUp: unknown; }

type EnvelopeRow = { algorithm: string; keyId: string; wrappedKey: string; iv: string; ciphertext: string };

@Injectable()
export class AppointmentContinuityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
    private readonly envelope: ClinicalEnvelopeService,
    private readonly notifications: NotificationsService,
    private readonly contexts: PatientContextService,
  ) {}

  async patientPrep(principal: AuthPrincipal, appointmentId: string) {
    const appointment = await this.patientAppointment(principal, appointmentId, "BOOKING_MANAGE");
    await this.ensureDefaultPrepTasks(appointment, principal.accountId);
    return this.prepProjection(appointment.id, appointment.patientId);
  }

  async updatePatientPrep(principal: AuthPrincipal, appointmentId: string, taskCode: string, input: UpdatePrepTaskInput) {
    const appointment = await this.patientAppointment(principal, appointmentId, "BOOKING_MANAGE");
    const code = this.token(taskCode, "taskCode");
    const status = normalizePrepTaskStatus(input?.status);
    const sourceRef = normalizeSourceRef(input?.sourceRef);
    const row = await this.prisma.appointmentPrepTask.findUnique({ where: { appointmentId_code: { appointmentId: appointment.id, code } } });
    if (!row || row.patientId !== appointment.patientId) throw new NotFoundException("Appointment preparation task not found.");
    if (status === "COMPLETED" && this.referenceRequired(row.taskType) && !sourceRef) {
      throw new BadRequestException("This preparation task requires sourceRef evidence.");
    }
    if (appointment.status === "COMPLETED" || appointment.status === "CANCELLED" || appointment.status === "NO_SHOW") throw new ConflictException("Appointment preparation can no longer be changed.");
    const completed = status === "COMPLETED" || status === "NOT_APPLICABLE";
    const updated = await this.prisma.appointmentPrepTask.update({
      where: { id: row.id },
      data: { status, sourceRef, completedByActorId: completed ? principal.accountId : null, completedAt: completed ? new Date() : null },
    });
    await this.audit.writeClinical({ actorId: principal.accountId, action: "APPOINTMENT_PREP_TASK_UPDATED", objectType: "APPOINTMENT_PREP_TASK", objectId: updated.id, purpose: "PATIENT_ACCESS", result: "SUCCESS", metadata: { domain: "APPOINTMENT_PREP", patientId: appointment.patientId, appointmentId: appointment.id, resourceId: updated.id, decision: "ALLOW" } });
    return this.prepProjection(appointment.id, appointment.patientId);
  }

  async configurePrep(principal: AuthPrincipal, appointmentId: string, input: ConfigurePrepInput) {
    const { appointment, provider } = await this.providerAppointment(principal, appointmentId, true);
    if (!Array.isArray(input?.tasks) || input.tasks.length > 30) throw new BadRequestException("tasks must be an array with at most 30 items.");
    const tasks = input.tasks.map((item) => normalizePrepTask(item));
    if (new Set(tasks.map((item) => item.code)).size !== tasks.length) throw new BadRequestException("Preparation task codes must be unique.");
    await this.prisma.$transaction(async (tx) => {
      for (const task of tasks) {
        await tx.appointmentPrepTask.upsert({
          where: { appointmentId_code: { appointmentId: appointment.id, code: task.code } },
          create: { appointmentId: appointment.id, patientId: appointment.patientId, providerId: provider.id, code: task.code, taskType: task.taskType, required: task.required, ...(task.dueAt ? { dueAt: task.dueAt } : {}), createdByActorId: principal.accountId },
          update: { taskType: task.taskType, required: task.required, dueAt: task.dueAt },
        });
      }
      await this.audit.writeClinicalInTransaction(tx, { actorId: principal.accountId, action: "APPOINTMENT_PREP_CONFIGURED", objectType: "APPOINTMENT", objectId: appointment.id, purpose: "TREATMENT", result: "SUCCESS", metadata: { domain: "APPOINTMENT_PREP", patientId: appointment.patientId, providerId: provider.id, appointmentId: appointment.id, itemCount: tasks.length, decision: "ALLOW" } });
    });
    return this.prepProjection(appointment.id, appointment.patientId);
  }

  async providerReadiness(principal: AuthPrincipal, appointmentId: string) {
    const { appointment } = await this.providerAppointment(principal, appointmentId, true);
    await this.ensureDefaultPrepTasks(appointment, principal.accountId);
    return this.prepProjection(appointment.id, appointment.patientId);
  }


  async availableQuestionnaires(principal: AuthPrincipal, patientId: string, appointmentId: string) {
    const provider = await this.requireDoctor(principal);
    const normalizedPatientId = this.id(patientId, "patientId");
    const normalizedAppointmentId = this.id(appointmentId, "appointmentId");
    const appointment = await this.prisma.appointment.findFirst({
      where: {
        id: normalizedAppointmentId,
        patientId: normalizedPatientId,
        providerId: provider.id,
        status: { in: ["CONFIRMED", "COMPLETED"] },
      },
      select: { id: true },
    });
    if (!appointment) throw new ForbiddenException("Authorized Doctor appointment context is required.");

    const versions = await this.prisma.questionnaireVersion.findMany({
      where: { status: "ACTIVE", questionnaire: { active: true } },
      include: { questionnaire: true },
      orderBy: [{ questionnaireId: "asc" }, { version: "desc" }],
    });
    const seen = new Set<string>();
    return {
      patientId: normalizedPatientId,
      appointmentId: appointment.id,
      items: versions.flatMap((item) => {
        if (seen.has(item.questionnaireId)) return [];
        seen.add(item.questionnaireId);
        return [{
          questionnaireVersionId: item.id,
          code: item.questionnaire.code,
          labels: item.questionnaire.labels,
          descriptionLabels: item.questionnaire.descriptionLabels,
          questionnaireVersion: item.version,
        }];
      }),
    };
  }

  async doctorQuestionnaireRequests(principal: AuthPrincipal, patientId: string) {
    const provider = await this.requireDoctor(principal);
    const normalizedPatientId = this.id(patientId, "patientId");
    const rows = await this.prisma.questionnaireRequest.findMany({
      where: { providerId: provider.id, patientId: normalizedPatientId },
      orderBy: { createdAt: "desc" },
      take: 250,
    });
    return { patientId: normalizedPatientId, items: await this.presentQuestionnaireRequests(rows) };
  }

  async requestQuestionnaireForVisit(
    principal: AuthPrincipal,
    patientId: string,
    input: DoctorQuestionnaireRequestInput,
  ) {
    const provider = await this.requireDoctor(principal);
    const normalizedPatientId = this.id(patientId, "patientId");
    const appointmentId = this.id(input?.appointmentId, "appointmentId");
    const versionId = this.id(input?.questionnaireVersionId, "questionnaireVersionId");
    const idempotencyKey = this.idempotency(input?.idempotencyKey);
    const context = this.requestContext(input?.context);
    const dueAt = normalizeDueAt(input?.dueAt);
    if (!dueAt) throw new BadRequestException("dueAt is required.");

    const [patient, appointment, version] = await Promise.all([
      this.prisma.patientProfile.findUnique({
        where: { id: normalizedPatientId },
        select: { id: true, userId: true },
      }),
      this.prisma.appointment.findFirst({
        where: {
          id: appointmentId,
          patientId: normalizedPatientId,
          providerId: provider.id,
          status: { in: ["CONFIRMED", "COMPLETED"] },
        },
        select: { id: true, status: true, startsAt: true },
      }),
      this.prisma.questionnaireVersion.findUnique({
        where: { id: versionId },
        include: { questionnaire: { select: { active: true, code: true, labels: true } } },
      }),
    ]);
    if (!patient) throw new NotFoundException("Patient not found.");
    if (!appointment) throw new ForbiddenException("Authorized Doctor appointment context is required.");
    if (!version || version.status !== "ACTIVE" || !version.questionnaire.active) {
      throw new BadRequestException("An ACTIVE questionnaire version is required.");
    }

    const now = Date.now();
    if (dueAt.getTime() <= now) throw new BadRequestException("dueAt must be in the future.");
    if (dueAt.getTime() > now + 30 * 24 * 60 * 60 * 1000) {
      throw new BadRequestException("dueAt cannot exceed 30 days.");
    }
    if (context === "PRE_VISIT") {
      if (appointment.status !== "CONFIRMED") throw new ConflictException("PRE_VISIT requires a confirmed appointment.");
      if (dueAt.getTime() >= appointment.startsAt.getTime()) {
        throw new BadRequestException("PRE_VISIT dueAt must be before appointment start.");
      }
    } else if (appointment.status !== "COMPLETED") {
      throw new ConflictException(`${context} requires a completed appointment.`);
    }

    const existing = await this.prisma.questionnaireRequest.findUnique({ where: { idempotencyKey } });
    if (existing) {
      if (
        existing.patientId !== normalizedPatientId ||
        existing.providerId !== provider.id ||
        existing.appointmentId !== appointment.id ||
        existing.questionnaireVersionId !== version.id ||
        existing.context !== context
      ) {
        throw new ConflictException("idempotencyKey is bound to another questionnaire request.");
      }
      return (await this.presentQuestionnaireRequests([existing]))[0];
    }

    const request = await this.prisma.questionnaireRequest.create({
      data: {
        patientId: patient.id,
        providerId: provider.id,
        appointmentId: appointment.id,
        questionnaireVersionId: version.id,
        status: "REQUESTED",
        dueAt,
        idempotencyKey,
        context,
        createdByActorId: principal.accountId,
      },
    });
    await this.notifications.notifyAccount({
      accountId: patient.userId,
      dedupeKey: `questionnaire-request:${request.id}`,
      type: "CARE_COORDINATION",
      entityType: "QUESTIONNAIRE_REQUEST",
      entityId: request.id,
      safeTitleKey: "notification.questionnaire_request.title",
      safeBodyKey: "notification.questionnaire_request.body",
    });
    await this.audit.writeClinical({
      actorId: principal.accountId,
      action: "QUESTIONNAIRE_REQUESTED",
      objectType: "QUESTIONNAIRE_REQUEST",
      objectId: request.id,
      purpose: "TREATMENT",
      result: "SUCCESS",
      metadata: {
        domain: "APPOINTMENT_PREP",
        patientId: patient.id,
        providerId: provider.id,
        appointmentId: appointment.id,
        resourceId: request.id,
        resourceVersion: version.version,
        requestContext: context,
        decision: "ALLOW",
      },
    });
    return (await this.presentQuestionnaireRequests([request]))[0];
  }

  async patientQuestionnaireRequests(principal: AuthPrincipal) {
    const patient = await this.patientSelf(principal);
    const now = new Date();
    const rows = await this.prisma.questionnaireRequest.findMany({
      where: { patientId: patient.id, status: "REQUESTED", dueAt: { gt: now } },
      orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }],
      take: 100,
    });
    if (rows.length === 0) return { patientId: patient.id, items: [] };

    const versions = await this.prisma.questionnaireVersion.findMany({
      where: { id: { in: [...new Set(rows.map((item) => item.questionnaireVersionId))] } },
      include: { questionnaire: true },
    });
    const byVersion = new Map(versions.map((item) => [item.id, item]));
    const questionnaireIds = [...new Set(versions.map((item) => item.questionnaireId))];
    const responses = await this.prisma.questionnaireResponse.findMany({
      where: { patientId: patient.id, questionnaireId: { in: questionnaireIds } },
      orderBy: { sequence: "desc" },
      select: { questionnaireId: true, sequence: true },
    });
    const latestSequence = new Map<string, number>();
    for (const response of responses) {
      if (!latestSequence.has(response.questionnaireId)) latestSequence.set(response.questionnaireId, response.sequence);
    }

    const items = rows.flatMap((request) => {
      const version = byVersion.get(request.questionnaireVersionId);
      if (!version) return [];
      return [{
        id: request.id,
        appointmentId: request.appointmentId,
        context: request.context,
        dueAt: request.dueAt,
        requestedAt: request.createdAt,
        code: version.questionnaire.code,
        labels: version.questionnaire.labels,
        descriptionLabels: version.questionnaire.descriptionLabels,
        questionnaireVersion: version.version,
        schema: version.schema,
        latestSequence: latestSequence.get(version.questionnaireId) ?? 0,
      }];
    });
    return { patientId: patient.id, items };
  }

  async submitRequestedQuestionnaire(
    principal: AuthPrincipal,
    requestId: string,
    input: SubmitRequestedQuestionnaireInput,
  ) {
    const patient = await this.patientSelf(principal);
    const normalizedRequestId = this.id(requestId, "requestId");
    const request = await this.prisma.questionnaireRequest.findUnique({ where: { id: normalizedRequestId } });
    if (!request || request.patientId !== patient.id) throw new NotFoundException("Questionnaire request not found.");
    if (request.status !== "REQUESTED") throw new ConflictException("Questionnaire request is already completed.");
    if (!request.dueAt || request.dueAt.getTime() <= Date.now()) throw new ConflictException("Questionnaire request has expired.");

    const version = await this.prisma.questionnaireVersion.findUnique({
      where: { id: request.questionnaireVersionId },
      include: { questionnaire: true },
    });
    if (!version) throw new ConflictException("Requested questionnaire version is unavailable.");

    const expectedLatestSequence = this.nonNegativeInteger(input?.expectedLatestSequence, "expectedLatestSequence");
    const healthChanged = this.optionalBoolean(input?.healthChanged, "healthChanged");
    const schema = normalizeQuestionnaireSchema(version.schema);
    const answers = normalizeQuestionnaireAnswers(schema, input?.answers);
    const observed = await this.prisma.questionnaireResponse.findFirst({
      where: { patientId: patient.id, questionnaireId: version.questionnaireId },
      orderBy: { sequence: "desc" },
    });
    if ((observed?.sequence ?? 0) !== expectedLatestSequence) {
      throw new ConflictException({
        message: "Questionnaire response sequence conflict.",
        currentSequence: observed?.sequence ?? 0,
      });
    }

    const previousPayload = observed ? await this.questionnairePayload(observed) : null;
    const diff = diffQuestionnaireAnswers(previousPayload?.answers ?? null, answers);
    const nextSequence = expectedLatestSequence + 1;
    const encrypted = await this.envelope.encryptRecord({
      schemaVersion: 1,
      questionnaireCode: version.questionnaire.code,
      questionnaireVersion: version.version,
      healthChanged,
      answers,
    });

    const response = await this.prisma.$transaction(async (tx) => {
      await this.audit.reserveIntegrityChainForSerializableTransaction(tx);
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "PatientProfile" WHERE id = ${patient.id} FOR UPDATE`);
      const currentRequest = await tx.questionnaireRequest.findUnique({ where: { id: normalizedRequestId } });
      if (
        !currentRequest ||
        currentRequest.patientId !== patient.id ||
        currentRequest.status !== "REQUESTED" ||
        !currentRequest.dueAt ||
        currentRequest.dueAt.getTime() <= Date.now()
      ) {
        throw new ConflictException("Questionnaire request is no longer available.");
      }
      const current = await tx.questionnaireResponse.findFirst({
        where: { patientId: patient.id, questionnaireId: version.questionnaireId },
        orderBy: { sequence: "desc" },
        select: { id: true, sequence: true },
      });
      if ((current?.sequence ?? 0) !== expectedLatestSequence) {
        throw new ConflictException({
          message: "Questionnaire response sequence conflict.",
          currentSequence: current?.sequence ?? 0,
        });
      }

      const created = await tx.questionnaireResponse.create({
        data: {
          questionnaireId: version.questionnaireId,
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
      const updated = await tx.questionnaireRequest.updateMany({
        where: { id: normalizedRequestId, patientId: patient.id, status: "REQUESTED" },
        data: { status: "COMPLETED", responseId: created.id, completedAt: created.completedAt },
      });
      if (updated.count !== 1) throw new ConflictException("Questionnaire request changed concurrently.");

      await this.audit.writeClinicalInTransaction(tx, {
        actorId: principal.accountId,
        action: "QUESTIONNAIRE_RESPONSE_SUBMITTED",
        objectType: "QUESTIONNAIRE_RESPONSE",
        objectId: created.id,
        purpose: "PATIENT_ACCESS",
        result: "SUCCESS",
        metadata: {
          domain: "QUESTIONNAIRE",
          patientId: patient.id,
          resourceId: created.id,
          resourceVersion: created.sequence,
          changedFields: diff.changedQuestionIds,
          requestId: normalizedRequestId,
          decision: "ALLOW",
        },
      });
      await this.audit.writeClinicalInTransaction(tx, {
        actorId: principal.accountId,
        action: "QUESTIONNAIRE_REQUEST_COMPLETED",
        objectType: "QUESTIONNAIRE_REQUEST",
        objectId: normalizedRequestId,
        purpose: "PATIENT_ACCESS",
        result: "SUCCESS",
        metadata: {
          domain: "APPOINTMENT_PREP",
          patientId: patient.id,
          providerId: currentRequest.providerId,
          appointmentId: currentRequest.appointmentId ?? undefined,
          resourceId: normalizedRequestId,
          resourceVersion: created.sequence,
          decision: "ALLOW",
        },
      });
      return { created, providerId: currentRequest.providerId };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    const provider = await this.prisma.provider.findUnique({
      where: { id: response.providerId },
      select: { userId: true },
    });
    if (provider?.userId) {
      await this.notifications.notifyAccount({
        accountId: provider.userId,
        dedupeKey: `questionnaire-request:${normalizedRequestId}:completed`,
        type: "CARE_COORDINATION",
        entityType: "QUESTIONNAIRE_REQUEST",
        entityId: normalizedRequestId,
        safeTitleKey: "notification.questionnaire_completed.title",
        safeBodyKey: "notification.questionnaire_completed.body",
      });
    }

    return {
      requestId: normalizedRequestId,
      status: "COMPLETED",
      response: {
        id: response.created.id,
        sequence: response.created.sequence,
        questionnaireVersion: version.version,
        completedAt: response.created.completedAt,
        changedQuestionIds: diff.changedQuestionIds,
        encryptedAtRest: true,
      },
    };
  }

  async requestQuestionnaire(principal: AuthPrincipal, patientId: string, input: QuestionnaireRequestInput) {
    const provider = await this.requireDoctor(principal);
    const patient = await this.prisma.patientProfile.findUnique({ where: { id: this.id(patientId, "patientId") }, select: { id: true, userId: true } });
    if (!patient) throw new NotFoundException("Patient not found.");
    const versionId = this.id(input?.questionnaireVersionId, "questionnaireVersionId");
    const version = await this.prisma.questionnaireVersion.findUnique({ where: { id: versionId }, include: { questionnaire: { select: { active: true } } } });
    if (!version || version.status !== "ACTIVE" || !version.questionnaire.active) throw new BadRequestException("An ACTIVE questionnaire version is required.");
    let appointmentId: string | null = null;
    if (input?.appointmentId) {
      const appointment = await this.prisma.appointment.findFirst({ where: { id: this.id(input.appointmentId, "appointmentId"), patientId: patient.id, providerId: provider.id, status: { in: ["CONFIRMED", "COMPLETED"] } }, select: { id: true } });
      if (!appointment) throw new ForbiddenException("Authorized appointment context is required.");
      appointmentId = appointment.id;
    } else if (!(await this.hasCurrentRelationship(provider.id, patient.id))) {
      throw new ForbiddenException("A current treatment relationship is required.");
    }
    const dueAt = normalizeDueAt(input?.dueAt);
    if (dueAt && dueAt.getTime() <= Date.now()) throw new BadRequestException("dueAt must be in the future.");
    const request = await this.prisma.questionnaireRequest.create({ data: { patientId: patient.id, providerId: provider.id, ...(appointmentId ? { appointmentId } : {}), questionnaireVersionId: version.id, ...(dueAt ? { dueAt } : {}), createdByActorId: principal.accountId } });
    await this.notifications.notifyAccount({ accountId: patient.userId, dedupeKey: `questionnaire-request:${request.id}`, type: "CARE_COORDINATION", entityType: "QUESTIONNAIRE_REQUEST", entityId: request.id, safeTitleKey: "notification.questionnaire_request.title", safeBodyKey: "notification.questionnaire_request.body" });
    await this.audit.writeClinical({ actorId: principal.accountId, action: "QUESTIONNAIRE_REQUESTED", objectType: "QUESTIONNAIRE_REQUEST", objectId: request.id, purpose: "TREATMENT", result: "SUCCESS", metadata: { domain: "APPOINTMENT_PREP", patientId: patient.id, providerId: provider.id, ...(appointmentId ? { appointmentId } : {}), resourceId: request.id, decision: "ALLOW" } });
    return request;
  }

  async createOrReviseFollowUp(principal: AuthPrincipal, appointmentId: string, input: FollowUpInput) {
    const { appointment, provider } = await this.providerAppointment(principal, appointmentId, true);
    if (appointment.status !== "COMPLETED") throw new ConflictException("Follow-up can be released only after the appointment is completed.");
    const payload = normalizeFollowUpPayload(input?.followUp);
    await this.validateCareTaskReferences(payload.careTaskIds, appointment.patientId, provider.id);
    const encrypted = await this.envelope.encryptRecord({ schemaVersion: 1, ...payload });
    const existing = await this.prisma.encounterFollowUp.findUnique({ where: { appointmentId: appointment.id } });
    const release = input?.release === true;
    const reasonCode = normalizeReasonCode(input?.reasonCode);
    if (!existing) {
      const created = await this.prisma.$transaction(async (tx) => {
        const row = await tx.encounterFollowUp.create({ data: { appointmentId: appointment.id, patientId: appointment.patientId, providerId: provider.id, version: 1, status: release ? "RELEASED" : "DRAFT", ...(release ? { releasedAt: new Date() } : {}), ...this.envelopeData(encrypted) } });
        await tx.encounterFollowUpRevision.create({ data: { followUpId: row.id, version: 1, authorActorId: principal.accountId, ...(reasonCode ? { reasonCode } : {}), ...this.envelopeData(encrypted) } });
        await this.audit.writeClinicalInTransaction(tx, { actorId: principal.accountId, action: "ENCOUNTER_FOLLOW_UP_CREATED", objectType: "ENCOUNTER_FOLLOW_UP", objectId: row.id, purpose: "TREATMENT", result: "SUCCESS", metadata: { domain: "FOLLOW_UP", patientId: row.patientId, providerId: row.providerId, appointmentId: row.appointmentId, resourceId: row.id, resourceVersion: 1, decision: "ALLOW" } });
        return row;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      if (release) await this.notifyFollowUpPatient(created.patientId, created.id, created.version);
      return this.presentFollowUp(created, payload);
    }
    if (existing.providerId !== provider.id) throw new ForbiddenException("Only the responsible provider can revise this follow-up.");
    const expectedVersion = this.positiveInteger(input?.expectedVersion, "expectedVersion");
    if (expectedVersion !== existing.version) throw new ConflictException({ message: "Follow-up version conflict.", currentVersion: existing.version });
    const nextVersion = existing.version + 1;
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "EncounterFollowUp" WHERE id = ${existing.id} FOR UPDATE`);
      const current = await tx.encounterFollowUp.findUnique({ where: { id: existing.id } });
      if (!current || current.version !== expectedVersion) throw new ConflictException({ message: "Follow-up version conflict.", currentVersion: current?.version ?? null });
      const effectiveRelease = release || current.status === "RELEASED";
      const row = await tx.encounterFollowUp.update({ where: { id: existing.id }, data: { version: nextVersion, status: effectiveRelease ? "RELEASED" : current.status, ...(effectiveRelease ? { releasedAt: current.releasedAt ?? new Date() } : {}), ...this.envelopeData(encrypted) } });
      await tx.encounterFollowUpRevision.create({ data: { followUpId: row.id, version: nextVersion, authorActorId: principal.accountId, ...(reasonCode ? { reasonCode } : {}), ...this.envelopeData(encrypted) } });
      await this.audit.writeClinicalInTransaction(tx, { actorId: principal.accountId, action: "ENCOUNTER_FOLLOW_UP_REVISED", objectType: "ENCOUNTER_FOLLOW_UP", objectId: row.id, purpose: "TREATMENT", result: "SUCCESS", metadata: { domain: "FOLLOW_UP", patientId: row.patientId, providerId: row.providerId, appointmentId: row.appointmentId, resourceId: row.id, resourceVersion: nextVersion, decision: "ALLOW" } });
      return row;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    if (release || existing.status === "RELEASED") await this.notifyFollowUpPatient(updated.patientId, updated.id, updated.version);
    return this.presentFollowUp(updated, payload);
  }

  async patientFollowUp(principal: AuthPrincipal, appointmentId: string) {
    const appointment = await this.patientAppointment(principal, appointmentId, "CLINICAL_READ");
    if (appointment.status !== "COMPLETED") throw new NotFoundException("Released follow-up is not available.");
    const row = await this.prisma.encounterFollowUp.findFirst({ where: { appointmentId: appointment.id, patientId: appointment.patientId, status: "RELEASED" } });
    if (!row) throw new NotFoundException("Released follow-up is not available.");
    return this.presentFollowUp(row, await this.decrypt(row));
  }

  private async prepProjection(appointmentId: string, patientId: string) {
    const tasks = await this.prisma.appointmentPrepTask.findMany({ where: { appointmentId, patientId }, orderBy: [{ required: "desc" }, { code: "asc" }] });
    return { appointmentId, patientId, readiness: readinessProjection(tasks), tasks: tasks.map((item) => ({ id: item.id, code: item.code, taskType: item.taskType, required: item.required, status: item.status, sourceRef: item.sourceRef, dueAt: item.dueAt, completedAt: item.completedAt })) };
  }

  private async ensureDefaultPrepTasks(appointment: { id: string; patientId: string; providerId: string; modality: string; startsAt: Date }, actorId: string) {
    const defaults = [
      { code: "PREPARE_QUESTIONS", taskType: "QUESTIONS", required: false },
      { code: "REVIEW_DOCUMENTS", taskType: "DOCUMENT", required: false },
      { code: "UPDATE_MEASUREMENTS", taskType: "OBSERVATION", required: false },
      ...(appointment.modality === "TELEMEDICINE" ? [{ code: "DEVICE_CHECK", taskType: "DEVICE_CHECK", required: true }] : []),
    ];
    for (const item of defaults) {
      await this.prisma.appointmentPrepTask.upsert({ where: { appointmentId_code: { appointmentId: appointment.id, code: item.code } }, create: { appointmentId: appointment.id, patientId: appointment.patientId, providerId: appointment.providerId, code: item.code, taskType: item.taskType, required: item.required, dueAt: appointment.startsAt, createdByActorId: actorId }, update: {} });
    }
  }

  private referenceRequired(taskType: string) {
    return taskType === "QUESTIONNAIRE" || taskType === "OBSERVATION" || taskType === "DOCUMENT";
  }

  private async patientAppointment(principal: AuthPrincipal, appointmentId: string, requiredScope: "BOOKING_MANAGE" | "CLINICAL_READ") {
    if (principal.role !== "PATIENT") throw new ForbiddenException("Patient appointment context is required.");
    const context = await this.contexts.resolveEffectivePatient(principal, requiredScope);
    const appointment = await this.prisma.appointment.findFirst({ where: { id: this.id(appointmentId, "appointmentId"), patientId: context.patientId }, select: { id: true, patientId: true, providerId: true, modality: true, status: true, startsAt: true } });
    if (!appointment) throw new NotFoundException("Appointment not found.");
    return appointment;
  }

  private async providerAppointment(principal: AuthPrincipal, appointmentId: string, requireDoctor: boolean) {
    const provider = await this.requireProvider(principal, requireDoctor);
    const appointment = await this.prisma.appointment.findFirst({ where: { id: this.id(appointmentId, "appointmentId"), providerId: provider.id }, select: { id: true, patientId: true, providerId: true, modality: true, status: true, startsAt: true } });
    if (!appointment) throw new NotFoundException("Assigned appointment not found.");
    return { appointment, provider };
  }

  private requireDoctor(principal: AuthPrincipal) { return this.requireProvider(principal, true); }

  private async requireProvider(principal: AuthPrincipal, requireDoctor: boolean) {
    if (principal.role !== "DOCTOR" && principal.role !== "OTHER_PROVIDER") throw new ForbiddenException("Provider account is required.");
    if (requireDoctor && principal.role !== "DOCTOR") throw new ForbiddenException("Doctor account is required.");
    const provider = await this.prisma.provider.findUnique({ where: { userId: principal.accountId }, select: { id: true, class: true, status: true } });
    if (!provider || provider.status !== "ACTIVE") throw new ForbiddenException("An active provider profile is required.");
    if (requireDoctor && provider.class !== "DOCTOR") throw new ForbiddenException("Doctor provider profile is required.");
    return provider;
  }

  private async validateCareTaskReferences(careTaskIds: string[], patientId: string, providerId: string) {
    if (careTaskIds.length === 0) return;
    const count = await this.prisma.careTask.count({
      where: {
        id: { in: careTaskIds },
        ownerProviderId: providerId,
        carePlan: { is: { patientId } },
      },
    });
    if (count !== careTaskIds.length) throw new BadRequestException("Each careTaskId must belong to this patient and responsible doctor.");
  }

  private async hasCurrentRelationship(providerId: string, patientId: string) {
    const now = new Date();
    const from = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
    const to = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const row = await this.prisma.appointment.findFirst({ where: { providerId, patientId, status: { in: ["CONFIRMED", "COMPLETED"] }, startsAt: { gte: from, lte: to } }, select: { id: true } });
    return Boolean(row);
  }

  private async notifyFollowUpPatient(patientId: string, followUpId: string, version: number) {
    const patient = await this.prisma.patientProfile.findUnique({ where: { id: patientId }, select: { userId: true } });
    if (!patient) return;
    await this.notifications.notifyAccount({ accountId: patient.userId, dedupeKey: `follow-up:${followUpId}:v${version}`, type: "CARE_COORDINATION", entityType: "ENCOUNTER_FOLLOW_UP", entityId: followUpId, safeTitleKey: "notification.follow_up.title", safeBodyKey: "notification.follow_up.body" });
  }

  private async decrypt(row: EnvelopeRow) {
    return this.envelope.decryptRecord<Record<string, unknown>>({ version: 1, algorithm: row.algorithm as "AES-256-GCM", keyId: row.keyId, wrappedKey: row.wrappedKey, iv: row.iv, ciphertext: row.ciphertext });
  }


  private async presentQuestionnaireRequests(rows: Array<{
    id: string;
    patientId: string;
    providerId: string;
    appointmentId: string | null;
    questionnaireVersionId: string;
    status: string;
    dueAt: Date | null;
    responseId: string | null;
    idempotencyKey: string | null;
    context: string | null;
    completedAt: Date | null;
    createdAt: Date;
  }>) {
    if (rows.length === 0) return [];
    const versions = await this.prisma.questionnaireVersion.findMany({
      where: { id: { in: [...new Set(rows.map((item) => item.questionnaireVersionId))] } },
      include: { questionnaire: { select: { code: true, labels: true } } },
    });
    const byVersion = new Map(versions.map((item) => [item.id, item]));
    const now = Date.now();
    return rows.map((item) => {
      const version = byVersion.get(item.questionnaireVersionId);
      return {
        id: item.id,
        patientId: item.patientId,
        appointmentId: item.appointmentId,
        context: item.context,
        dueAt: item.dueAt,
        status: item.status === "REQUESTED" && item.dueAt && item.dueAt.getTime() <= now ? "EXPIRED" : item.status,
        requestedAt: item.createdAt,
        completedAt: item.completedAt,
        responseId: item.responseId,
        code: version?.questionnaire.code ?? null,
        labels: version?.questionnaire.labels ?? null,
        questionnaireVersion: version?.version ?? null,
      };
    });
  }

  private async patientSelf(principal: AuthPrincipal) {
    if (principal.role !== "PATIENT") throw new ForbiddenException("Patient questionnaire request access requires PATIENT role.");
    const patient = await this.prisma.patientProfile.findUnique({
      where: { userId: principal.accountId },
      select: { id: true, userId: true },
    });
    if (!patient) throw new NotFoundException("Patient profile not found.");
    return patient;
  }

  private async questionnairePayload(row: EnvelopeRow) {
    return this.envelope.decryptRecord<{ answers: Record<string, unknown> }>({
      version: 1,
      algorithm: row.algorithm as "AES-256-GCM",
      keyId: row.keyId,
      wrappedKey: row.wrappedKey,
      iv: row.iv,
      ciphertext: row.ciphertext,
    });
  }

  private requestContext(value: unknown): "PRE_VISIT" | "POST_VISIT" | "FOLLOW_UP" {
    const normalized = String(value ?? "").trim().toUpperCase();
    if (!["PRE_VISIT", "POST_VISIT", "FOLLOW_UP"].includes(normalized)) {
      throw new BadRequestException("context is invalid.");
    }
    return normalized as "PRE_VISIT" | "POST_VISIT" | "FOLLOW_UP";
  }

  private idempotency(value: unknown) {
    if (typeof value !== "string") throw new BadRequestException("idempotencyKey is required.");
    const normalized = value.trim();
    if (normalized.length < 8 || normalized.length > 128 || /\p{Cc}/u.test(normalized)) {
      throw new BadRequestException("idempotencyKey is invalid.");
    }
    return normalized;
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

  private envelopeData(envelope: EncryptedEnvelope) { return { algorithm: envelope.algorithm, keyId: envelope.keyId, wrappedKey: envelope.wrappedKey, iv: envelope.iv, ciphertext: envelope.ciphertext }; }
  private presentFollowUp(row: any, payload: Record<string, unknown>) { return { id: row.id, appointmentId: row.appointmentId, patientId: row.patientId, providerId: row.providerId, version: row.version, status: row.status, releasedAt: row.releasedAt, followUp: payload, bookingCreated: false, createdAt: row.createdAt, updatedAt: row.updatedAt }; }
  private id(value: unknown, field: string) { if (typeof value !== "string") throw new BadRequestException(`${field} is required.`); const normalized = value.trim(); if (!/^[A-Za-z0-9_.:-]{1,180}$/.test(normalized)) throw new BadRequestException(`${field} is invalid.`); return normalized; }
  private token(value: unknown, field: string) { if (typeof value !== "string") throw new BadRequestException(`${field} is required.`); const normalized = value.trim().toUpperCase(); if (!/^[A-Z][A-Z0-9_:-]{1,79}$/.test(normalized)) throw new BadRequestException(`${field} is invalid.`); return normalized; }
  private positiveInteger(value: unknown, field: string) { if (!Number.isInteger(value) || Number(value) < 1) throw new BadRequestException(`${field} must be a positive integer.`); return Number(value); }
}
