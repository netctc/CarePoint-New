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
import { ClinicalEnvelopeService } from "../clinical/clinical-envelope.service";
import { NotificationsService } from "../communications/notifications.service";
import { ProviderCategoryCapabilityService } from "../providers/provider-category-capability.service";

const SAFE_ID = /^[A-Za-z0-9_.:-]{1,180}$/;
const IDEMPOTENCY = /^[A-Za-z0-9_.:-]{8,128}$/;
const TYPES = new Set([
  "FOLLOW_UP_VISIT",
  "PRIMARY_CARE_REVIEW",
  "SPECIALIST_REVIEW",
  "CARE_REVIEW",
  "OTHER",
]);
const LOOKBACK_DAYS = 365;
const LOOKAHEAD_DAYS = 30;
const MAX_RECOMMENDATION_HORIZON_DAYS = 730;

type CreateFollowUpInput = {
  appointmentId?: unknown;
  idempotencyKey?: unknown;
  recommendationType?: unknown;
  recommendedFor?: unknown;
  rationale?: unknown;
  instructions?: unknown;
};

type EnvelopeRow = {
  algorithm: string;
  keyId: string;
  wrappedKey: string;
  iv: string;
  ciphertext: string;
};

@Injectable()
export class ProviderFollowUpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
    private readonly envelope: ClinicalEnvelopeService,
    private readonly notifications: NotificationsService,
    private readonly capabilities: ProviderCategoryCapabilityService,
  ) {}

  async create(principal: AuthPrincipal, input: CreateFollowUpInput) {
    const context = await this.capabilities.workspaceContext(principal);
    const appointmentId = this.requiredId(input?.appointmentId, "appointmentId");
    const appointment = await this.prisma.appointment.findFirst({
      where: {
        id: appointmentId,
        providerId: context.providerId,
        status: { in: ["CONFIRMED", "COMPLETED"] },
      },
      select: {
        id: true,
        patientId: true,
        status: true,
        patient: { select: { userId: true } },
      },
    });
    if (!appointment) throw new NotFoundException("Assigned confirmed/completed appointment not found.");

    const idempotencyKey = this.idempotencyKey(input?.idempotencyKey);
    const recommendationType = this.recommendationType(input?.recommendationType);
    const recommendedFor = this.optionalFutureDate(input?.recommendedFor);
    const rationale = this.optionalText(input?.rationale, "rationale", 1200);
    const instructions = this.optionalText(input?.instructions, "instructions", 2000);
    const payload = {
      schemaVersion: 1,
      kind: "PROVIDER_FOLLOW_UP_RECOMMENDATION",
      recommendationType,
      recommendedFor: recommendedFor?.toISOString() ?? null,
      rationale: rationale ?? null,
      instructions: instructions ?? null,
      createsClinicalOrder: false,
      createsBooking: false,
      patientMustBookSeparately: true,
      automatedClinicalInference: false,
    };
    const encrypted = await this.envelope.encryptRecord(payload);
    const requestDigest = this.digest({
      providerId: context.providerId,
      patientId: appointment.patientId,
      appointmentId: appointment.id,
      recommendationType,
      recommendedFor: recommendedFor?.toISOString() ?? null,
      rationale: rationale ?? null,
      instructions: instructions ?? null,
    });

    const existing = await this.prisma.providerFollowUpRecommendation.findUnique({ where: { idempotencyKey } });
    if (existing) {
      if (existing.providerId !== context.providerId || existing.requestDigest !== requestDigest) {
        throw new ConflictException("idempotencyKey was already used with different follow-up content.");
      }
      return this.present(existing, await this.decrypt(existing));
    }

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const row = await tx.providerFollowUpRecommendation.create({
          data: {
            idempotencyKey,
            requestDigest,
            patientId: appointment.patientId,
            providerId: context.providerId,
            appointmentId: appointment.id,
            recommendationType,
            recommendedFor,
            ...this.envelopeData(encrypted),
          },
        });
        await this.notifications.enqueueAccountInTransaction(tx, {
          accountId: appointment.patient.userId,
          dedupeKey: `follow-up-recommendation:${row.id}`,
          type: "CARE_COORDINATION",
          entityType: "FOLLOW_UP_RECOMMENDATION",
          entityId: row.id,
          safeTitleKey: "notification.follow-up.title",
          safeBodyKey: "notification.follow-up.body",
        });
        await this.audit.writeClinicalInTransaction(tx, {
          actorId: principal.accountId,
          action: "PROVIDER_FOLLOW_UP_RECOMMENDATION_CREATED",
          objectType: "FOLLOW_UP_RECOMMENDATION",
          objectId: row.id,
          purpose: "TREATMENT",
          result: "SUCCESS",
          metadata: {
            domain: "CARE_COORDINATION",
            patientId: row.patientId,
            providerId: row.providerId,
            resourceId: row.id,
            appointmentId: row.appointmentId,
            recommendationType,
            createsClinicalOrder: false,
            createsBooking: false,
            decision: "ALLOW",
          },
        });
        return row;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      this.notifications.wakeOutbox();
      return this.present(created, payload);
    } catch (error) {
      if (!this.isUniqueConflict(error)) throw error;
      const raced = await this.prisma.providerFollowUpRecommendation.findUnique({ where: { idempotencyKey } });
      if (!raced || raced.providerId !== context.providerId || raced.requestDigest !== requestDigest) {
        throw new ConflictException("Follow-up recommendation changed concurrently.");
      }
      return this.present(raced, await this.decrypt(raced));
    }
  }

  async providerList(principal: AuthPrincipal, patientId: string) {
    const context = await this.capabilities.workspaceContext(principal);
    const patient = this.requiredId(patientId, "patientId");
    await this.requireTreatmentRelationship(context.providerId, patient);
    const rows = await this.prisma.providerFollowUpRecommendation.findMany({
      where: { providerId: context.providerId, patientId: patient },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    const items = [];
    for (const row of rows) items.push(this.present(row, await this.decrypt(row)));
    return { patientId: patient, items, automatedClinicalInference: false };
  }

  async patientList(principal: AuthPrincipal) {
    const patient = await this.requirePatient(principal);
    const rows = await this.prisma.providerFollowUpRecommendation.findMany({
      where: { patientId: patient.id },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    const items = [];
    for (const row of rows) items.push(this.present(row, await this.decrypt(row)));
    return { items, automatedClinicalInference: false };
  }

  async patientGet(principal: AuthPrincipal, recommendationId: string) {
    const patient = await this.requirePatient(principal);
    const id = this.requiredId(recommendationId, "recommendationId");
    const row = await this.prisma.providerFollowUpRecommendation.findFirst({
      where: { id, patientId: patient.id },
    });
    if (!row) throw new NotFoundException("Follow-up recommendation not found.");
    await this.audit.writeClinical({
      actorId: principal.accountId,
      action: "PATIENT_FOLLOW_UP_RECOMMENDATION_READ",
      objectType: "FOLLOW_UP_RECOMMENDATION",
      objectId: row.id,
      purpose: "PATIENT_ACCESS",
      result: "SUCCESS",
      metadata: {
        domain: "CARE_COORDINATION",
        patientId: patient.id,
        resourceId: row.id,
        decision: "ALLOW",
      },
    });
    return this.present(row, await this.decrypt(row));
  }

  private async requireTreatmentRelationship(providerId: string, patientId: string) {
    const now = new Date();
    const from = new Date(now.getTime() - LOOKBACK_DAYS * 86400000);
    const to = new Date(now.getTime() + LOOKAHEAD_DAYS * 86400000);
    const appointment = await this.prisma.appointment.findFirst({
      where: {
        providerId,
        patientId,
        status: { in: ["CONFIRMED", "COMPLETED"] },
        startsAt: { gte: from, lte: to },
      },
      select: { id: true },
    });
    if (!appointment) throw new ForbiddenException("Current treatment relationship is required.");
  }

  private async requirePatient(principal: AuthPrincipal) {
    if (principal.role !== "PATIENT") throw new ForbiddenException("Patient follow-up access requires PATIENT role.");
    const patient = await this.prisma.patientProfile.findUnique({
      where: { userId: principal.accountId },
      select: { id: true },
    });
    if (!patient) throw new NotFoundException("Patient profile not found.");
    return patient;
  }

  private present(row: {
    id: string;
    patientId: string;
    providerId: string;
    appointmentId: string;
    recommendationType: string;
    recommendedFor: Date | null;
    createdAt: Date;
  }, payload: Record<string, unknown>) {
    return {
      id: row.id,
      patientId: row.patientId,
      providerId: row.providerId,
      appointmentId: row.appointmentId,
      recommendationType: row.recommendationType,
      recommendedFor: row.recommendedFor,
      data: payload,
      recommendationOnly: true,
      createsClinicalOrder: false,
      createsBooking: false,
      patientMustBookSeparately: true,
      automatedClinicalInference: false,
      createdAt: row.createdAt,
    };
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
    return {
      algorithm: envelope.algorithm,
      keyId: envelope.keyId,
      wrappedKey: envelope.wrappedKey,
      iv: envelope.iv,
      ciphertext: envelope.ciphertext,
    };
  }

  private idempotencyKey(value: unknown): string {
    if (typeof value !== "string" || !IDEMPOTENCY.test(value.trim())) {
      throw new BadRequestException("idempotencyKey is invalid.");
    }
    return value.trim();
  }

  private requiredId(value: unknown, field: string): string {
    if (typeof value !== "string" || !SAFE_ID.test(value.trim())) throw new BadRequestException(`${field} is invalid.`);
    return value.trim();
  }

  private recommendationType(value: unknown): string {
    if (typeof value !== "string") throw new BadRequestException("recommendationType is required.");
    const normalized = value.trim().toUpperCase();
    if (!TYPES.has(normalized)) throw new BadRequestException("recommendationType is invalid.");
    return normalized;
  }

  private optionalFutureDate(value: unknown): Date | null {
    if (value == null || value === "") return null;
    const date = new Date(String(value));
    if (Number.isNaN(date.getTime())) throw new BadRequestException("recommendedFor must be a valid timestamp.");
    const now = Date.now();
    if (date.getTime() < now - 5 * 60 * 1000) throw new BadRequestException("recommendedFor cannot be in the past.");
    if (date.getTime() > now + MAX_RECOMMENDATION_HORIZON_DAYS * 86400000) {
      throw new BadRequestException(`recommendedFor cannot be more than ${MAX_RECOMMENDATION_HORIZON_DAYS} days ahead.`);
    }
    return date;
  }

  private optionalText(value: unknown, field: string, max: number): string | undefined {
    if (value == null || value === "") return undefined;
    if (typeof value !== "string") throw new BadRequestException(`${field} must be text.`);
    const text = value.trim();
    if (!text || text.length > max || /\p{Cc}/u.test(text)) throw new BadRequestException(`${field} is invalid.`);
    return text;
  }

  private digest(value: unknown) {
    return createHash("sha256").update(JSON.stringify(value)).digest("hex");
  }

  private isUniqueConflict(error: unknown): boolean {
    return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "P2002";
  }
}
