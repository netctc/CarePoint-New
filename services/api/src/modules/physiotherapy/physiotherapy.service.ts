import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { AuthPrincipal } from "@carepoint/identity";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { ProviderCategoryCapabilityService } from "../providers/provider-category-capability.service";

const TOKEN = /^[A-Z][A-Z0-9_]{1,79}$/;
const ID_TOKEN = /^[A-Za-z0-9_.:-]{1,180}$/;
const SIDES = ["LEFT", "RIGHT", "BILATERAL", "MIDLINE"] as const;
const MAX_HISTORY = 500;
const LOOKBACK_DAYS = 365;
const LOOKAHEAD_DAYS = 30;
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;
const MEASUREMENT_BACKDATE_DAYS = 30;

type Side = (typeof SIDES)[number];

type AssessmentInput = {
  appointmentId?: unknown;
  sourceFormResponseId?: unknown;
  score?: unknown;
  scoreMaximum?: unknown;
  painScore?: unknown;
  limitationCodes?: unknown;
};

type RomInput = {
  appointmentId?: unknown;
  idempotencyKey?: unknown;
  jointCode?: unknown;
  movementCode?: unknown;
  side?: unknown;
  degrees?: unknown;
  measuredAt?: unknown;
};

@Injectable()
export class PhysiotherapyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
    private readonly capabilities: ProviderCategoryCapabilityService,
  ) {}

  async createAssessment(principal: AuthPrincipal, input: AssessmentInput) {
    const context = await this.requirePhysiotherapyCapability(principal);
    const appointmentId = this.requiredId(input?.appointmentId, "appointmentId");
    const appointment = await this.requireAppointment(context.providerId, appointmentId);
    const sourceFormResponseId = this.requiredId(input?.sourceFormResponseId, "sourceFormResponseId");
    const source = await this.prisma.providerCategoryFormResponse.findUnique({
      where: { id: sourceFormResponseId },
      include: { form: true, formVersion: true },
    });
    if (!source) throw new NotFoundException("Provider category form response not found.");
    if (
      source.providerId !== context.providerId ||
      source.patientId !== appointment.patientId ||
      source.contextType !== "APPOINTMENT" ||
      source.contextId !== appointment.id
    ) {
      throw new ForbiddenException("Assessment source response must belong to this provider and appointment.");
    }

    const score = this.finiteNumber(input?.score, "score", -10000, 10000);
    const scoreMaximum = input?.scoreMaximum == null
      ? null
      : this.finiteNumber(input.scoreMaximum, "scoreMaximum", 0.000001, 10000);
    if (scoreMaximum != null && (score < 0 || score > scoreMaximum)) {
      throw new BadRequestException("score must be between 0 and scoreMaximum when scoreMaximum is supplied.");
    }
    const painScore = input?.painScore == null ? null : this.integer(input.painScore, "painScore", 0, 10);
    const limitationCodes = this.codeList(input?.limitationCodes, "limitationCodes", 20);
    const scaleCode = this.code(source.form.code, "source form code");

    const existing = await this.prisma.physioAssessment.findUnique({ where: { sourceFormResponseId } });
    if (existing) {
      if (existing.providerId !== context.providerId || existing.patientId !== appointment.patientId) {
        throw new ConflictException("Source response is already bound to another physiotherapy assessment.");
      }
      return this.presentAssessment(existing);
    }

    const created = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "Provider" WHERE id = ${context.providerId} FOR UPDATE`);
      const latest = await tx.physioAssessment.findFirst({
        where: { patientId: appointment.patientId, providerId: context.providerId, scaleCode },
        orderBy: { sequence: "desc" },
        select: { sequence: true },
      });
      const assessment = await tx.physioAssessment.create({
        data: {
          patientId: appointment.patientId,
          providerId: context.providerId,
          appointmentId: appointment.id,
          sourceFormResponseId: source.id,
          sourceFormId: source.formId,
          sourceFormVersion: source.formVersion.version,
          sourceResponseSequence: source.sequence,
          scaleCode,
          score,
          scoreMaximum,
          painScore,
          limitationCodes,
          sequence: (latest?.sequence ?? 0) + 1,
          assessedAt: source.submittedAt,
        },
      });
      await this.audit.writeClinicalInTransaction(tx, {
        actorId: principal.accountId,
        action: "PHYSIO_ASSESSMENT_RECORDED",
        objectType: "PHYSIO_ASSESSMENT",
        objectId: assessment.id,
        purpose: "TREATMENT",
        result: "SUCCESS",
        metadata: {
          domain: "PHYSIOTHERAPY",
          providerId: context.providerId,
          patientId: appointment.patientId,
          resourceId: assessment.id,
          resourceVersion: assessment.sequence,
          scaleCode,
          sourceFormVersion: source.formVersion.version,
          decision: "ALLOW",
        },
      });
      return assessment;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return this.presentAssessment(created);
  }

  async assessmentHistory(principal: AuthPrincipal, patientId: string, rawScaleCode?: string) {
    const context = await this.requirePhysiotherapyCapability(principal);
    const patient = this.requiredId(patientId, "patientId");
    await this.requirePatientAccess(context.providerId, patient);
    const scaleCode = rawScaleCode?.trim() ? this.code(rawScaleCode, "scaleCode") : null;
    const items = await this.prisma.physioAssessment.findMany({
      where: {
        patientId: patient,
        providerId: context.providerId,
        ...(scaleCode ? { scaleCode } : {}),
      },
      orderBy: [{ assessedAt: "asc" }, { sequence: "asc" }],
      take: MAX_HISTORY,
    });
    await this.audit.writeClinical({
      actorId: principal.accountId,
      action: "PHYSIO_ASSESSMENT_HISTORY_READ",
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
    return {
      patientId: patient,
      scaleCode,
      sourceResponsesEncryptedAtRest: true,
      automatedClinicalInference: false,
      items: items.map((item) => this.presentAssessment(item)),
    };
  }

  async recordRangeOfMotion(principal: AuthPrincipal, input: RomInput) {
    const context = await this.requirePhysiotherapyCapability(principal);
    const appointmentId = this.requiredId(input?.appointmentId, "appointmentId");
    const appointment = await this.requireAppointment(context.providerId, appointmentId);
    const idempotencyKey = this.idempotencyKey(input?.idempotencyKey);
    const jointCode = this.code(input?.jointCode, "jointCode");
    const movementCode = this.code(input?.movementCode, "movementCode");
    const side = this.side(input?.side);
    const degrees = this.finiteNumber(input?.degrees, "degrees", -360, 360);
    const measuredAt = this.measurementDate(input?.measuredAt);

    const existing = await this.prisma.rangeOfMotionObservation.findUnique({ where: { idempotencyKey } });
    if (existing) {
      if (existing.providerId !== context.providerId || existing.patientId !== appointment.patientId) {
        throw new ConflictException("idempotencyKey is already in use for another ROM observation.");
      }
      return this.presentRom(existing);
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const observation = await tx.rangeOfMotionObservation.create({
        data: {
          idempotencyKey,
          patientId: appointment.patientId,
          providerId: context.providerId,
          appointmentId: appointment.id,
          jointCode,
          movementCode,
          side,
          degrees,
          measuredAt,
        },
      });
      await this.audit.writeClinicalInTransaction(tx, {
        actorId: principal.accountId,
        action: "PHYSIO_ROM_RECORDED",
        objectType: "RANGE_OF_MOTION_OBSERVATION",
        objectId: observation.id,
        purpose: "TREATMENT",
        result: "SUCCESS",
        metadata: {
          domain: "PHYSIOTHERAPY",
          providerId: context.providerId,
          patientId: appointment.patientId,
          resourceId: observation.id,
          jointCode,
          movementCode,
          side,
          decision: "ALLOW",
        },
      });
      return observation;
    });
    return this.presentRom(created);
  }

  async rangeOfMotionHistory(
    principal: AuthPrincipal,
    patientId: string,
    filters: { jointCode?: string; movementCode?: string; side?: string },
  ) {
    const context = await this.requirePhysiotherapyCapability(principal);
    const patient = this.requiredId(patientId, "patientId");
    await this.requirePatientAccess(context.providerId, patient);
    const jointCode = filters.jointCode?.trim() ? this.code(filters.jointCode, "jointCode") : null;
    const movementCode = filters.movementCode?.trim() ? this.code(filters.movementCode, "movementCode") : null;
    const side = filters.side?.trim() ? this.side(filters.side) : null;
    const items = await this.prisma.rangeOfMotionObservation.findMany({
      where: {
        patientId: patient,
        providerId: context.providerId,
        ...(jointCode ? { jointCode } : {}),
        ...(movementCode ? { movementCode } : {}),
        ...(side ? { side } : {}),
      },
      orderBy: [{ measuredAt: "asc" }, { createdAt: "asc" }],
      take: MAX_HISTORY,
    });
    await this.audit.writeClinical({
      actorId: principal.accountId,
      action: "PHYSIO_ROM_HISTORY_READ",
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
    return {
      patientId: patient,
      filters: { jointCode, movementCode, side },
      unit: "deg",
      graphReady: true,
      automatedClinicalInference: false,
      items: items.map((item) => this.presentRom(item)),
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
      where: {
        id: appointmentId,
        providerId,
        status: { in: ["CONFIRMED", "COMPLETED"] },
      },
      select: { id: true, patientId: true, startsAt: true, status: true },
    });
    if (!appointment) throw new ForbiddenException("Authorized physiotherapy appointment context is required.");
    return appointment;
  }

  private async requirePatientAccess(providerId: string, patientId: string) {
    const now = new Date();
    const from = new Date(now.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    const to = new Date(now.getTime() + LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000);
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

  private presentAssessment(item: {
    id: string;
    patientId: string;
    providerId: string;
    appointmentId: string;
    sourceFormResponseId: string;
    sourceFormId: string;
    sourceFormVersion: number;
    sourceResponseSequence: number;
    scaleCode: string;
    score: number;
    scoreMaximum: number | null;
    painScore: number | null;
    limitationCodes: string[];
    sequence: number;
    assessedAt: Date;
    createdAt: Date;
  }) {
    return {
      id: item.id,
      patientId: item.patientId,
      providerId: item.providerId,
      appointmentId: item.appointmentId,
      scaleCode: item.scaleCode,
      score: item.score,
      scoreMaximum: item.scoreMaximum,
      painScore: item.painScore,
      limitationCodes: item.limitationCodes,
      sequence: item.sequence,
      assessedAt: item.assessedAt,
      createdAt: item.createdAt,
      sourceEvidence: {
        formId: item.sourceFormId,
        formVersion: item.sourceFormVersion,
        responseId: item.sourceFormResponseId,
        responseSequence: item.sourceResponseSequence,
        encryptedAtRest: true,
      },
      automatedClinicalInference: false,
    };
  }

  private presentRom(item: {
    id: string;
    patientId: string;
    providerId: string;
    appointmentId: string;
    jointCode: string;
    movementCode: string;
    side: string;
    degrees: number;
    measuredAt: Date;
    createdAt: Date;
  }) {
    return {
      id: item.id,
      patientId: item.patientId,
      providerId: item.providerId,
      appointmentId: item.appointmentId,
      jointCode: item.jointCode,
      movementCode: item.movementCode,
      side: item.side,
      degrees: item.degrees,
      unit: "deg",
      measuredAt: item.measuredAt,
      createdAt: item.createdAt,
      automatedClinicalInference: false,
    };
  }

  private requiredId(value: unknown, field: string): string {
    if (typeof value !== "string" || !ID_TOKEN.test(value.trim())) {
      throw new BadRequestException(`${field} is invalid.`);
    }
    return value.trim();
  }

  private code(value: unknown, field: string): string {
    if (typeof value !== "string") throw new BadRequestException(`${field} is required.`);
    const normalized = value.trim().toUpperCase();
    if (!TOKEN.test(normalized)) throw new BadRequestException(`${field} is invalid.`);
    return normalized;
  }

  private codeList(value: unknown, field: string, maxItems: number): string[] {
    if (value == null) return [];
    if (!Array.isArray(value) || value.length > maxItems) {
      throw new BadRequestException(`${field} must contain at most ${maxItems} codes.`);
    }
    return [...new Set(value.map((item) => this.code(item, field)))];
  }

  private finiteNumber(value: unknown, field: string, min: number, max: number): number {
    if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
      throw new BadRequestException(`${field} must be a finite number between ${min} and ${max}.`);
    }
    return value;
  }

  private integer(value: unknown, field: string, min: number, max: number): number {
    if (!Number.isInteger(value) || Number(value) < min || Number(value) > max) {
      throw new BadRequestException(`${field} must be an integer between ${min} and ${max}.`);
    }
    return Number(value);
  }

  private side(value: unknown): Side {
    if (typeof value !== "string") throw new BadRequestException("side is required.");
    const normalized = value.trim().toUpperCase();
    if (!(SIDES as readonly string[]).includes(normalized)) {
      throw new BadRequestException(`side must be one of: ${SIDES.join(", ")}.`);
    }
    return normalized as Side;
  }

  private idempotencyKey(value: unknown): string {
    if (typeof value !== "string") throw new BadRequestException("idempotencyKey is required.");
    const normalized = value.trim();
    if (normalized.length < 8 || normalized.length > 128 || !/^[A-Za-z0-9_.:-]+$/.test(normalized)) {
      throw new BadRequestException("idempotencyKey must contain 8-128 safe characters.");
    }
    return normalized;
  }

  private measurementDate(value: unknown): Date {
    const date = value == null ? new Date() : new Date(String(value));
    if (Number.isNaN(date.getTime())) throw new BadRequestException("measuredAt must be a valid timestamp.");
    const now = Date.now();
    if (date.getTime() > now + FUTURE_TOLERANCE_MS) throw new BadRequestException("measuredAt cannot be in the future.");
    if (date.getTime() < now - MEASUREMENT_BACKDATE_DAYS * 24 * 60 * 60 * 1000) {
      throw new BadRequestException(`measuredAt cannot be backdated more than ${MEASUREMENT_BACKDATE_DAYS} days.`);
    }
    return date;
  }
}
