import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { ClinicalOrder, LaboratoryResult } from "@prisma/client";
import type { EncryptedEnvelope } from "@carepoint/security";
import type { AuthPrincipal } from "@carepoint/identity";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { NotificationsService } from "../communications/notifications.service";
import { OrdersEnvelopeService } from "./orders-envelope.service";
import { OrdersAttestationService } from "./orders-attestation.service";

const ORDER_CONSENT_SCOPE = "CLINICAL_ORDER_READ";
const ORDER_CONSENT_VERSION = "clinical-orders-v1";
const MAX_PAYLOAD_BYTES = 64 * 1024;
const TREATMENT_LOOKBACK_DAYS = 365;
const TREATMENT_LOOKAHEAD_DAYS = 30;

type OrderType = "PRESCRIPTION" | "LABORATORY";
type AccessBasis = "PATIENT_SELF" | "OWN_AUTHORSHIP" | "TREATMENT_RELATIONSHIP" | "PATIENT_CONSENT";
type JsonObject = Record<string, unknown>;
type ProviderContext = {
  id: string;
  class: "DOCTOR" | "OTHER_PROVIDER";
  status: string;
  capabilities: Set<string>;
};

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
    private readonly envelope: OrdersEnvelopeService,
    private readonly attestation: OrdersAttestationService,
    private readonly notifications: NotificationsService,
  ) {}

  async createOrder(principal: AuthPrincipal, appointmentId: string, type: OrderType, input: JsonObject) {
    const provider = await this.requireActiveProvider(principal);
    this.assertOrderCapability(provider, type);
    const appointment = await this.requireAppointment(appointmentId);
    if (appointment.providerId !== provider.id) throw new ForbiddenException("Only the appointment provider can create orders for this encounter.");
    if (!["CONFIRMED", "COMPLETED"].includes(appointment.status)) throw new ConflictException("Clinical orders require a confirmed or completed encounter.");

    const idempotencyKey = this.requiredText(input.idempotencyKey, 128, "idempotencyKey");
    if (idempotencyKey.length < 8) throw new BadRequestException("idempotencyKey must contain at least 8 characters.");
    const existing = await this.prisma.clinicalOrder.findUnique({ where: { idempotencyKey }, include: { labResult: true } });
    if (existing) {
      if (existing.providerId !== provider.id || existing.patientId !== appointment.patientId || existing.encounterRef !== appointment.id || existing.type !== type) {
        throw new ConflictException("idempotencyKey is already in use for another clinical order.");
      }
      return this.presentOrder(existing, "OWN_AUTHORSHIP", false);
    }

    const payload = type === "PRESCRIPTION" ? this.validatePrescription(input) : this.validateLaboratoryOrder(input);
    const encrypted = await this.envelope.encrypt({ schemaVersion: 1, type, ...payload });
    const material = this.orderAttestationMaterial(type, appointment.patientId, provider.id, appointment.id, encrypted);
    const signature = await this.attestation.attest(material);
    const order = await this.prisma.clinicalOrder.create({
      data: {
        idempotencyKey,
        type,
        status: "SIGNED",
        patientId: appointment.patientId,
        providerId: provider.id,
        encounterRef: appointment.id,
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
      include: { labResult: true },
    });
    await this.audit.write({
      actorId: principal.accountId,
      action: "CLINICAL_ORDER_SIGNED",
      objectType: "CLINICAL_ORDER",
      objectId: order.id,
      purpose: "TREATMENT",
      result: "SUCCESS",
      metadata: { type, appointmentId: appointment.id },
    });
    return this.presentOrder(order, "OWN_AUTHORSHIP", false);
  }

  async patientOrders(principal: AuthPrincipal) {
    if (principal.role !== "PATIENT") throw new ForbiddenException("Patient order access requires a patient account.");
    const patient = await this.requirePatient(principal);
    const orders = await this.prisma.clinicalOrder.findMany({ where: { patientId: patient.id }, include: { labResult: true }, orderBy: { createdAt: "desc" }, take: 500 });
    const items = await Promise.all(orders.map((order) => this.presentOrder(order, "PATIENT_SELF", true)));
    await this.audit.write({ actorId: principal.accountId, action: "CLINICAL_ORDERS_READ", objectType: "PATIENT", objectId: patient.id, purpose: "PATIENT_ACCESS", result: "SUCCESS", metadata: { itemCount: items.length } });
    return { patientId: patient.id, accessBasis: "PATIENT_SELF" as const, items };
  }

  async providerPatientOrders(principal: AuthPrincipal, patientId: string) {
    const provider = await this.requireActiveProvider(principal);
    const patient = await this.prisma.patientProfile.findUnique({ where: { id: patientId }, select: { id: true } });
    if (!patient) throw new NotFoundException("Patient not found.");
    const basis = await this.providerPatientAccessBasis(provider.id, patient.id);
    if (!basis) {
      await this.audit.write({ actorId: principal.accountId, action: "CLINICAL_ORDERS_READ_DENIED", objectType: "PATIENT", objectId: patient.id, purpose: "TREATMENT", result: "DENIED" });
      throw new ForbiddenException("No clinical order access basis exists for this patient.");
    }
    const orders = await this.prisma.clinicalOrder.findMany({
      where: { patientId: patient.id, ...(basis === "OWN_AUTHORSHIP" ? { providerId: provider.id } : {}) },
      include: { labResult: true },
      orderBy: { createdAt: "desc" },
      take: 500,
    });
    const items = await Promise.all(orders.map((order) => this.presentOrder(order, basis, false)));
    await this.audit.write({ actorId: principal.accountId, action: "CLINICAL_ORDERS_READ", objectType: "PATIENT", objectId: patient.id, purpose: "TREATMENT", result: "SUCCESS", metadata: { basis, itemCount: items.length } });
    return { patientId: patient.id, accessBasis: basis, items };
  }

  async getOrder(principal: AuthPrincipal, orderId: string) {
    const order = await this.requireOrder(orderId);
    const access = await this.orderAccessBasis(principal, order);
    if (!access) {
      await this.audit.write({ actorId: principal.accountId, action: "CLINICAL_ORDER_READ_DENIED", objectType: "CLINICAL_ORDER", objectId: order.id, purpose: "TREATMENT", result: "DENIED" });
      throw new ForbiddenException("Clinical order access denied.");
    }
    const result = await this.presentOrder(order, access.basis, access.patientView);
    await this.audit.write({ actorId: principal.accountId, action: "CLINICAL_ORDER_READ", objectType: "CLINICAL_ORDER", objectId: order.id, purpose: access.patientView ? "PATIENT_ACCESS" : "TREATMENT", result: "SUCCESS", metadata: { basis: access.basis } });
    return result;
  }

  async cancelOrder(principal: AuthPrincipal, orderId: string) {
    const provider = await this.requireActiveProvider(principal);
    const order = await this.requireOrder(orderId);
    if (order.providerId !== provider.id) throw new ForbiddenException("Only the ordering provider can cancel this order.");
    if (order.status !== "SIGNED") throw new ConflictException("Only an active signed order can be cancelled.");
    if (order.labResult) throw new ConflictException("A laboratory order with a result cannot be cancelled.");
    const updated = await this.prisma.clinicalOrder.update({ where: { id: order.id }, data: { status: "CANCELLED", cancelledAt: new Date() }, include: { labResult: true } });
    await this.audit.write({ actorId: principal.accountId, action: "CLINICAL_ORDER_CANCELLED", objectType: "CLINICAL_ORDER", objectId: order.id, purpose: "TREATMENT", result: "SUCCESS", metadata: { type: order.type } });
    return this.presentOrder(updated, "OWN_AUTHORSHIP", false);
  }

  async enterLabResult(principal: AuthPrincipal, orderId: string, input: JsonObject) {
    const provider = await this.requireActiveProvider(principal);
    const order = await this.requireOrder(orderId);
    if (order.type !== "LABORATORY") throw new ConflictException("Laboratory results can only be attached to laboratory orders.");
    if (order.status !== "SIGNED") throw new ConflictException("Laboratory results require an active signed laboratory order.");
    if (order.labResult) throw new ConflictException("A laboratory result already exists for this order.");
    if (order.providerId !== provider.id && !provider.capabilities.has("LAB_RESULT_ENTRY")) throw new ForbiddenException("Provider is not authorized to enter laboratory results.");

    const payload = this.validateLabResultPayload(input);
    const encrypted = await this.envelope.encrypt({ schemaVersion: 1, ...payload });
    const payloadDigest = this.attestation.digest(this.resultAttestationMaterial(order.id, encrypted));
    const result = await this.prisma.laboratoryResult.create({
      data: {
        orderId: order.id,
        status: "ENTERED",
        enteredByProviderId: provider.id,
        algorithm: encrypted.algorithm,
        keyId: encrypted.keyId,
        wrappedKey: encrypted.wrappedKey,
        iv: encrypted.iv,
        ciphertext: encrypted.ciphertext,
        payloadDigest,
      },
    });
    await this.audit.write({ actorId: principal.accountId, action: "LAB_RESULT_ENTERED", objectType: "LABORATORY_RESULT", objectId: result.id, purpose: "TREATMENT", result: "SUCCESS", metadata: { orderId: order.id } });
    return this.getOrder(principal, order.id);
  }

  async validateLabResult(principal: AuthPrincipal, orderId: string) {
    const provider = await this.requireActiveProvider(principal);
    const order = await this.requireOrder(orderId);
    if (order.type !== "LABORATORY" || !order.labResult) throw new ConflictException("Laboratory result is required before validation.");
    if (order.labResult.status !== "ENTERED") throw new ConflictException("Only an entered laboratory result can be validated.");
    if (order.providerId !== provider.id && !provider.capabilities.has("LAB_RESULT_VALIDATE")) throw new ForbiddenException("Provider is not authorized to validate this laboratory result.");

    const material = this.resultAttestationMaterial(order.id, this.resultEnvelope(order.labResult));
    const signature = await this.attestation.attest(material);
    if (signature.payloadDigest !== order.labResult.payloadDigest) throw new ConflictException("Laboratory result integrity check failed before validation.");
    await this.prisma.laboratoryResult.update({
      where: { id: order.labResult.id },
      data: {
        status: "VALIDATED",
        validationDigest: signature.payloadDigest,
        validationAlgorithm: signature.algorithm,
        validationKeyId: signature.keyId,
        validationSignature: signature.signature,
        validatedByProviderId: provider.id,
        validatedAt: signature.signedAt,
      },
    });
    await this.audit.write({ actorId: principal.accountId, action: "LAB_RESULT_VALIDATED", objectType: "LABORATORY_RESULT", objectId: order.labResult.id, purpose: "TREATMENT", result: "SUCCESS", metadata: { orderId: order.id } });
    return this.getOrder(principal, order.id);
  }

  async releaseLabResult(principal: AuthPrincipal, orderId: string) {
    const provider = await this.requireActiveProvider(principal);
    const order = await this.requireOrder(orderId);
    if (order.type !== "LABORATORY" || !order.labResult) throw new ConflictException("Laboratory result is required before release.");
    if (order.providerId !== provider.id) throw new ForbiddenException("Only the ordering provider can release this result to the patient.");
    if (order.labResult.status !== "VALIDATED") throw new ConflictException("Only a validated laboratory result can be released.");
    const labResult = order.labResult;
    await this.assertValidatedResultIntegrity(labResult, order.id);
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const patient = await tx.patientProfile.findUnique({ where: { id: order.patientId }, select: { userId: true } });
      if (!patient?.userId) throw new NotFoundException("Patient profile not found.");
      const released = await tx.laboratoryResult.updateMany({
        where: { id: labResult.id, status: "VALIDATED" },
        data: { status: "RELEASED", releasedByProviderId: provider.id, releasedAt: now },
      });
      if (released.count !== 1) throw new ConflictException("Laboratory result changed concurrently. Refresh and retry.");
      await tx.clinicalOrder.update({ where: { id: order.id }, data: { status: "FULFILLED", completedAt: now } });
      await this.notifications.enqueueAccountInTransaction(tx, {
        accountId: patient.userId,
        dedupeKey: `clinical:${order.id}:lab-result-released`,
        type: "CLINICAL_UPDATE",
        entityType: "CLINICAL_ORDER",
        entityId: order.id,
        safeTitleKey: "notification.clinical.lab-result.title",
        safeBodyKey: "notification.clinical.lab-result.body",
      });
    });
    this.notifications.wakeOutbox();
    await this.audit.write({ actorId: principal.accountId, action: "LAB_RESULT_RELEASED", objectType: "LABORATORY_RESULT", objectId: labResult.id, purpose: "TREATMENT", result: "SUCCESS", metadata: { orderId: order.id } });
    return this.getOrder(principal, order.id);
  }

  private async presentOrder(order: ClinicalOrder & { labResult: LaboratoryResult | null }, basis: AccessBasis, patientView: boolean) {
    const encrypted = this.orderEnvelope(order);
    const material = this.orderAttestationMaterial(order.type as OrderType, order.patientId, order.providerId, order.encounterRef, encrypted);
    if (!(await this.attestation.verify(material, {
      payloadDigest: order.payloadDigest,
      signature: order.signature,
      signedAt: order.signedAt,
      keyId: order.signatureKeyId,
      algorithm: order.signatureAlgorithm,
    }))) {
      throw new ConflictException("Clinical order attestation verification failed.");
    }
    const payload = await this.envelope.decrypt<JsonObject>(encrypted);
    let labResult: unknown = null;
    if (order.labResult) {
      if (patientView && order.labResult.status !== "RELEASED") {
        labResult = { status: order.labResult.status, released: false };
      } else {
        if (order.labResult.status === "VALIDATED" || order.labResult.status === "RELEASED") await this.assertValidatedResultIntegrity(order.labResult, order.id);
        labResult = {
          id: order.labResult.id,
          status: order.labResult.status,
          released: order.labResult.status === "RELEASED",
          validatedAt: order.labResult.validatedAt,
          releasedAt: order.labResult.releasedAt,
          data: await this.envelope.decrypt<JsonObject>(this.resultEnvelope(order.labResult)),
        };
      }
    }
    return {
      id: order.id,
      type: order.type,
      status: order.status,
      patientId: order.patientId,
      providerId: order.providerId,
      encounterRef: order.encounterRef,
      accessBasis: basis,
      signedAt: order.signedAt,
      cancelledAt: order.cancelledAt,
      completedAt: order.completedAt,
      attestation: { algorithm: order.signatureAlgorithm, keyId: order.signatureKeyId, payloadDigest: order.payloadDigest },
      data: payload,
      labResult,
    };
  }

  private async orderAccessBasis(principal: AuthPrincipal, order: ClinicalOrder): Promise<{ basis: AccessBasis; patientView: boolean } | null> {
    if (principal.role === "PATIENT") {
      const patient = await this.requirePatient(principal);
      return patient.id === order.patientId ? { basis: "PATIENT_SELF", patientView: true } : null;
    }
    if (principal.role === "DOCTOR" || principal.role === "OTHER_PROVIDER") {
      const provider = await this.requireActiveProvider(principal);
      if (provider.id === order.providerId) return { basis: "OWN_AUTHORSHIP", patientView: false };
      const basis = await this.providerPatientAccessBasis(provider.id, order.patientId);
      return basis ? { basis, patientView: false } : null;
    }
    return null;
  }

  private async providerPatientAccessBasis(providerId: string, patientId: string): Promise<Exclude<AccessBasis, "PATIENT_SELF"> | null> {
    const now = new Date();
    const from = new Date(now.getTime() - TREATMENT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    const to = new Date(now.getTime() + TREATMENT_LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000);
    const relationship = await this.prisma.appointment.findFirst({ where: { providerId, patientId, status: { in: ["CONFIRMED", "COMPLETED"] }, startsAt: { gte: from, lte: to } }, select: { id: true } });
    if (relationship) return "TREATMENT_RELATIONSHIP";
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
    const own = await this.prisma.clinicalOrder.findFirst({ where: { providerId, patientId }, select: { id: true } });
    return own ? "OWN_AUTHORSHIP" : null;
  }

  private async requireActiveProvider(principal: AuthPrincipal): Promise<ProviderContext> {
    if (principal.role !== "DOCTOR" && principal.role !== "OTHER_PROVIDER") throw new ForbiddenException("An active healthcare provider account is required.");
    const provider = await this.prisma.provider.findUnique({
      where: { userId: principal.accountId },
      include: { otherProviderProfile: { include: { category: true } } },
    });
    if (!provider || provider.status !== "ACTIVE") throw new ForbiddenException("An active healthcare provider profile is required.");
    const capabilities = new Set<string>();
    if (provider.class === "OTHER_PROVIDER") {
      const raw = provider.otherProviderProfile?.category.capabilities;
      if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        const values = (raw as { clinicalOrderCapabilities?: unknown }).clinicalOrderCapabilities;
        if (Array.isArray(values)) for (const value of values) if (typeof value === "string") capabilities.add(value);
      }
    }
    return { id: provider.id, class: provider.class, status: provider.status, capabilities };
  }

  private assertOrderCapability(provider: ProviderContext, type: OrderType) {
    if (provider.class === "DOCTOR") return;
    if (!provider.capabilities.has(type)) throw new ForbiddenException(`Other Provider category is not authorized for ${type} clinical orders.`);
  }

  private async requireAppointment(appointmentId: string) {
    if (!appointmentId?.trim()) throw new BadRequestException("appointmentId is required.");
    const appointment = await this.prisma.appointment.findUnique({ where: { id: appointmentId }, select: { id: true, patientId: true, providerId: true, status: true } });
    if (!appointment) throw new NotFoundException("Appointment not found.");
    return appointment;
  }

  private async requirePatient(principal: AuthPrincipal) {
    const patient = await this.prisma.patientProfile.findUnique({ where: { userId: principal.accountId }, select: { id: true } });
    if (!patient) throw new NotFoundException("Patient profile not found.");
    return patient;
  }

  private async requireOrder(orderId: string): Promise<ClinicalOrder & { labResult: LaboratoryResult | null }> {
    if (!orderId?.trim()) throw new BadRequestException("orderId is required.");
    const order = await this.prisma.clinicalOrder.findUnique({ where: { id: orderId }, include: { labResult: true } });
    if (!order) throw new NotFoundException("Clinical order not found.");
    return order;
  }

  private validatePrescription(input: JsonObject): JsonObject {
    const medication = this.object(input.medication, "medication");
    const result: JsonObject = {
      medication: this.pickTextFields(medication, ["name", "codeSystem", "code", "strength", "form"], ["name"], 300),
      dosageInstruction: this.requiredText(input.dosageInstruction, 2000, "dosageInstruction"),
    };
    for (const key of ["route", "frequency", "duration", "reason", "instructions"]) {
      if (input[key] !== undefined && input[key] !== null && input[key] !== "") result[key] = this.requiredText(input[key], 2000, key);
    }
    if (input.quantity !== undefined) result.quantity = this.integer(input.quantity, 1, 100000, "quantity");
    if (input.refills !== undefined) result.refills = this.integer(input.refills, 0, 12, "refills");
    this.assertPayloadSize(result);
    return result;
  }

  private validateLaboratoryOrder(input: JsonObject): JsonObject {
    if (!Array.isArray(input.tests) || input.tests.length < 1 || input.tests.length > 100) throw new BadRequestException("tests must contain between 1 and 100 items.");
    const tests = input.tests.map((item, index) => this.pickTextFields(this.object(item, `tests[${index}]`), ["display", "codeSystem", "code"], ["display"], 500));
    const priority = input.priority === undefined ? "ROUTINE" : this.requiredText(input.priority, 20, "priority").toUpperCase();
    if (!["ROUTINE", "URGENT"].includes(priority)) throw new BadRequestException("priority must be ROUTINE or URGENT.");
    const result: JsonObject = { tests, priority };
    if (input.fasting !== undefined) {
      if (typeof input.fasting !== "boolean") throw new BadRequestException("fasting must be boolean.");
      result.fasting = input.fasting;
    }
    for (const key of ["specimen", "instructions", "reason"]) if (input[key] !== undefined && input[key] !== null && input[key] !== "") result[key] = this.requiredText(input[key], 2000, key);
    this.assertPayloadSize(result);
    return result;
  }

  private validateLabResultPayload(input: JsonObject): JsonObject {
    if (!Array.isArray(input.observations) || input.observations.length < 1 || input.observations.length > 200) throw new BadRequestException("observations must contain between 1 and 200 items.");
    const observations = input.observations.map((item, index) => {
      const raw = this.object(item, `observations[${index}]`);
      const entry = this.pickTextFields(raw, ["display", "codeSystem", "code", "unit", "referenceRange", "flag"], ["display"], 500);
      const value = raw.value;
      if (typeof value !== "string" && typeof value !== "number") throw new BadRequestException(`observations[${index}].value must be a string or number.`);
      entry.value = value;
      return entry;
    });
    const result: JsonObject = { observations };
    if (input.conclusion !== undefined && input.conclusion !== null && input.conclusion !== "") result.conclusion = this.requiredText(input.conclusion, 10000, "conclusion");
    if (input.attachments !== undefined) {
      if (!Array.isArray(input.attachments) || input.attachments.length > 20) throw new BadRequestException("attachments must contain at most 20 items.");
      result.attachments = input.attachments.map((item, index) => this.pickTextFields(this.object(item, `attachments[${index}]`), ["documentId", "name", "mimeType"], ["documentId", "name"], 500));
    }
    this.assertPayloadSize(result);
    return result;
  }

  private orderEnvelope(order: ClinicalOrder): EncryptedEnvelope {
    if (order.algorithm !== "AES-256-GCM") throw new ConflictException("Unsupported clinical order encryption algorithm.");
    return { version: 1, algorithm: "AES-256-GCM", keyId: order.keyId, wrappedKey: order.wrappedKey, iv: order.iv, ciphertext: order.ciphertext };
  }

  private resultEnvelope(result: LaboratoryResult): EncryptedEnvelope {
    if (result.algorithm !== "AES-256-GCM") throw new ConflictException("Unsupported laboratory result encryption algorithm.");
    return { version: 1, algorithm: "AES-256-GCM", keyId: result.keyId, wrappedKey: result.wrappedKey, iv: result.iv, ciphertext: result.ciphertext };
  }

  private orderAttestationMaterial(type: OrderType, patientId: string, providerId: string, encounterRef: string, envelope: EncryptedEnvelope) {
    return { type, patientId, providerId, encounterRef, envelope };
  }

  private resultAttestationMaterial(orderId: string, envelope: EncryptedEnvelope) {
    return { orderId, envelope };
  }

  private async assertValidatedResultIntegrity(result: LaboratoryResult, orderId: string) {
    if (!result.validationDigest || !result.validationSignature || !result.validatedAt) throw new ConflictException("Validated laboratory result is missing its clinical attestation.");
    const material = this.resultAttestationMaterial(orderId, this.resultEnvelope(result));
    if (!(await this.attestation.verify(material, {
      payloadDigest: result.validationDigest,
      signature: result.validationSignature,
      signedAt: result.validatedAt,
      keyId: result.validationKeyId,
      algorithm: result.validationAlgorithm,
    }))) {
      throw new ConflictException("Laboratory result clinical attestation verification failed.");
    }
  }

  private object(value: unknown, name: string): JsonObject {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new BadRequestException(`${name} must be an object.`);
    return value as JsonObject;
  }

  private pickTextFields(value: JsonObject, allowed: string[], required: string[], max: number): JsonObject {
    const output: JsonObject = {};
    for (const key of allowed) {
      const item = value[key];
      if (item !== undefined && item !== null && item !== "") output[key] = this.requiredText(item, max, key);
    }
    for (const key of required) if (!output[key]) throw new BadRequestException(`${key} is required.`);
    return output;
  }

  private requiredText(value: unknown, max: number, field: string): string {
    if (typeof value !== "string") throw new BadRequestException(`${field} must be a string.`);
    const text = value.trim();
    if (!text || text.length > max) throw new BadRequestException(`${field} must contain between 1 and ${max} characters.`);
    return text;
  }

  private integer(value: unknown, min: number, max: number, field: string): number {
    if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) throw new BadRequestException(`${field} must be an integer between ${min} and ${max}.`);
    return value as number;
  }

  private assertPayloadSize(value: unknown) {
    if (Buffer.byteLength(JSON.stringify(value), "utf8") > MAX_PAYLOAD_BYTES) throw new BadRequestException("Clinical order payload is too large.");
  }
}
