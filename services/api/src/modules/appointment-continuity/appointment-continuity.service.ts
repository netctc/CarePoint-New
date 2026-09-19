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

  private envelopeData(envelope: EncryptedEnvelope) { return { algorithm: envelope.algorithm, keyId: envelope.keyId, wrappedKey: envelope.wrappedKey, iv: envelope.iv, ciphertext: envelope.ciphertext }; }
  private presentFollowUp(row: any, payload: Record<string, unknown>) { return { id: row.id, appointmentId: row.appointmentId, patientId: row.patientId, providerId: row.providerId, version: row.version, status: row.status, releasedAt: row.releasedAt, followUp: payload, bookingCreated: false, createdAt: row.createdAt, updatedAt: row.updatedAt }; }
  private id(value: unknown, field: string) { if (typeof value !== "string") throw new BadRequestException(`${field} is required.`); const normalized = value.trim(); if (!/^[A-Za-z0-9_.:-]{1,180}$/.test(normalized)) throw new BadRequestException(`${field} is invalid.`); return normalized; }
  private token(value: unknown, field: string) { if (typeof value !== "string") throw new BadRequestException(`${field} is required.`); const normalized = value.trim().toUpperCase(); if (!/^[A-Z][A-Z0-9_:-]{1,79}$/.test(normalized)) throw new BadRequestException(`${field} is invalid.`); return normalized; }
  private positiveInteger(value: unknown, field: string) { if (!Number.isInteger(value) || Number(value) < 1) throw new BadRequestException(`${field} must be a positive integer.`); return Number(value); }
}
