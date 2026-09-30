import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { ImagingOrder } from "@prisma/client";
import type { EncryptedEnvelope } from "@carepoint/security";
import type { AuthPrincipal } from "@carepoint/identity";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { ProviderCategoryCapabilityService } from "../providers/provider-category-capability.service";
import { OrdersEnvelopeService } from "./orders-envelope.service";
import { OrdersAttestationService } from "./orders-attestation.service";
import {
  normalizeImagingOrderAction,
  normalizeImagingOrderInput,
  type ImagingOrderInput,
} from "./imaging-order.engine";

const ORDER_CONSENT_SCOPE = "CLINICAL_ORDER_READ";
const ORDER_CONSENT_VERSION = "clinical-orders-v1";
const TREATMENT_LOOKBACK_DAYS = 365;
const TREATMENT_LOOKAHEAD_DAYS = 30;

type AccessBasis = "OWN_AUTHORSHIP" | "TREATMENT_RELATIONSHIP" | "PATIENT_CONSENT";
type ProviderContext = { id: string; class: "DOCTOR" | "OTHER_PROVIDER" };

@Injectable()
export class ImagingOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
    private readonly envelope: OrdersEnvelopeService,
    private readonly attestation: OrdersAttestationService,
    private readonly capabilities: ProviderCategoryCapabilityService,
  ) {}

  async create(principal: AuthPrincipal, patientId: string, raw: Record<string, unknown>) {
    await this.capabilities.assertClinicalOrderCapability(principal, "IMAGING");
    const provider = await this.requireActiveProvider(principal);
    const patient = await this.prisma.patientProfile.findUnique({ where: { id: patientId }, select: { id: true } });
    if (!patient) throw new NotFoundException("Patient not found.");

    const input = this.normalizedInput(raw);
    await this.assertTreatmentContext(provider.id, patient.id, input.appointmentId);

    const existing = await this.prisma.imagingOrder.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (existing) {
      if (existing.patientId !== patient.id || existing.providerId !== provider.id) {
        throw new ConflictException("idempotencyKey is already in use for another imaging order.");
      }
      return this.present(existing, "OWN_AUTHORSHIP");
    }

    const payload = {
      schemaVersion: 1,
      modality: input.modality,
      priority: input.priority,
      reason: input.reason,
      ...(input.bodySite ? { bodySite: input.bodySite } : {}),
      ...(input.instructions ? { instructions: input.instructions } : {}),
    };
    const encrypted = await this.envelope.encrypt(payload);
    const material = this.attestationMaterial(patient.id, provider.id, input.appointmentId, encrypted);
    const signature = await this.attestation.attest(material);
    const order = await this.prisma.imagingOrder.create({
      data: {
        idempotencyKey: input.idempotencyKey,
        patientId: patient.id,
        providerId: provider.id,
        appointmentId: input.appointmentId,
        status: "ORDERED",
        version: 1,
        algorithm: encrypted.algorithm,
        keyId: encrypted.keyId,
        wrappedKey: encrypted.wrappedKey,
        iv: encrypted.iv,
        ciphertext: encrypted.ciphertext,
        payloadDigest: signature.payloadDigest,
        signatureAlgorithm: signature.algorithm,
        signatureKeyId: signature.keyId,
        signature: signature.signature,
        signedAt: signature.signedAt,
      },
    });
    await this.audit.write({
      actorId: principal.accountId,
      action: "IMAGING_ORDER_SIGNED",
      objectType: "IMAGING_ORDER",
      objectId: order.id,
      purpose: "TREATMENT",
      result: "SUCCESS",
      metadata: { patientId: patient.id, appointmentId: input.appointmentId, status: order.status },
    });
    return this.present(order, "OWN_AUTHORSHIP");
  }

  async listForPatient(principal: AuthPrincipal, patientId: string) {
    await this.capabilities.assertClinicalOrderCapability(principal, "IMAGING");
    const provider = await this.requireActiveProvider(principal);
    const patient = await this.prisma.patientProfile.findUnique({ where: { id: patientId }, select: { id: true } });
    if (!patient) throw new NotFoundException("Patient not found.");
    const basis = await this.providerPatientAccessBasis(provider.id, patient.id);
    if (!basis) {
      await this.audit.write({ actorId: principal.accountId, action: "IMAGING_ORDERS_READ_DENIED", objectType: "PATIENT", objectId: patient.id, purpose: "TREATMENT", result: "DENIED" });
      throw new ForbiddenException("No imaging-order access basis exists for this patient.");
    }
    const orders = await this.prisma.imagingOrder.findMany({
      where: { patientId: patient.id, ...(basis === "OWN_AUTHORSHIP" ? { providerId: provider.id } : {}) },
      orderBy: { createdAt: "desc" },
      take: 500,
    });
    const items = await Promise.all(orders.map((order) => this.present(order, basis)));
    await this.audit.write({
      actorId: principal.accountId,
      action: "IMAGING_ORDERS_READ",
      objectType: "PATIENT",
      objectId: patient.id,
      purpose: "TREATMENT",
      result: "SUCCESS",
      metadata: { basis, itemCount: items.length },
    });
    return { patientId: patient.id, accessBasis: basis, items };
  }

  async update(principal: AuthPrincipal, orderId: string, raw: Record<string, unknown>) {
    await this.capabilities.assertClinicalOrderCapability(principal, "IMAGING");
    const provider = await this.requireActiveProvider(principal);
    const input = this.normalizedAction(raw);
    const order = await this.requireOrder(orderId);
    if (order.providerId !== provider.id) throw new ForbiddenException("Only the ordering provider can cancel this imaging order.");
    if (order.status !== "ORDERED") throw new ConflictException("Only an ordered imaging request can be cancelled.");
    const now = new Date();
    const updated = await this.prisma.imagingOrder.updateMany({
      where: { id: order.id, status: "ORDERED", version: input.expectedVersion },
      data: { status: "CANCELLED", cancelledAt: now, version: { increment: 1 } },
    });
    if (updated.count !== 1) throw new ConflictException("Imaging order changed concurrently. Refresh and retry.");
    const current = await this.requireOrder(order.id);
    await this.audit.write({
      actorId: principal.accountId,
      action: "IMAGING_ORDER_CANCELLED",
      objectType: "IMAGING_ORDER",
      objectId: order.id,
      purpose: "TREATMENT",
      result: "SUCCESS",
      metadata: { patientId: order.patientId, status: current.status },
    });
    return this.present(current, "OWN_AUTHORSHIP");
  }

  private async requireActiveProvider(principal: AuthPrincipal): Promise<ProviderContext> {
    if (principal.role !== "DOCTOR" && principal.role !== "OTHER_PROVIDER") {
      throw new ForbiddenException("An active healthcare provider account is required.");
    }
    const provider = await this.prisma.provider.findUnique({ where: { userId: principal.accountId }, select: { id: true, class: true, status: true } });
    if (!provider || provider.status !== "ACTIVE" || (provider.class !== "DOCTOR" && provider.class !== "OTHER_PROVIDER")) {
      throw new ForbiddenException("An active healthcare provider profile is required.");
    }
    return { id: provider.id, class: provider.class };
  }

  private async assertTreatmentContext(providerId: string, patientId: string, appointmentId: string | null) {
    if (appointmentId) {
      const appointment = await this.prisma.appointment.findUnique({
        where: { id: appointmentId },
        select: { id: true, patientId: true, providerId: true, status: true },
      });
      if (!appointment || appointment.patientId !== patientId) throw new NotFoundException("Appointment not found for this patient.");
      if (appointment.providerId !== providerId) throw new ForbiddenException("Only the appointment provider can create an imaging order for this encounter.");
      if (!["CONFIRMED", "COMPLETED"].includes(appointment.status)) throw new ConflictException("Imaging orders require a confirmed or completed encounter.");
      return;
    }
    const relationship = await this.currentTreatmentRelationship(providerId, patientId);
    if (!relationship) throw new ForbiddenException("A current treatment relationship or appointment is required to create an imaging order.");
  }

  private async providerPatientAccessBasis(providerId: string, patientId: string): Promise<AccessBasis | null> {
    if (await this.currentTreatmentRelationship(providerId, patientId)) return "TREATMENT_RELATIONSHIP";
    const now = new Date();
    const consent = await this.prisma.consent.findFirst({
      where: {
        patientId,
        scope: ORDER_CONSENT_SCOPE,
        state: "GRANTED",
        AND: [{ OR: [{ providerId }, { providerId: null }] }, { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }],
      },
      select: { version: true },
      orderBy: { grantedAt: "desc" },
    });
    if (consent?.version === ORDER_CONSENT_VERSION) return "PATIENT_CONSENT";
    const authored = await this.prisma.imagingOrder.findFirst({ where: { providerId, patientId }, select: { id: true } });
    return authored ? "OWN_AUTHORSHIP" : null;
  }

  private async currentTreatmentRelationship(providerId: string, patientId: string) {
    const now = new Date();
    const from = new Date(now.getTime() - TREATMENT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    const to = new Date(now.getTime() + TREATMENT_LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000);
    return this.prisma.appointment.findFirst({
      where: { providerId, patientId, status: { in: ["CONFIRMED", "COMPLETED"] }, startsAt: { gte: from, lte: to } },
      select: { id: true },
    });
  }

  private async requireOrder(orderId: string) {
    if (!orderId?.trim()) throw new BadRequestException("orderId is required.");
    const order = await this.prisma.imagingOrder.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException("Imaging order not found.");
    return order;
  }

  private async present(order: ImagingOrder, basis: AccessBasis) {
    const envelope = this.orderEnvelope(order);
    const material = this.attestationMaterial(order.patientId, order.providerId, order.appointmentId, envelope);
    const valid = await this.attestation.verify(material, {
      payloadDigest: order.payloadDigest,
      signature: order.signature,
      signedAt: order.signedAt,
      keyId: order.signatureKeyId,
      algorithm: order.signatureAlgorithm,
    });
    if (!valid) throw new ConflictException("Imaging order attestation verification failed.");
    const data = await this.envelope.decrypt<Record<string, unknown>>(envelope);
    return {
      id: order.id,
      patientId: order.patientId,
      providerId: order.providerId,
      appointmentId: order.appointmentId,
      status: order.status,
      version: order.version,
      accessBasis: basis,
      signedAt: order.signedAt,
      cancelledAt: order.cancelledAt,
      data,
      attestation: { algorithm: order.signatureAlgorithm, keyId: order.signatureKeyId, payloadDigest: order.payloadDigest },
    };
  }

  private attestationMaterial(patientId: string, providerId: string, appointmentId: string | null, envelope: EncryptedEnvelope) {
    return { type: "IMAGING_ORDER", patientId, providerId, appointmentId, envelope };
  }

  private orderEnvelope(order: ImagingOrder): EncryptedEnvelope {
    if (order.algorithm !== "AES-256-GCM") throw new ConflictException("Unsupported imaging order encryption algorithm.");
    return { version: 1, algorithm: "AES-256-GCM", keyId: order.keyId, wrappedKey: order.wrappedKey, iv: order.iv, ciphertext: order.ciphertext };
  }

  private normalizedInput(raw: Record<string, unknown>): ImagingOrderInput {
    try { return normalizeImagingOrderInput(raw); }
    catch (error) { throw new BadRequestException(error instanceof Error ? error.message : "Invalid imaging order input."); }
  }

  private normalizedAction(raw: Record<string, unknown>) {
    try { return normalizeImagingOrderAction(raw); }
    catch (error) { throw new BadRequestException(error instanceof Error ? error.message : "Invalid imaging order action."); }
  }
}
