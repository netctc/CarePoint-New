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
import { ProviderCategoryCapabilityService } from "../providers/provider-category-capability.service";

const MEAL_TYPES = new Set(["BREAKFAST","LUNCH","DINNER","SNACK","OTHER"]);
const HEALTH_PROFILE_SCOPE = "HEALTH_PROFILE_READ";
const HEALTH_PROFILE_VERSION = "health-profile-v1";
const MAX_BACKDATE_DAYS = 365;
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

type DiaryPayload = {
  schemaVersion: 1;
  description: string;
  notes: string | null;
  source: "PATIENT_REPORTED";
};

type CommentPayload = {
  schemaVersion: 1;
  comment: string;
  source: "PROFESSIONAL_COMMENT";
  modifiesPatientEntry: false;
};

@Injectable()
export class FoodDiaryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
    private readonly envelope: ClinicalEnvelopeService,
    private readonly capabilities: ProviderCategoryCapabilityService,
  ) {}

  async patientList(principal: AuthPrincipal) {
    const patient = await this.patientSelf(principal);
    const rows = await this.prisma.foodDiaryEntry.findMany({
      where: { patientId: patient.id },
      include: { comments: { orderBy: { createdAt: "asc" } } },
      orderBy: [{ mealAt: "desc" }, { createdAt: "desc" }],
      take: 500,
    });
    const items = [];
    for (const row of rows) items.push(await this.presentEntry(row, true));
    return { patientId: patient.id, items, patientReported: true };
  }

  async patientCreate(principal: AuthPrincipal, raw: Record<string, unknown>) {
    const patient = await this.patientSelf(principal);
    const idempotencyKey = this.idempotency(raw.idempotencyKey);
    const mealAt = this.mealDate(raw.mealAt);
    const mealType = this.mealType(raw.mealType);
    const description = this.text(raw.description, "description", 4000, true)!;
    const notes = this.text(raw.notes, "notes", 4000, false) ?? null;
    const shared = raw.shared === true;

    const existing = await this.prisma.foodDiaryEntry.findUnique({ where: { idempotencyKey } });
    if (existing) {
      if (existing.patientId !== patient.id) throw new ConflictException("idempotencyKey belongs to another patient.");
      return this.presentEntry(existing, true);
    }

    const encrypted = await this.envelope.encryptRecord({
      schemaVersion: 1,
      description,
      notes,
      source: "PATIENT_REPORTED",
    } satisfies DiaryPayload);

    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.foodDiaryEntry.create({
        data: {
          idempotencyKey,
          patientId: patient.id,
          mealAt,
          mealType,
          shared,
          ...this.envelopeData(encrypted),
        },
      });
      await this.audit.writeClinicalInTransaction(tx, {
        actorId: principal.accountId,
        action: "FOOD_DIARY_ENTRY_CREATED",
        objectType: "FOOD_DIARY_ENTRY",
        objectId: row.id,
        purpose: "PATIENT_ACCESS",
        result: "SUCCESS",
        metadata: {
          domain: "NUTRITION",
          patientId: patient.id,
          resourceId: row.id,
          resourceVersion: row.version,
          mealType,
          shared,
          patientReported: true,
          clinicalContentInAudit: false,
          decision: "ALLOW",
        },
      });
      return row;
    });
    return this.presentEntry(created, true);
  }

  async patientSetSharing(
    principal: AuthPrincipal,
    entryIdRaw: string,
    raw: Record<string, unknown>,
  ) {
    const patient = await this.patientSelf(principal);
    const entryId = this.id(entryIdRaw, "entryId");
    const expectedVersion = this.positiveInteger(raw.expectedVersion, "expectedVersion");
    if (typeof raw.shared !== "boolean") throw new BadRequestException("shared must be boolean.");
    const result = await this.prisma.foodDiaryEntry.updateMany({
      where: { id: entryId, patientId: patient.id, version: expectedVersion },
      data: { shared: raw.shared, version: { increment: 1 } },
    });
    if (result.count !== 1) throw new ConflictException("Food diary sharing version conflict.");
    const row = await this.prisma.foodDiaryEntry.findUnique({ where: { id: entryId } });
    if (!row) throw new NotFoundException("Food diary entry not found.");
    await this.audit.writeClinical({
      actorId: principal.accountId,
      action: raw.shared ? "FOOD_DIARY_ENTRY_SHARED" : "FOOD_DIARY_ENTRY_UNSHARED",
      objectType: "FOOD_DIARY_ENTRY",
      objectId: row.id,
      purpose: "PATIENT_ACCESS",
      result: "SUCCESS",
      metadata: {
        domain: "NUTRITION",
        patientId: patient.id,
        resourceId: row.id,
        resourceVersion: row.version,
        shared: row.shared,
        clinicalContentInAudit: false,
        decision: "ALLOW",
      },
    });
    return this.presentEntry(row, true);
  }

  async providerList(
    principal: AuthPrincipal,
    patientIdRaw: string,
    appointmentIdRaw: string,
  ) {
    const context = await this.requireNutrition(principal);
    const patientId = this.id(patientIdRaw, "patientId");
    const appointmentId = this.id(appointmentIdRaw, "appointmentId");
    await this.requireAppointment(context.providerId, patientId, appointmentId);
    await this.requireConsent(context.providerId, patientId);

    const rows = await this.prisma.foodDiaryEntry.findMany({
      where: { patientId, shared: true },
      include: { comments: { orderBy: { createdAt: "asc" } } },
      orderBy: [{ mealAt: "desc" }, { createdAt: "desc" }],
      take: 500,
    });
    const items = [];
    for (const row of rows) items.push(await this.presentEntry(row, false));

    await this.audit.writeClinical({
      actorId: principal.accountId,
      action: "FOOD_DIARY_SHARED_READ",
      objectType: "PATIENT",
      objectId: patientId,
      purpose: "TREATMENT",
      result: "SUCCESS",
      metadata: {
        domain: "NUTRITION",
        patientId,
        providerId: context.providerId,
        appointmentId,
        itemCount: items.length,
        consentScope: HEALTH_PROFILE_SCOPE,
        sharedOnly: true,
        decision: "ALLOW",
      },
    });
    return {
      patientId,
      providerId: context.providerId,
      appointmentId,
      items,
      sharedOnly: true,
      consentScope: HEALTH_PROFILE_SCOPE,
      professionalCommentsModifyEntry: false,
    };
  }

  async providerComment(
    principal: AuthPrincipal,
    entryIdRaw: string,
    raw: Record<string, unknown>,
  ) {
    const context = await this.requireNutrition(principal);
    const entryId = this.id(entryIdRaw, "entryId");
    const appointmentId = this.id(raw.appointmentId, "appointmentId");
    const idempotencyKey = this.idempotency(raw.idempotencyKey);
    const comment = this.text(raw.comment, "comment", 4000, true)!;

    const entry = await this.prisma.foodDiaryEntry.findUnique({ where: { id: entryId } });
    if (!entry || !entry.shared) throw new NotFoundException("Shared food diary entry not found.");
    await this.requireAppointment(context.providerId, entry.patientId, appointmentId);
    await this.requireConsent(context.providerId, entry.patientId);

    const existing = await this.prisma.foodDiaryProfessionalComment.findUnique({ where: { idempotencyKey } });
    if (existing) {
      if (existing.entryId !== entry.id || existing.providerId !== context.providerId) {
        throw new ConflictException("idempotencyKey belongs to another food diary comment.");
      }
      return this.presentComment(existing);
    }

    const encrypted = await this.envelope.encryptRecord({
      schemaVersion: 1,
      comment,
      source: "PROFESSIONAL_COMMENT",
      modifiesPatientEntry: false,
    } satisfies CommentPayload);

    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.foodDiaryProfessionalComment.create({
        data: {
          idempotencyKey,
          entryId: entry.id,
          providerId: context.providerId,
          appointmentId,
          ...this.envelopeData(encrypted),
        },
      });
      await this.audit.writeClinicalInTransaction(tx, {
        actorId: principal.accountId,
        action: "FOOD_DIARY_PROFESSIONAL_COMMENT_ADDED",
        objectType: "FOOD_DIARY_PROFESSIONAL_COMMENT",
        objectId: row.id,
        purpose: "TREATMENT",
        result: "SUCCESS",
        metadata: {
          domain: "NUTRITION",
          patientId: entry.patientId,
          providerId: context.providerId,
          appointmentId,
          resourceId: row.id,
          foodDiaryEntryId: entry.id,
          modifiesPatientEntry: false,
          clinicalContentInAudit: false,
          decision: "ALLOW",
        },
      });
      return row;
    });

    return this.presentComment(created);
  }

  private async presentEntry(
    row: {
      id: string;
      patientId: string;
      mealAt: Date;
      mealType: string;
      shared: boolean;
      version: number;
      algorithm: string;
      keyId: string;
      wrappedKey: string;
      iv: string;
      ciphertext: string;
      createdAt: Date;
      updatedAt: Date;
      comments?: Array<{
        id: string; entryId: string; providerId: string; appointmentId: string;
        algorithm: string; keyId: string; wrappedKey: string; iv: string; ciphertext: string; createdAt: Date;
      }>;
    },
    patientView: boolean,
  ) {
    const data = await this.decrypt<DiaryPayload>(row);
    const comments = [];
    for (const comment of row.comments ?? []) comments.push(await this.presentComment(comment));
    return {
      id: row.id,
      patientId: row.patientId,
      mealAt: row.mealAt,
      mealType: row.mealType,
      shared: row.shared,
      version: row.version,
      data,
      comments,
      patientReported: true,
      professionalCommentsModifyEntry: false,
      patientView,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private async presentComment(row: {
    id: string; entryId: string; providerId: string; appointmentId: string;
    algorithm: string; keyId: string; wrappedKey: string; iv: string; ciphertext: string; createdAt: Date;
  }) {
    const data = await this.decrypt<CommentPayload>(row);
    return {
      id: row.id,
      entryId: row.entryId,
      providerId: row.providerId,
      appointmentId: row.appointmentId,
      data,
      modifiesPatientEntry: false,
      appendOnly: true,
      createdAt: row.createdAt,
    };
  }

  private async requireNutrition(principal: AuthPrincipal) {
    const context = await this.capabilities.workspaceContext(principal);
    if (!context.clinicalOrderCapabilities.has("NUTRITION")) {
      throw new ForbiddenException("Other Provider category is not authorized for NUTRITION.");
    }
    return context;
  }

  private async requireAppointment(providerId: string, patientId: string, appointmentId: string) {
    const row = await this.prisma.appointment.findFirst({
      where: {
        id: appointmentId,
        providerId,
        patientId,
        status: { in: ["CONFIRMED","COMPLETED"] },
      },
      select: { id: true },
    });
    if (!row) throw new ForbiddenException("Authorized nutrition appointment context is required.");
  }

  private async requireConsent(providerId: string, patientId: string) {
    const now = new Date();
    const consent = await this.prisma.consent.findFirst({
      where: {
        patientId,
        providerId,
        scope: HEALTH_PROFILE_SCOPE,
        version: HEALTH_PROFILE_VERSION,
        purpose: "TREATMENT",
        state: "GRANTED",
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      select: { id: true },
      orderBy: { grantedAt: "desc" },
    });
    if (!consent) throw new ForbiddenException("Active HEALTH_PROFILE_READ consent is required for food diary access.");
  }

  private async patientSelf(principal: AuthPrincipal) {
    if (principal.role !== "PATIENT") throw new ForbiddenException("Patient food diary access requires PATIENT role.");
    const patient = await this.prisma.patientProfile.findUnique({
      where: { userId: principal.accountId },
      select: { id: true },
    });
    if (!patient) throw new NotFoundException("Patient profile not found.");
    return patient;
  }

  private mealDate(value: unknown) {
    if (typeof value !== "string") throw new BadRequestException("mealAt is required.");
    const parsed = new Date(value);
    if (!Number.isFinite(parsed.getTime())) throw new BadRequestException("mealAt must be a valid ISO date-time.");
    const now = Date.now();
    if (parsed.getTime() > now + FUTURE_TOLERANCE_MS) throw new BadRequestException("mealAt cannot be in the future.");
    if (parsed.getTime() < now - MAX_BACKDATE_DAYS * 86400000) throw new BadRequestException("mealAt is too old.");
    return parsed;
  }

  private mealType(value: unknown) {
    const normalized = typeof value === "string" ? value.trim().toUpperCase() : "";
    if (!MEAL_TYPES.has(normalized)) throw new BadRequestException("mealType is invalid.");
    return normalized;
  }

  private text(value: unknown, field: string, max: number, required: boolean) {
    if (value == null || value === "") {
      if (required) throw new BadRequestException(`${field} is required.`);
      return undefined;
    }
    if (typeof value !== "string") throw new BadRequestException(`${field} must be text.`);
    const normalized = value.trim();
    if ((required && !normalized) || normalized.length > max || /\0/.test(normalized)) {
      throw new BadRequestException(`${field} is invalid.`);
    }
    return normalized || undefined;
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
    if (normalized.length < 8 || normalized.length > 128 || !/^[A-Za-z0-9_.:-]+$/.test(normalized)) {
      throw new BadRequestException("idempotencyKey must contain 8-128 safe characters.");
    }
    return normalized;
  }

  private positiveInteger(value: unknown, field: string) {
    if (!Number.isInteger(value) || Number(value) < 1) throw new BadRequestException(`${field} must be a positive integer.`);
    return Number(value);
  }

  private async decrypt<T>(row: { algorithm:string; keyId:string; wrappedKey:string; iv:string; ciphertext:string }) {
    if (row.algorithm !== "AES-256-GCM") throw new ConflictException("Unsupported food diary encryption algorithm.");
    return this.envelope.decryptRecord<T>({
      version: 1,
      algorithm: "AES-256-GCM",
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
