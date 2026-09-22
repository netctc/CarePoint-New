import { createHash } from "node:crypto";
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import type { EncryptedEnvelope } from "@carepoint/security";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { ClinicalEnvelopeService } from "../clinical/clinical-envelope.service";
import { ProviderCategoryCapabilityService } from "../providers/provider-category-capability.service";

const SAFE_ID = /^[A-Za-z0-9_.:-]{1,180}$/;
const IDEMPOTENCY = /^[A-Za-z0-9_.:-]{8,128}$/;
const SIGNER_TYPES = new Set(["PATIENT", "REPRESENTATIVE"]);
const METHODS = new Set(["TYPED_CONFIRMATION", "DRAWN_SIGNATURE"]);

type Input = {
  idempotencyKey?: unknown;
  signerType?: unknown;
  signerName?: unknown;
  representativeRelationship?: unknown;
  confirmationMethod?: unknown;
  serviceSummary?: unknown;
  drawnSignatureData?: unknown;
  confirmedAt?: unknown;
  acknowledgesServiceReceipt?: unknown;
};

type EnvelopeRow = { algorithm: string; keyId: string; wrappedKey: string; iv: string; ciphertext: string };

@Injectable()
export class ServiceSignatureService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
    private readonly envelope: ClinicalEnvelopeService,
    private readonly capabilities: ProviderCategoryCapabilityService,
  ) {}

  async create(principal: AuthPrincipal, appointmentIdRaw: string, input: Input) {
    const context = await this.capabilities.assertWorkflowCapability(principal, "SERVICE_COMPLETION_CHECKLIST");
    const appointmentId = this.requiredId(appointmentIdRaw, "appointmentId");
    const appointment = await this.prisma.appointment.findFirst({
      where: {
        id: appointmentId,
        providerId: context.providerId,
        status: { in: ["CONFIRMED", "COMPLETED"] },
      },
      select: {
        id: true,
        patientId: true,
        providerId: true,
        serviceId: true,
        modality: true,
        startsAt: true,
        endsAt: true,
        status: true,
      },
    });
    if (!appointment) throw new NotFoundException("Assigned service appointment not found.");

    const completionEvent = await this.prisma.providerWorkflowEvent.findFirst({
      where: {
        providerId: context.providerId,
        patientId: appointment.patientId,
        contextType: "APPOINTMENT",
        contextId: appointment.id,
        eventType: "SERVICE_COMPLETION_CHECKLIST_CONFIRMED",
      },
      orderBy: { occurredAt: "desc" },
      select: { id: true, evidence: true, occurredAt: true },
    });
    if (!completionEvent) {
      throw new ConflictException("Service completion checklist must be confirmed before receipt confirmation.");
    }
    const completionEvidence = this.objectValue(completionEvent.evidence);
    const formResponseId = this.requiredId(completionEvidence.formResponseId, "completion.formResponseId");
    const formResponseSequence = this.positiveInteger(completionEvidence.formResponseSequence, "completion.formResponseSequence");
    const matchingResponse = await this.prisma.providerCategoryFormResponse.findFirst({
      where: {
        id: formResponseId,
        sequence: formResponseSequence,
        providerId: context.providerId,
        patientId: appointment.patientId,
        contextType: "APPOINTMENT",
        contextId: appointment.id,
        form: { categoryId: context.categoryId, purpose: "SERVICE_COMPLETION" },
      },
      select: { id: true, sequence: true },
    });
    if (!matchingResponse) {
      throw new ConflictException("Service completion evidence no longer matches the signed service context.");
    }

    const idempotencyKey = this.idempotencyKey(input?.idempotencyKey);
    const signerType = this.enumValue(input?.signerType, SIGNER_TYPES, "signerType");
    const confirmationMethod = this.enumValue(input?.confirmationMethod, METHODS, "confirmationMethod");
    const signerName = this.text(input?.signerName, "signerName", 160, true)!;
    const representativeRelationship = signerType === "REPRESENTATIVE"
      ? this.text(input?.representativeRelationship, "representativeRelationship", 120, true)!
      : null;
    const serviceSummary = this.text(input?.serviceSummary, "serviceSummary", 4000, true)!;
    const drawnSignatureData = confirmationMethod === "DRAWN_SIGNATURE"
      ? this.text(input?.drawnSignatureData, "drawnSignatureData", 250000, true)!
      : null;
    if (input?.acknowledgesServiceReceipt !== true) {
      throw new BadRequestException("acknowledgesServiceReceipt must be explicitly true.");
    }
    const confirmedAt = this.confirmedAt(input?.confirmedAt);
    const serviceSummaryDigest = this.digest(serviceSummary);
    const appointmentDigest = this.digest({
      appointmentId: appointment.id,
      patientId: appointment.patientId,
      providerId: appointment.providerId,
      serviceId: appointment.serviceId,
      modality: appointment.modality,
      startsAt: appointment.startsAt.toISOString(),
      endsAt: appointment.endsAt.toISOString(),
      status: appointment.status,
    });
    const completionEvidenceDigest = this.digest({
      completionEventId: completionEvent.id,
      formResponseId,
      formResponseSequence,
      occurredAt: completionEvent.occurredAt.toISOString(),
    });
    const payload = {
      schemaVersion: 1,
      kind: "SERVICE_RECEIPT_CONFIRMATION",
      signerType,
      signerName,
      representativeRelationship,
      confirmationMethod,
      serviceSummary,
      serviceSummaryDigest,
      appointmentDigest,
      completionEventId: completionEvent.id,
      completionEvidenceDigest,
      formResponseId,
      formResponseSequence,
      drawnSignatureData,
      confirmedAt: confirmedAt.toISOString(),
      acknowledgesServiceReceipt: true,
      clinicalConsentGranted: false,
      replacesClinicalConsent: false,
    };
    const requestDigest = this.digest(payload);
    const existing = await this.prisma.serviceSignature.findUnique({ where: { idempotencyKey } });
    if (existing) {
      if (existing.providerId !== context.providerId || existing.requestDigest !== requestDigest) {
        throw new ConflictException("idempotencyKey was already used with different signature content.");
      }
      return this.present(existing, await this.decrypt(existing));
    }
    const encrypted = await this.envelope.encryptRecord(payload);
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        const created = await tx.serviceSignature.create({
          data: {
            idempotencyKey,
            requestDigest,
            patientId: appointment.patientId,
            providerId: context.providerId,
            appointmentId: appointment.id,
            completionEventId: completionEvent.id,
            formResponseId,
            formResponseSequence,
            signerType,
            confirmationMethod,
            serviceSummaryDigest,
            appointmentDigest,
            confirmedAt,
            ...this.envelopeData(encrypted),
          },
        });
        await this.audit.writeClinicalInTransaction(tx, {
          actorId: principal.accountId,
          action: "SERVICE_RECEIPT_CONFIRMATION_RECORDED",
          objectType: "SERVICE_SIGNATURE",
          objectId: created.id,
          purpose: "TREATMENT",
          result: "SUCCESS",
          metadata: {
            domain: "OTHER_PROVIDER_WORKFLOW",
            providerId: context.providerId,
            patientId: appointment.patientId,
            appointmentId: appointment.id,
            resourceId: created.id,
            completionEventId: completionEvent.id,
            formResponseId,
            formResponseSequence,
            signerType,
            confirmationMethod,
            serviceSummaryDigest,
            appointmentDigest,
            replacesClinicalConsent: false,
            decision: "ALLOW",
          },
        });
        return created;
      });
      return this.present(row, payload);
    } catch (error) {
      if (!this.isUniqueConflict(error)) throw error;
      const raced = await this.prisma.serviceSignature.findUnique({ where: { idempotencyKey } });
      if (!raced || raced.providerId !== context.providerId || raced.requestDigest !== requestDigest) {
        throw new ConflictException("Service signature changed concurrently.");
      }
      return this.present(raced, await this.decrypt(raced));
    }
  }

  async list(principal: AuthPrincipal, appointmentIdRaw: string) {
    const context = await this.capabilities.assertWorkflowCapability(principal, "SERVICE_COMPLETION_CHECKLIST");
    const appointmentId = this.requiredId(appointmentIdRaw, "appointmentId");
    const appointment = await this.prisma.appointment.findFirst({
      where: { id: appointmentId, providerId: context.providerId },
      select: { id: true, patientId: true },
    });
    if (!appointment) throw new ForbiddenException("Assigned service appointment is required.");
    const rows = await this.prisma.serviceSignature.findMany({ where: { appointmentId }, orderBy: { confirmedAt: "desc" }, take: 20 });
    const items = [];
    for (const row of rows) items.push(this.present(row, await this.decrypt(row)));
    await this.audit.writeClinical({
      actorId: principal.accountId,
      action: "SERVICE_RECEIPT_CONFIRMATION_HISTORY_READ",
      objectType: "APPOINTMENT",
      objectId: appointment.id,
      purpose: "TREATMENT",
      result: "SUCCESS",
      metadata: {
        domain: "OTHER_PROVIDER_WORKFLOW",
        providerId: context.providerId,
        patientId: appointment.patientId,
        appointmentId: appointment.id,
        itemCount: items.length,
        decision: "ALLOW",
      },
    });
    return { appointmentId, items, appendOnly: true, replacesClinicalConsent: false };
  }

  private present(row: any, payload: Record<string, unknown>) {
    return {
      id: row.id,
      patientId: row.patientId,
      providerId: row.providerId,
      appointmentId: row.appointmentId,
      completionEventId: row.completionEventId,
      formResponseId: row.formResponseId,
      formResponseSequence: row.formResponseSequence,
      signerType: row.signerType,
      confirmationMethod: row.confirmationMethod,
      serviceSummaryDigest: row.serviceSummaryDigest,
      appointmentDigest: row.appointmentDigest,
      confirmedAt: row.confirmedAt,
      data: payload,
      immutable: true,
      replacesClinicalConsent: false,
      createdAt: row.createdAt,
    };
  }

  private confirmedAt(value: unknown) {
    if (value == null || value === "") throw new BadRequestException("confirmedAt is required.");
    const date = new Date(String(value));
    if (Number.isNaN(date.getTime())) throw new BadRequestException("confirmedAt is invalid.");
    const now = Date.now();
    if (date.getTime() > now + 5 * 60 * 1000 || date.getTime() < now - 24 * 60 * 60 * 1000) {
      throw new BadRequestException("confirmedAt must be within the last 24 hours.");
    }
    return date;
  }

  private requiredId(value: unknown, field: string) {
    if (typeof value !== "string" || !SAFE_ID.test(value.trim())) throw new BadRequestException(`${field} is invalid.`);
    return value.trim();
  }
  private idempotencyKey(value: unknown) {
    if (typeof value !== "string" || !IDEMPOTENCY.test(value.trim())) throw new BadRequestException("idempotencyKey is invalid.");
    return value.trim();
  }
  private enumValue(value: unknown, allowed: Set<string>, field: string) {
    if (typeof value !== "string") throw new BadRequestException(`${field} is required.`);
    const normalized = value.trim().toUpperCase();
    if (!allowed.has(normalized)) throw new BadRequestException(`${field} is invalid.`);
    return normalized;
  }
  private text(value: unknown, field: string, max: number, required: boolean): string | undefined {
    if (value == null || value === "") {
      if (required) throw new BadRequestException(`${field} is required.`);
      return undefined;
    }
    if (typeof value !== "string") throw new BadRequestException(`${field} must be text.`);
    const text = value.trim();
    if (!text || text.length > max || /\p{Cc}/u.test(text)) throw new BadRequestException(`${field} is invalid.`);
    return text;
  }
  private positiveInteger(value: unknown, field: string) {
    if (!Number.isInteger(value) || Number(value) < 1) throw new ConflictException(`${field} is invalid.`);
    return Number(value);
  }
  private objectValue(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  }
  private digest(value: unknown) { return createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex"); }
  private envelopeData(envelope: EncryptedEnvelope) { return { algorithm: envelope.algorithm, keyId: envelope.keyId, wrappedKey: envelope.wrappedKey, iv: envelope.iv, ciphertext: envelope.ciphertext }; }
  private async decrypt(row: EnvelopeRow) { return this.envelope.decryptRecord<Record<string, unknown>>({ version: 1, algorithm: row.algorithm as "AES-256-GCM", keyId: row.keyId, wrappedKey: row.wrappedKey, iv: row.iv, ciphertext: row.ciphertext }); }
  private isUniqueConflict(error: unknown) { return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "P2002"; }
}
