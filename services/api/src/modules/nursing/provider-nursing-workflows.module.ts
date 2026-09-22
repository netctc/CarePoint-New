import { createHash } from "node:crypto";
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Header,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Post,
} from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { Prisma } from "@prisma/client";
import type { EncryptedEnvelope } from "@carepoint/security";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { CurrentPrincipal, RequirePermissions } from "../../security/api-security.module";
import { ClinicalEnvelopeService } from "../clinical/clinical-envelope.service";
import { ClinicalModule } from "../clinical/clinical.module";
import { OrdersAttestationService } from "../orders/orders-attestation.service";
import { OrdersModule } from "../orders/orders.module";
import { OrdersService } from "../orders/orders.service";
import { ProviderCategoryFormsModule } from "../provider-category-forms/provider-category-forms.module";
import { ProviderCategoryFormsService } from "../provider-category-forms/provider-category-forms.service";
import { ProviderCategoryCapabilityService } from "../providers/provider-category-capability.service";
import { ProvidersModule } from "../providers/providers.module";

const SAFE_ID = /^[A-Za-z0-9_.:-]{1,180}$/;
const SAFE_CODE = /^[A-Z][A-Z0-9_.:-]{1,79}$/;
const IDEMPOTENCY = /^[A-Za-z0-9_.:-]{8,128}$/;
const ADMINISTRATION_STATUSES = new Set(["ADMINISTERED", "OMITTED"]);
const MAX_HISTORY = 250;
const TREATMENT_LOOKBACK_MS = 365 * 24 * 60 * 60 * 1000;
const TREATMENT_LOOKAHEAD_MS = 30 * 24 * 60 * 60 * 1000;

type JsonObject = Record<string, unknown>;
type NursingContext = {
  providerId: string;
  patientId: string;
  appointmentId: string;
};

