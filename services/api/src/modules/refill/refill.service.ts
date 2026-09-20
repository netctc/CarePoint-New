import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { AuthPrincipal } from "@carepoint/identity";
import type { EncryptedEnvelope } from "@carepoint/security";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { ClinicalEnvelopeService } from "../clinical/clinical-envelope.service";
import { NotificationsService } from "../communications/notifications.service";
import { PatientContextService } from "../dependents/dependents.service";
import { OrdersService } from "../orders/orders.service";
import { normalizeRefillRequestInput, normalizeRefillReviewInput, refillAllowance } from "./refill.engine";

type EnvelopeFields = {
  algorithm: string;
  keyId: string;
  wrappedKey: string;
  iv: string;
  ciphertext: string;
};

@Injectable()
export class RefillService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
    private readonly envelope: ClinicalEnvelopeService,
    private readonly notifications: NotificationsService,
    private readonly contexts: PatientContextService,
    private readonly orders: OrdersService,
  ) {}

  async request(principal: AuthPrincipal, prescriptionId: string, input: unknown) {
    if (principal.role !== "PATIENT") throw new ForbiddenException("Patient account is required.");
    const context = await this.contexts.resolveEffectivePatient(principal, "CLINICAL_WRITE");
    const source = await this.orders.getPrescriptionRefillSource(this.id(prescriptionId, "prescriptionId"), context.patientId);
    const prescriber = await this.prisma.provider.findUnique({ where: { id: source.providerId }, select: { id: true, status: true, userId: true } });
    if (!prescriber || prescriber.status !== "ACTIVE") throw new ConflictException("The responsible prescriber is not currently available for refill review.");

    const normalized = normalizeRefillRequestInput(input);
    const encrypted = await this.envelope.encryptRecord({ schemaVersion: 1, reason: normalized.reason });
    let result;
    try {
      result = await this.prisma.$transaction(async (tx) => {
        const approvedCount = await tx.refillRequest.count({ where: { sourcePrescriptionId: source.id, status: "APPROVED" } });
        const allowance = refillAllowance(source.refills, approvedCount);
        if (!allowance.eligible) throw new ConflictException("No refill allowance remains on this prescription.");
        const open = await tx.refillRequest.findFirst({ where: { sourcePrescriptionId: source.id, status: "REQUESTED" }, select: { id: true } });
        if (open) throw new ConflictException("A refill request is already awaiting review.");

        const created = await tx.refillRequest.create({
          data: {
            sourcePrescriptionId: source.id,
            patientId: context.patientId,
            requestedProviderId: source.providerId,
            ...this.requestEnvelopeData(encrypted),
          },
        });
        await this.audit.writeClinicalInTransaction(tx, {
          actorId: principal.accountId,
          action: "REFILL_REQUEST_CREATED",
          objectType: "REFILL_REQUEST",
          objectId: created.id,
          purpose: context.mode === "DEPENDENT" ? "PROXY_PATIENT_ACCESS" : "PATIENT_ACCESS",
          result: "SUCCESS",
          metadata: { patientId: context.patientId, providerId: source.providerId, resourceId: created.id, decision: "ALLOW" },
        });
        if (prescriber.userId) {
          await this.notifications.enqueueAccountInTransaction(tx, {
            accountId: prescriber.userId,
            dedupeKey: "refill-request:" + created.id,
            type: "CARE_COORDINATION",
            entityType: "REFILL_REQUEST",
            entityId: created.id,
            safeTitleKey: "notification.refill_request.title",
            safeBodyKey: "notification.refill_request.body",
          });
        }
        return { created, allowance };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException("A refill request is already awaiting review.");
      }
      throw error;
    }
    if (prescriber.userId) this.notifications.wakeOutbox();
    return this.present(result.created, normalized, null, result.allowance);
  }

  async patientList(principal: AuthPrincipal) {
    if (principal.role !== "PATIENT") throw new ForbiddenException("Patient account is required.");
    const context = await this.contexts.resolveEffectivePatient(principal, "CLINICAL_READ");
    const rows = await this.prisma.refillRequest.findMany({ where: { patientId: context.patientId }, orderBy: { requestedAt: "desc" }, take: 200 });
    const items = [];
    for (const row of rows) items.push(await this.presentRow(row));
    return { patientId: context.patientId, mode: context.mode, items };
  }

  async providerList(principal: AuthPrincipal) {
    const provider = await this.orders.requirePrescriptionRefillProvider(principal);
    const rows = await this.prisma.refillRequest.findMany({ where: { requestedProviderId: provider.id }, orderBy: { requestedAt: "desc" }, take: 200 });
    const items = [];
    for (const row of rows) items.push(await this.presentRow(row));
    return { providerId: provider.id, items };
  }

  async review(principal: AuthPrincipal, requestId: string, input: unknown) {
    const provider = await this.orders.requirePrescriptionRefillProvider(principal);
    const review = normalizeRefillReviewInput(input);
    const row = await this.prisma.refillRequest.findUnique({ where: { id: this.id(requestId, "requestId") } });
    if (!row || row.requestedProviderId !== provider.id) throw new NotFoundException("Refill request not found.");
    if (row.status !== "REQUESTED") throw new ConflictException("Refill request has already been reviewed.");
    if (row.version !== review.expectedVersion) throw new ConflictException({ message: "Refill request version conflict.", currentVersion: row.version });

    if (review.action === "DECLINE") {
      const encrypted = await this.envelope.encryptRecord({ schemaVersion: 1, reason: review.reason });
      const updated = await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw(Prisma.sql`SELECT id FROM "RefillRequest" WHERE id = ${row.id} FOR UPDATE`);
        const current = await tx.refillRequest.findUnique({ where: { id: row.id } });
        if (!current || current.requestedProviderId !== provider.id) throw new NotFoundException("Refill request not found.");
        if (current.status !== "REQUESTED") throw new ConflictException("Refill request has already been reviewed.");
        if (current.version !== review.expectedVersion) throw new ConflictException({ message: "Refill request version conflict.", currentVersion: current.version });
        const outcome = await tx.refillRequest.update({
          where: { id: current.id },
          data: {
            status: "DECLINED",
            version: current.version + 1,
            reviewedByActorId: principal.accountId,
            reviewedAt: new Date(),
            ...this.reviewEnvelopeData(encrypted),
          },
        });
        await this.audit.writeClinicalInTransaction(tx, {
          actorId: principal.accountId,
          action: "REFILL_REQUEST_DECLINED",
          objectType: "REFILL_REQUEST",
          objectId: outcome.id,
          purpose: "TREATMENT",
          result: "SUCCESS",
          metadata: { patientId: outcome.patientId, providerId: provider.id, resourceId: outcome.id, resourceVersion: outcome.version, decision: "ALLOW" },
        });
        await this.enqueuePatientOutcome(tx, outcome.patientId, outcome.id, outcome.version, "declined");
        return outcome;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      this.notifications.wakeOutbox();
      return this.presentRow(updated);
    }

    const source = await this.orders.getPrescriptionRefillSource(row.sourcePrescriptionId, row.patientId);
    if (source.providerId !== provider.id) throw new ForbiddenException("Only the responsible prescriber can approve this refill.");
    const approvedCount = await this.prisma.refillRequest.count({ where: { sourcePrescriptionId: source.id, status: "APPROVED" } });
    const allowance = refillAllowance(source.refills, approvedCount);
    if (!allowance.eligible) throw new ConflictException("No refill allowance remains on this prescription.");

    const prepared = await this.orders.preparePrescriptionFromRefill(
      principal,
      source.id,
      row.id,
      row.patientId,
    );
    const encrypted = await this.envelope.encryptRecord({ schemaVersion: 1, reason: review.reason });
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "RefillRequest" WHERE id = ${row.id} FOR UPDATE`);
      const current = await tx.refillRequest.findUnique({ where: { id: row.id } });
      if (!current || current.requestedProviderId !== provider.id) throw new NotFoundException("Refill request not found.");
      if (current.status !== "REQUESTED") throw new ConflictException("Refill request has already been reviewed.");
      if (current.version !== review.expectedVersion) throw new ConflictException({ message: "Refill request version conflict.", currentVersion: current.version });

      const currentSource = await tx.clinicalOrder.findUnique({
        where: { id: source.id },
        select: { id: true, patientId: true, providerId: true, type: true, status: true },
      });
      if (!currentSource || currentSource.patientId !== row.patientId || currentSource.providerId !== provider.id || currentSource.type !== "PRESCRIPTION" || currentSource.status !== "SIGNED") {
        throw new ConflictException("The source prescription is no longer refill-eligible.");
      }
      const currentApproved = await tx.refillRequest.count({ where: { sourcePrescriptionId: source.id, status: "APPROVED" } });
      if (!refillAllowance(source.refills, currentApproved).eligible) throw new ConflictException("No refill allowance remains on this prescription.");

      let prescription = await tx.clinicalOrder.findUnique({ where: { idempotencyKey: prepared.idempotencyKey } });
      if (prescription) {
        if (prescription.patientId !== row.patientId || prescription.providerId !== provider.id || prescription.type !== "PRESCRIPTION") {
          throw new ConflictException("Refill idempotency key is bound to another order.");
        }
      } else {
        prescription = await tx.clinicalOrder.create({ data: prepared.orderData });
      }

      const outcome = await tx.refillRequest.update({
        where: { id: current.id },
        data: {
          status: "APPROVED",
          version: current.version + 1,
          reviewedByActorId: principal.accountId,
          reviewedAt: new Date(),
          approvedPrescriptionId: prescription.id,
          ...this.reviewEnvelopeData(encrypted),
        },
      });
      await this.audit.writeClinicalInTransaction(tx, {
        actorId: principal.accountId,
        action: "CLINICAL_REFILL_PRESCRIPTION_SIGNED",
        objectType: "CLINICAL_ORDER",
        objectId: prescription.id,
        purpose: "TREATMENT",
        result: "SUCCESS",
        metadata: { patientId: row.patientId, providerId: provider.id, resourceId: prescription.id, decision: "ALLOW" },
      });
      await this.audit.writeClinicalInTransaction(tx, {
        actorId: principal.accountId,
        action: "REFILL_REQUEST_APPROVED",
        objectType: "REFILL_REQUEST",
        objectId: outcome.id,
        purpose: "TREATMENT",
        result: "SUCCESS",
        metadata: { patientId: row.patientId, providerId: provider.id, resourceId: outcome.id, resourceVersion: outcome.version, decision: "ALLOW" },
      });
      await this.enqueuePatientOutcome(tx, outcome.patientId, outcome.id, outcome.version, "approved");
      return outcome;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    this.notifications.wakeOutbox();
    return this.presentRow(updated);
  }

  private async enqueuePatientOutcome(
    tx: Prisma.TransactionClient,
    patientId: string,
    requestId: string,
    version: number,
    outcome: "approved" | "declined",
  ) {
    const patient = await tx.patientProfile.findUnique({ where: { id: patientId }, select: { userId: true } });
    if (!patient) throw new NotFoundException("Patient profile not found.");
    await this.notifications.enqueueAccountInTransaction(tx, {
      accountId: patient.userId,
      dedupeKey: "refill-outcome:" + requestId + ":v" + version,
      type: "CARE_COORDINATION",
      entityType: "REFILL_REQUEST",
      entityId: requestId,
      safeTitleKey: "notification.refill_" + outcome + ".title",
      safeBodyKey: "notification.refill_" + outcome + ".body",
    });
  }

  private async presentRow(row: any) {
    const requestPayload = await this.decryptRequest(row);
    const reviewPayload = await this.decryptReview(row);
    const approvedCount = await this.prisma.refillRequest.count({ where: { sourcePrescriptionId: row.sourcePrescriptionId, status: "APPROVED" } });
    const source = await this.orders.getPrescriptionRefillSource(row.sourcePrescriptionId, row.patientId, false);
    return this.present(row, requestPayload, reviewPayload, refillAllowance(source.refills, approvedCount));
  }

  private present(row: any, requestPayload: any, reviewPayload: any, allowance: ReturnType<typeof refillAllowance>) {
    return {
      id: row.id,
      sourcePrescriptionId: row.sourcePrescriptionId,
      patientId: row.patientId,
      requestedProviderId: row.requestedProviderId,
      status: row.status,
      version: row.version,
      requestedAt: row.requestedAt,
      reviewedAt: row.reviewedAt,
      approvedPrescriptionId: row.approvedPrescriptionId,
      request: { reason: requestPayload?.reason ?? null },
      review: reviewPayload ? { reason: reviewPayload.reason ?? null } : null,
      refillAllowance: allowance,
    };
  }

  private async decryptRequest(row: any) {
    return this.envelope.decryptRecord<Record<string, unknown>>({
      version: 1,
      algorithm: row.requestAlgorithm,
      keyId: row.requestKeyId,
      wrappedKey: row.requestWrappedKey,
      iv: row.requestIv,
      ciphertext: row.requestCiphertext,
    });
  }

  private async decryptReview(row: any) {
    if (!row.reviewAlgorithm || !row.reviewKeyId || !row.reviewWrappedKey || !row.reviewIv || !row.reviewCiphertext) return null;
    return this.envelope.decryptRecord<Record<string, unknown>>({
      version: 1,
      algorithm: row.reviewAlgorithm,
      keyId: row.reviewKeyId,
      wrappedKey: row.reviewWrappedKey,
      iv: row.reviewIv,
      ciphertext: row.reviewCiphertext,
    });
  }

  private requestEnvelopeData(envelope: EncryptedEnvelope) {
    return {
      requestAlgorithm: envelope.algorithm,
      requestKeyId: envelope.keyId,
      requestWrappedKey: envelope.wrappedKey,
      requestIv: envelope.iv,
      requestCiphertext: envelope.ciphertext,
    };
  }

  private reviewEnvelopeData(envelope: EncryptedEnvelope) {
    return {
      reviewAlgorithm: envelope.algorithm,
      reviewKeyId: envelope.keyId,
      reviewWrappedKey: envelope.wrappedKey,
      reviewIv: envelope.iv,
      reviewCiphertext: envelope.ciphertext,
    };
  }

  private id(value: unknown, field: string) {
    if (typeof value !== "string") throw new BadRequestException(field + " is required.");
    const normalized = value.trim();
    if (!/^[A-Za-z0-9_.:-]{1,180}$/.test(normalized)) throw new BadRequestException(field + " is invalid.");
    return normalized;
  }
}