@Injectable()
class ProviderNursingWorkflowsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
    private readonly capabilities: ProviderCategoryCapabilityService,
    private readonly orders: OrdersService,
    private readonly envelope: ClinicalEnvelopeService,
    private readonly attestation: OrdersAttestationService,
    private readonly forms: ProviderCategoryFormsService,
  ) {}

  async eligiblePrescriptions(principal: AuthPrincipal, appointmentIdRaw: string) {
    const context = await this.requireAppointmentContext(principal, "MED_ADMIN", appointmentIdRaw);
    const result = await this.orders.providerPatientOrders(principal, context.patientId);
    const items = result.items
      .filter((item) => item.type === "PRESCRIPTION" && item.status === "SIGNED")
      .map((item) => ({
        id: item.id,
        status: item.status,
        signedAt: item.signedAt,
        prescriberProviderId: item.providerId,
        medication: this.objectValue(item.data).medication ?? null,
        dosageInstruction: this.objectValue(item.data).dosageInstruction ?? null,
        route: this.objectValue(item.data).route ?? null,
      }));
    return {
      appointmentId: context.appointmentId,
      patientId: context.patientId,
      items,
      administrationCapability: "MED_ADMIN",
      prescribingCapabilityGranted: false,
    };
  }

  async administerMedication(principal: AuthPrincipal, input: JsonObject) {
    const appointmentId = this.requiredId(input.appointmentId, "appointmentId");
    const context = await this.requireAppointmentContext(principal, "MED_ADMIN", appointmentId);
    const prescriptionOrderId = this.requiredId(input.prescriptionOrderId, "prescriptionOrderId");
    const status = this.enumValue(input.status ?? "ADMINISTERED", ADMINISTRATION_STATUSES, "status");
    const administeredAt = this.effectiveTime(input.administeredAt, "administeredAt");
    const idempotencyKey = this.idempotencyKey(input.idempotencyKey);

    const accessibleOrders = await this.orders.providerPatientOrders(principal, context.patientId);
    const source = accessibleOrders.items.find((item) => item.id === prescriptionOrderId);
    if (!source || source.type !== "PRESCRIPTION" || source.status !== "SIGNED") {
      throw new ConflictException("Medication administration requires an active accessible signed prescription.");
    }

    const administration = status === "ADMINISTERED"
      ? {
          status,
          dose: this.requiredText(input.dose, 200, "dose"),
          route: this.requiredText(input.route, 120, "route"),
          ...(this.optionalText(input.note, 1000) ? { note: this.optionalText(input.note, 1000) } : {}),
        }
      : {
          status,
          omissionReason: this.requiredText(input.omissionReason, 500, "omissionReason"),
        };

    const requestDigest = this.digest({
      prescriptionOrderId,
      appointmentId: context.appointmentId,
      patientId: context.patientId,
      providerId: context.providerId,
      administeredAt: administeredAt.toISOString(),
      administration,
    });
    const existing = await this.prisma.medicationAdministration.findUnique({ where: { idempotencyKey } });
    if (existing) return this.replayMedication(existing, requestDigest);

    const encrypted = await this.envelope.encryptRecord({
      schemaVersion: 1,
      prescriptionOrderId,
      administration,
      administeredAt: administeredAt.toISOString(),
    });
    const signature = await this.attestation.attest({
      prescriptionOrderId,
      appointmentId: context.appointmentId,
      patientId: context.patientId,
      providerId: context.providerId,
      administrationStatus: status,
      administeredAt: administeredAt.toISOString(),
      envelope: encrypted,
    });

    let created;
    try {
      created = await this.prisma.$transaction(async (tx) => {
        await this.audit.reserveIntegrityChainForSerializableTransaction(tx);
        await tx.$queryRaw(Prisma.sql`SELECT id FROM "ClinicalOrder" WHERE id = ${prescriptionOrderId} FOR UPDATE`);
        const lockedOrder = await tx.clinicalOrder.findUnique({ where: { id: prescriptionOrderId } });
        if (!lockedOrder || lockedOrder.patientId !== context.patientId || lockedOrder.type !== "PRESCRIPTION" || lockedOrder.status !== "SIGNED") {
          throw new ConflictException("The prescription is no longer active for medication administration.");
        }
        const row = await tx.medicationAdministration.create({
          data: {
            idempotencyKey,
            requestDigest,
            prescriptionOrderId,
            appointmentId: context.appointmentId,
            patientId: context.patientId,
            providerId: context.providerId,
            sourceActorId: principal.accountId,
            administrationStatus: status,
            administeredAt,
            ...this.envelopeData(encrypted),
            payloadDigest: signature.payloadDigest,
            signatureAlgorithm: signature.algorithm,
            signatureKeyId: signature.keyId,
            signature: signature.signature,
            signedAt: signature.signedAt,
          },
        });
        await this.audit.writeClinicalInTransaction(tx, {
          actorId: principal.accountId,
          action: "MEDICATION_ADMINISTRATION_RECORDED",
          objectType: "MEDICATION_ADMINISTRATION",
          objectId: row.id,
          purpose: "TREATMENT",
          result: "SUCCESS",
          metadata: {
            domain: "NURSING_WORKFLOW",
            providerId: context.providerId,
            patientId: context.patientId,
            appointmentId: context.appointmentId,
            prescriptionOrderId,
            administrationStatus: status,
            signed: true,
            decision: "ALLOW",
          },
        });
        return row;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (!this.uniqueConflict(error)) throw error;
      const raced = await this.prisma.medicationAdministration.findUnique({ where: { idempotencyKey } });
      if (!raced) throw error;
      return this.replayMedication(raced, requestDigest);
    }
    return this.presentMedication(created);
  }

  async medicationHistory(principal: AuthPrincipal, patientIdRaw: string) {
    const patientId = this.requiredId(patientIdRaw, "patientId");
    const providerId = await this.requirePatientRelationship(principal, "MED_ADMIN", patientId);
    const rows = await this.prisma.medicationAdministration.findMany({
      where: { patientId, providerId },
      orderBy: [{ administeredAt: "desc" }, { createdAt: "desc" }],
      take: MAX_HISTORY,
    });
    const items = await Promise.all(rows.map((row) => this.presentMedication(row)));
    await this.audit.writeClinical({
      actorId: principal.accountId,
      action: "MEDICATION_ADMINISTRATION_HISTORY_READ",
      objectType: "PATIENT",
      objectId: patientId,
      purpose: "TREATMENT",
      result: "SUCCESS",
      metadata: { domain: "NURSING_WORKFLOW", providerId, patientId, itemCount: items.length, decision: "ALLOW" },
    });
    return { patientId, items, appendOnly: true };
  }

  async createWoundAssessment(principal: AuthPrincipal, input: JsonObject) {
    const appointmentId = this.requiredId(input.appointmentId, "appointmentId");
    const context = await this.requireAppointmentContext(principal, "WOUND_CARE", appointmentId);
    const idempotencyKey = this.idempotencyKey(input.idempotencyKey);
    const assessedAt = this.effectiveTime(input.assessedAt, "assessedAt");
    const clinicalMediaId = input.clinicalMediaId == null || input.clinicalMediaId === ""
      ? null
      : this.requiredId(input.clinicalMediaId, "clinicalMediaId");
    if (clinicalMediaId) {
      const evidence = await this.prisma.providerFieldMediaEvidence.findFirst({
        where: {
          clinicalMediaId,
          appointmentId: context.appointmentId,
          patientId: context.patientId,
          providerId: context.providerId,
        },
        select: { id: true },
      });
      if (!evidence) {
        throw new ForbiddenException("Wound photos must be captured through the consented encrypted field-media workflow for this appointment.");
      }
    }

    const dimensions = this.object(input.dimensionsCm, "dimensionsCm");
    const payload = {
      siteCode: this.code(input.siteCode, "siteCode"),
      woundType: this.code(input.woundType, "woundType"),
      dimensionsCm: {
        length: this.positiveNumber(dimensions.length, 100, "dimensionsCm.length"),
        width: this.positiveNumber(dimensions.width, 100, "dimensionsCm.width"),
        ...(dimensions.depth == null ? {} : { depth: this.nonNegativeNumber(dimensions.depth, 100, "dimensionsCm.depth") }),
      },
      exudate: this.code(input.exudate, "exudate"),
      ...(this.optionalText(input.notes, 2000) ? { notes: this.optionalText(input.notes, 2000) } : {}),
      assessedAt: assessedAt.toISOString(),
      clinicalMediaId,
    };
    const requestDigest = this.digest({ ...payload, appointmentId, patientId: context.patientId, providerId: context.providerId });
    const existing = await this.prisma.woundAssessment.findUnique({ where: { idempotencyKey } });
    if (existing) return this.replayWound(existing, requestDigest);
    const encrypted = await this.envelope.encryptRecord({ schemaVersion: 1, ...payload });

    let created;
    try {
      created = await this.prisma.$transaction(async (tx) => {
        await this.audit.reserveIntegrityChainForSerializableTransaction(tx);
        await tx.$queryRaw(Prisma.sql`SELECT id FROM "Appointment" WHERE id = ${appointmentId} FOR UPDATE`);
        const appointment = await tx.appointment.findUnique({ where: { id: appointmentId } });
        if (!appointment || appointment.providerId !== context.providerId || appointment.patientId !== context.patientId || !["CONFIRMED", "COMPLETED"].includes(appointment.status)) {
          throw new ConflictException("The appointment is no longer an authorized wound-care context.");
        }
        const row = await tx.woundAssessment.create({
          data: {
            idempotencyKey,
            requestDigest,
            appointmentId,
            patientId: context.patientId,
            providerId: context.providerId,
            sourceActorId: principal.accountId,
            clinicalMediaId,
            assessedAt,
            ...this.envelopeData(encrypted),
          },
        });
        await this.audit.writeClinicalInTransaction(tx, {
          actorId: principal.accountId,
          action: "WOUND_ASSESSMENT_RECORDED",
          objectType: "WOUND_ASSESSMENT",
          objectId: row.id,
          purpose: "TREATMENT",
          result: "SUCCESS",
          metadata: {
            domain: "NURSING_WORKFLOW",
            providerId: context.providerId,
            patientId: context.patientId,
            appointmentId,
            mediaLinked: Boolean(clinicalMediaId),
            decision: "ALLOW",
          },
        });
        return row;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (!this.uniqueConflict(error)) throw error;
      const raced = await this.prisma.woundAssessment.findUnique({ where: { idempotencyKey } });
      if (!raced) throw error;
      return this.replayWound(raced, requestDigest);
    }
    return this.presentWound(created);
  }

  async woundHistory(principal: AuthPrincipal, patientIdRaw: string) {
    const patientId = this.requiredId(patientIdRaw, "patientId");
    const providerId = await this.requirePatientRelationship(principal, "WOUND_CARE", patientId);
    const rows = await this.prisma.woundAssessment.findMany({
      where: { patientId, providerId },
      orderBy: [{ assessedAt: "desc" }, { createdAt: "desc" }],
      take: MAX_HISTORY,
    });
    const items = await Promise.all(rows.map((row) => this.presentWound(row)));
    await this.audit.writeClinical({
      actorId: principal.accountId,
      action: "WOUND_ASSESSMENT_HISTORY_READ",
      objectType: "PATIENT",
      objectId: patientId,
      purpose: "TREATMENT",
      result: "SUCCESS",
      metadata: { domain: "NURSING_WORKFLOW", providerId, patientId, itemCount: items.length, decision: "ALLOW" },
    });
    return { patientId, items, appendOnly: true, automatedClinicalInference: false };
  }

  async procedureChecklists(principal: AuthPrincipal) {
    await this.capabilities.assertWorkflowCapability(principal, "PROCEDURE_CHECKLIST");
    const forms = await this.forms.listForProvider(principal);
    return {
      providerId: forms.providerId,
      categoryId: forms.categoryId,
      items: forms.items.filter((item) => item.purpose === "PROCEDURE_CHECKLIST"),
      configurationSource: "ProviderCategoryForm",
      versioned: true,
    };
  }

  async completeProcedureChecklist(principal: AuthPrincipal, input: JsonObject) {
    const capability = await this.capabilities.assertWorkflowCapability(principal, "PROCEDURE_CHECKLIST");
    const appointmentId = this.requiredId(input.appointmentId, "appointmentId");
    const context = await this.requireAppointmentForProvider(capability.providerId, appointmentId);
    const code = this.code(input.code, "code");
    const idempotencyKey = this.idempotencyKey(input.idempotencyKey);
    const expectedLatestSequence = this.nonNegativeInteger(input.expectedLatestSequence, "expectedLatestSequence");
    const forms = await this.forms.listForProvider(principal);
    const form = forms.items.find((item) => item.code === code && item.purpose === "PROCEDURE_CHECKLIST");
    if (!form) throw new NotFoundException("Active procedure checklist is not configured for this provider category.");
    const requiredCount = this.requiredQuestionCount(form.schema);
    const requestDigest = this.digest({
      formId: form.id,
      code,
      formVersion: form.version,
      appointmentId,
      patientId: context.patientId,
      providerId: capability.providerId,
      expectedLatestSequence,
      answers: input.answers,
    });
    const existing = await this.prisma.procedureChecklistCompletion.findUnique({ where: { idempotencyKey } });
    if (existing) return this.replayProcedure(existing, requestDigest);

    // ProviderCategoryFormsService validates the active version and rejects every missing
    // required configured step. Therefore reaching the evidence write means close is valid.
    const response = await this.forms.submit(principal, code, {
      contextType: "APPOINTMENT",
      contextId: appointmentId,
      expectedLatestSequence,
      answers: input.answers,
    });
    if (response.patientId !== context.patientId) throw new ConflictException("Procedure checklist patient context changed concurrently.");

    let completion;
    try {
      completion = await this.prisma.procedureChecklistCompletion.create({
        data: {
          idempotencyKey,
          requestDigest,
          formId: response.formId,
          formResponseId: response.id,
          appointmentId,
          patientId: context.patientId,
          providerId: capability.providerId,
          sourceActorId: principal.accountId,
          formVersion: response.formVersion,
          sequence: response.sequence,
          requiredCount,
          state: "COMPLETED",
        },
      });
    } catch (error) {
      if (!this.uniqueConflict(error)) throw error;
      const raced = await this.prisma.procedureChecklistCompletion.findUnique({ where: { idempotencyKey } });
      if (!raced) throw error;
      return this.replayProcedure(raced, requestDigest);
    }
    await this.audit.writeClinical({
      actorId: principal.accountId,
      action: "PROCEDURE_CHECKLIST_COMPLETED",
      objectType: "PROCEDURE_CHECKLIST_COMPLETION",
      objectId: completion.id,
      purpose: "TREATMENT",
      result: "SUCCESS",
      metadata: {
        domain: "NURSING_WORKFLOW",
        providerId: capability.providerId,
        patientId: context.patientId,
        appointmentId,
        formId: response.formId,
        formVersion: response.formVersion,
        sequence: response.sequence,
        requiredCount,
        decision: "ALLOW",
      },
    });
    return this.presentProcedure(completion);
  }

  private async requireAppointmentContext(
    principal: AuthPrincipal,
    capability: "MED_ADMIN" | "WOUND_CARE",
    appointmentId: string,
  ): Promise<NursingContext> {
    const provider = await this.capabilities.assertWorkflowCapability(principal, capability);
    const appointment = await this.requireAppointmentForProvider(provider.providerId, appointmentId);
    return { providerId: provider.providerId, patientId: appointment.patientId, appointmentId: appointment.id };
  }

  private async requireAppointmentForProvider(providerId: string, appointmentId: string) {
    const appointment = await this.prisma.appointment.findFirst({
      where: { id: appointmentId, providerId, status: { in: ["CONFIRMED", "COMPLETED"] } },
      select: { id: true, patientId: true, providerId: true, status: true },
    });
    if (!appointment) throw new ForbiddenException("An assigned confirmed or completed appointment is required.");
    return appointment;
  }

  private async requirePatientRelationship(
    principal: AuthPrincipal,
    capability: "MED_ADMIN" | "WOUND_CARE",
    patientId: string,
  ) {
    const provider = await this.capabilities.assertWorkflowCapability(principal, capability);
    const now = Date.now();
    const relationship = await this.prisma.appointment.findFirst({
      where: {
        providerId: provider.providerId,
        patientId,
        status: { in: ["CONFIRMED", "COMPLETED"] },
        startsAt: { gte: new Date(now - TREATMENT_LOOKBACK_MS), lte: new Date(now + TREATMENT_LOOKAHEAD_MS) },
      },
      select: { id: true },
    });
    if (!relationship) throw new ForbiddenException("A current treatment relationship is required.");
    return provider.providerId;
  }

  private async replayMedication(row: any, requestDigest: string) {
    if (row.requestDigest !== requestDigest) throw new ConflictException("idempotencyKey was already used with different medication-administration content.");
    return this.presentMedication(row);
  }

  private async replayWound(row: any, requestDigest: string) {
    if (row.requestDigest !== requestDigest) throw new ConflictException("idempotencyKey was already used with different wound-assessment content.");
    return this.presentWound(row);
  }

  private replayProcedure(row: any, requestDigest: string) {
    if (row.requestDigest !== requestDigest) throw new ConflictException("idempotencyKey was already used with different procedure-checklist content.");
    return this.presentProcedure(row);
  }

  private async presentMedication(row: any) {
    const data = await this.envelope.decryptRecord<JsonObject>(this.rowEnvelope(row));
    return {
      id: row.id,
      prescriptionOrderId: row.prescriptionOrderId,
      appointmentId: row.appointmentId,
      patientId: row.patientId,
      providerId: row.providerId,
      administrationStatus: row.administrationStatus,
      administeredAt: row.administeredAt,
      data,
      attestation: {
        payloadDigest: row.payloadDigest,
        algorithm: row.signatureAlgorithm,
        keyId: row.signatureKeyId,
        signedAt: row.signedAt,
      },
      appendOnly: true,
    };
  }

  private async presentWound(row: any) {
    const data = await this.envelope.decryptRecord<JsonObject>(this.rowEnvelope(row));
    return {
      id: row.id,
      appointmentId: row.appointmentId,
      patientId: row.patientId,
      providerId: row.providerId,
      clinicalMediaId: row.clinicalMediaId,
      assessedAt: row.assessedAt,
      data,
      encryptedAtRest: true,
      photoConsentEnforcedByFieldMediaEvidence: Boolean(row.clinicalMediaId),
      appendOnly: true,
      automatedClinicalInference: false,
    };
  }

  private presentProcedure(row: any) {
    return {
      id: row.id,
      formId: row.formId,
      formResponseId: row.formResponseId,
      appointmentId: row.appointmentId,
      patientId: row.patientId,
      providerId: row.providerId,
      formVersion: row.formVersion,
      sequence: row.sequence,
      requiredCount: row.requiredCount,
      state: row.state,
      completedAt: row.completedAt,
      configurationSource: "ProviderCategoryForm",
      requiredStepsValidatedServerSide: true,
      appendOnly: true,
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

  private rowEnvelope(row: any): EncryptedEnvelope {
    if (row.algorithm !== "AES-256-GCM") throw new ConflictException("Unsupported nursing evidence encryption algorithm.");
    return {
      version: 1,
      algorithm: "AES-256-GCM",
      keyId: row.keyId,
      wrappedKey: row.wrappedKey,
      iv: row.iv,
      ciphertext: row.ciphertext,
    };
  }

  private object(value: unknown, field: string): JsonObject {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new BadRequestException(`${field} must be an object.`);
    return value as JsonObject;
  }

  private objectValue(value: unknown): JsonObject {
    return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
  }

  private requiredQuestionCount(schema: unknown): number {
    if (!schema || typeof schema !== "object" || Array.isArray(schema)) return 0;
    const questions = (schema as { questions?: unknown }).questions;
    if (!Array.isArray(questions)) return 0;
    return questions.filter((item) => item && typeof item === "object" && !Array.isArray(item) && (item as { required?: unknown }).required === true).length;
  }

  private requiredId(value: unknown, field: string): string {
    if (typeof value !== "string" || !SAFE_ID.test(value.trim())) throw new BadRequestException(`${field} is invalid.`);
    return value.trim();
  }

  private idempotencyKey(value: unknown): string {
    if (typeof value !== "string" || !IDEMPOTENCY.test(value.trim())) throw new BadRequestException("idempotencyKey is invalid.");
    return value.trim();
  }

  private code(value: unknown, field: string): string {
    if (typeof value !== "string") throw new BadRequestException(`${field} is required.`);
    const normalized = value.trim().toUpperCase();
    if (!SAFE_CODE.test(normalized)) throw new BadRequestException(`${field} is invalid.`);
    return normalized;
  }

  private enumValue(value: unknown, allowed: Set<string>, field: string): string {
    if (typeof value !== "string") throw new BadRequestException(`${field} is required.`);
    const normalized = value.trim().toUpperCase();
    if (!allowed.has(normalized)) throw new BadRequestException(`${field} is unsupported.`);
    return normalized;
  }

  private requiredText(value: unknown, max: number, field: string): string {
    if (typeof value !== "string") throw new BadRequestException(`${field} is required.`);
    const normalized = value.trim();
    if (!normalized || normalized.length > max) throw new BadRequestException(`${field} must contain between 1 and ${max} characters.`);
    return normalized;
  }

  private optionalText(value: unknown, max: number): string | null {
    if (value == null || value === "") return null;
    if (typeof value !== "string") throw new BadRequestException("Optional clinical text must be a string.");
    const normalized = value.trim();
    if (!normalized) return null;
    if (normalized.length > max) throw new BadRequestException(`Optional clinical text exceeds ${max} characters.`);
    return normalized;
  }

  private positiveNumber(value: unknown, max: number, field: string): number {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > max) throw new BadRequestException(`${field} must be greater than 0 and at most ${max}.`);
    return value;
  }

  private nonNegativeNumber(value: unknown, max: number, field: string): number {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > max) throw new BadRequestException(`${field} must be between 0 and ${max}.`);
    return value;
  }

  private nonNegativeInteger(value: unknown, field: string): number {
    if (!Number.isInteger(value) || (value as number) < 0) throw new BadRequestException(`${field} must be a non-negative integer.`);
    return Number(value);
  }

  private effectiveTime(value: unknown, field: string): Date {
    const date = new Date(String(value ?? ""));
    if (!Number.isFinite(date.getTime())) throw new BadRequestException(`${field} must be a valid ISO date-time.`);
    const now = Date.now();
    if (date.getTime() > now + 5 * 60 * 1000 || date.getTime() < now - 30 * 24 * 60 * 60 * 1000) {
      throw new BadRequestException(`${field} must be within the last 30 days and not materially in the future.`);
    }
    return date;
  }

  private digest(value: unknown): string {
    return createHash("sha256").update(JSON.stringify(value)).digest("hex");
  }

  private uniqueConflict(error: unknown): boolean {
    return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "P2002";
  }
}

@Controller("provider/medication-administrations")
class MedicationAdministrationController {
  constructor(private readonly nursing: ProviderNursingWorkflowsService) {}

  @RequirePermissions("OTHER_PROVIDER_CLINICAL_WORKSPACE")
  @Get("appointments/:appointmentId/eligible-prescriptions")
  @Header("Cache-Control", "no-store")
  eligible(@CurrentPrincipal() principal: AuthPrincipal, @Param("appointmentId") appointmentId: string) {
    return this.nursing.eligiblePrescriptions(principal, appointmentId);
  }

  @RequirePermissions("OTHER_PROVIDER_CLINICAL_WORKSPACE")
  @Post()
  @Header("Cache-Control", "no-store")
  create(@CurrentPrincipal() principal: AuthPrincipal, @Body() body: JsonObject) {
    return this.nursing.administerMedication(principal, body);
  }

  @RequirePermissions("OTHER_PROVIDER_CLINICAL_WORKSPACE")
  @Get("patients/:patientId")
  @Header("Cache-Control", "no-store")
  history(@CurrentPrincipal() principal: AuthPrincipal, @Param("patientId") patientId: string) {
    return this.nursing.medicationHistory(principal, patientId);
  }
}

@Controller("provider/wound-assessments")
class WoundAssessmentController {
  constructor(private readonly nursing: ProviderNursingWorkflowsService) {}

  @RequirePermissions("OTHER_PROVIDER_CLINICAL_WORKSPACE")
  @Post()
  @Header("Cache-Control", "no-store")
  create(@CurrentPrincipal() principal: AuthPrincipal, @Body() body: JsonObject) {
    return this.nursing.createWoundAssessment(principal, body);
  }

  @RequirePermissions("OTHER_PROVIDER_CLINICAL_WORKSPACE")
  @Get("patients/:patientId")
  @Header("Cache-Control", "no-store")
  history(@CurrentPrincipal() principal: AuthPrincipal, @Param("patientId") patientId: string) {
    return this.nursing.woundHistory(principal, patientId);
  }
}

@Controller("provider/procedure-checklists")
class ProcedureChecklistController {
  constructor(private readonly nursing: ProviderNursingWorkflowsService) {}

  @RequirePermissions("OTHER_PROVIDER_CATEGORY_FORMS")
  @Get()
  @Header("Cache-Control", "no-store")
  list(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.nursing.procedureChecklists(principal);
  }

  @RequirePermissions("OTHER_PROVIDER_CATEGORY_FORMS")
  @Post()
  @Header("Cache-Control", "no-store")
  complete(@CurrentPrincipal() principal: AuthPrincipal, @Body() body: JsonObject) {
    return this.nursing.completeProcedureChecklist(principal, body);
  }
}

@Module({
  imports: [ProvidersModule, OrdersModule, ClinicalModule, ProviderCategoryFormsModule],
  controllers: [MedicationAdministrationController, WoundAssessmentController, ProcedureChecklistController],
  providers: [ProviderNursingWorkflowsService],
})
export class ProviderNursingWorkflowsModule {}
