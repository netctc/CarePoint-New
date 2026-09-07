import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { InsuranceClaimStatus, ReworkInsuranceClaimInput, SubmitInsuranceClaimInput } from "@carepoint/contracts";
import { roleHasPermission, type AuthPrincipal } from "@carepoint/identity";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { ClaimsGatewayService, type GatewayClaimResult } from "./claims-gateway.service";

@Injectable()
export class ClaimsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
    private readonly gateway: ClaimsGatewayService,
  ) {}

  async patientRevenueCycle(principal: AuthPrincipal) {
    const patient = await this.requirePatient(principal);
    const [claims, eobs] = await Promise.all([
      this.prisma.insuranceClaim.findMany({ where: { patientId: patient.id }, orderBy: [{ submittedAt: "desc" }, { version: "desc" }], take: 200 }),
      this.prisma.explanationOfBenefits.findMany({ where: { patientId: patient.id }, orderBy: { releasedAt: "desc" }, take: 200 }),
    ]);
    return {
      patientId: patient.id,
      claims: claims.map((claim) => this.presentPatientClaim(claim)),
      eobs,
    };
  }

  async providerRevenueCycle(principal: AuthPrincipal) {
    const provider = await this.requireActiveProvider(principal);
    const [claims, eobs, remittances] = await Promise.all([
      this.prisma.insuranceClaim.findMany({ where: { providerId: provider.id }, orderBy: [{ submittedAt: "desc" }, { version: "desc" }], take: 300 }),
      this.prisma.explanationOfBenefits.findMany({ where: { providerId: provider.id }, orderBy: { releasedAt: "desc" }, take: 300 }),
      this.prisma.insuranceRemittance.findMany({ where: { providerId: provider.id }, orderBy: { appliedAt: "desc" }, take: 300 }),
    ]);
    return { providerId: provider.id, claims, eobs, remittances };
  }

  async operatorRevenueCycle(principal: AuthPrincipal, status?: string) {
    if (!roleHasPermission(principal.role, "REVENUE_CYCLE_OPERATE")) throw new ForbiddenException("Revenue cycle operator permission is required.");
    const normalized = status ? this.claimStatus(status) : undefined;
    const claims = await this.prisma.insuranceClaim.findMany({
      where: normalized ? { status: normalized } : undefined,
      orderBy: [{ submittedAt: "desc" }, { version: "desc" }],
      take: 500,
    });
    return claims;
  }

  async submitClaim(principal: AuthPrincipal, appointmentId: string, input: SubmitInsuranceClaimInput) {
    const appointment = await this.requireClaimAppointmentAccess(principal, appointmentId);
    if (appointment.status !== "COMPLETED") throw new ConflictException("Insurance claims can be submitted only after the appointment is completed.");
    const idempotencyKey = this.idempotencyKey(input.idempotencyKey);
    const duplicate = await this.prisma.insuranceClaim.findUnique({ where: { idempotencyKey } });
    if (duplicate) {
      if (duplicate.appointmentId !== appointment.id || duplicate.coverageId !== input.coverageId) throw new ConflictException("idempotencyKey is already in use.");
      return duplicate;
    }
    const [invoice, coverage, eligibility, latestClaim] = await Promise.all([
      this.prisma.invoice.findUnique({ where: { appointmentId: appointment.id } }),
      this.prisma.insuranceCoverage.findUnique({ where: { id: input.coverageId } }),
      this.prisma.insuranceEligibilityCheck.findFirst({ where: { appointmentId: appointment.id, coverageId: input.coverageId }, orderBy: { checkedAt: "desc" } }),
      this.prisma.insuranceClaim.findFirst({ where: { appointmentId: appointment.id }, orderBy: { version: "desc" } }),
    ]);
    if (!invoice || invoice.status === "VOID" || invoice.status === "REFUNDED") throw new ConflictException("This appointment does not have a claimable invoice.");
    if (!coverage || coverage.patientId !== appointment.patientId) throw new NotFoundException("Insurance coverage not found.");
    this.assertCoverageEffective(coverage);
    if (!eligibility || eligibility.status !== "ELIGIBLE") throw new ConflictException("A current ELIGIBLE insurance check is required before claim submission.");
    if (eligibility.expiresAt && eligibility.expiresAt.getTime() < Date.now()) throw new ConflictException("The insurance eligibility check has expired.");
    if (latestClaim) throw new ConflictException("This appointment already has a claim. Use the rework flow after a denial.");
    await this.assertPriorAuthorizationAllowsClaim(appointment.id, coverage.id);

    const gateway = await this.gateway.submitClaim({
      idempotencyKey,
      payerCode: coverage.payerCode,
      externalPolicyRef: coverage.externalPolicyRef,
      appointmentId: appointment.id,
      invoiceId: invoice.id,
      serviceId: appointment.serviceId,
      submittedAmountMinor: invoice.totalMinor,
      currency: invoice.currency,
    });
    const claim = await this.persistSubmittedClaim({
      appointmentId: appointment.id,
      invoiceId: invoice.id,
      coverageId: coverage.id,
      patientId: appointment.patientId,
      providerId: appointment.providerId,
      version: 1,
      idempotencyKey,
      submittedAmountMinor: invoice.totalMinor,
      currency: invoice.currency,
      gateway,
    });
    await this.audit.write({ actorId: principal.accountId, action: "INSURANCE_CLAIM_SUBMITTED", objectType: "INSURANCE_CLAIM", objectId: claim.id, result: "SUCCESS", metadata: { appointmentId: appointment.id, invoiceId: invoice.id, version: claim.version } });
    return claim;
  }

  async refreshClaim(principal: AuthPrincipal, claimId: string) {
    const claim = await this.requireClaimAccess(principal, claimId);
    if (claim.status === "PAID" || claim.status === "VOID" || claim.status === "DENIED") return this.claimDetails(claim.id, principal.role === "PATIENT");
    if (!claim.gatewayClaimRef) throw new ConflictException("Claim does not have a payer reference.");
    const coverage = await this.prisma.insuranceCoverage.findUnique({ where: { id: claim.coverageId } });
    if (!coverage) throw new NotFoundException("Insurance coverage not found.");
    const expectedStatus = claim.status;
    const result = await this.gateway.refreshClaim({
      idempotencyKey: `claim-refresh-${claim.id}-${expectedStatus}`,
      payerCode: coverage.payerCode,
      claimReference: claim.gatewayClaimRef,
      currentStatus: expectedStatus,
      submittedAmountMinor: claim.submittedAmountMinor,
      currency: claim.currency,
    });
    const updated = await this.applyGatewayResult(claim.id, expectedStatus, coverage.payerCode, result);
    await this.audit.write({ actorId: principal.accountId, action: "INSURANCE_CLAIM_REFRESHED", objectType: "INSURANCE_CLAIM", objectId: claim.id, result: "SUCCESS", metadata: { fromStatus: expectedStatus, toStatus: updated.status, reconciliationStatus: updated.reconciliationStatus } });
    return this.claimDetails(updated.id, principal.role === "PATIENT");
  }

  async reworkClaim(principal: AuthPrincipal, claimId: string, input: ReworkInsuranceClaimInput) {
    const original = await this.requireClaimAccess(principal, claimId);
    if (original.status !== "DENIED") throw new ConflictException("Only denied claims can be reworked.");
    const idempotencyKey = this.idempotencyKey(input.idempotencyKey);
    const reasonCode = this.reasonCode(input.reasonCode);
    const duplicate = await this.prisma.insuranceClaim.findUnique({ where: { idempotencyKey } });
    if (duplicate) {
      if (duplicate.previousClaimId !== original.id) throw new ConflictException("idempotencyKey is already in use.");
      return duplicate;
    }
    const latest = await this.prisma.insuranceClaim.findFirst({ where: { invoiceId: original.invoiceId }, orderBy: { version: "desc" } });
    if (!latest || latest.id !== original.id) throw new ConflictException("A newer claim version already exists.");
    const [coverage, appointment] = await Promise.all([
      this.prisma.insuranceCoverage.findUnique({ where: { id: original.coverageId } }),
      this.prisma.appointment.findUnique({ where: { id: original.appointmentId } }),
    ]);
    if (!coverage || !appointment) throw new NotFoundException("Claim context not found.");
    this.assertCoverageEffective(coverage);
    const gateway = await this.gateway.submitClaim({
      idempotencyKey,
      payerCode: coverage.payerCode,
      externalPolicyRef: coverage.externalPolicyRef,
      appointmentId: original.appointmentId,
      invoiceId: original.invoiceId,
      serviceId: appointment.serviceId,
      submittedAmountMinor: original.submittedAmountMinor,
      currency: original.currency,
      ...(original.gatewayClaimRef ? { previousClaimReference: original.gatewayClaimRef } : {}),
    });
    const replacement = await this.persistSubmittedClaim({
      appointmentId: original.appointmentId,
      invoiceId: original.invoiceId,
      coverageId: original.coverageId,
      patientId: original.patientId,
      providerId: original.providerId,
      previousClaimId: original.id,
      version: original.version + 1,
      idempotencyKey,
      submittedAmountMinor: original.submittedAmountMinor,
      currency: original.currency,
      reworkReasonCode: reasonCode,
      gateway,
    });
    await this.audit.write({ actorId: principal.accountId, action: "INSURANCE_CLAIM_REWORKED", objectType: "INSURANCE_CLAIM", objectId: replacement.id, result: "SUCCESS", metadata: { originalClaimId: original.id, version: replacement.version, reasonCode } });
    return replacement;
  }

  async claimDetails(claimId: string, patientSafe = false) {
    const claim = await this.prisma.insuranceClaim.findUnique({ where: { id: claimId } });
    if (!claim) throw new NotFoundException("Insurance claim not found.");
    const [eob, events, remittances] = await Promise.all([
      this.prisma.explanationOfBenefits.findUnique({ where: { claimId: claim.id } }),
      this.prisma.claimEvent.findMany({ where: { claimId: claim.id }, orderBy: { occurredAt: "asc" } }),
      this.prisma.insuranceRemittance.findMany({ where: { claimId: claim.id }, orderBy: { appliedAt: "asc" } }),
    ]);
    if (patientSafe) return { claim: this.presentPatientClaim(claim), eob, events: events.map(({ gatewayReference: _internal, ...event }) => event) };
    return { claim, eob, events, remittances };
  }

  private async persistSubmittedClaim(input: {
    appointmentId: string;
    invoiceId: string;
    coverageId: string;
    patientId: string;
    providerId: string;
    previousClaimId?: string;
    version: number;
    idempotencyKey: string;
    submittedAmountMinor: number;
    currency: string;
    reworkReasonCode?: string;
    gateway: GatewayClaimResult;
  }) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const claim = await tx.insuranceClaim.create({
          data: {
            appointmentId: input.appointmentId,
            invoiceId: input.invoiceId,
            coverageId: input.coverageId,
            patientId: input.patientId,
            providerId: input.providerId,
            ...(input.previousClaimId ? { previousClaimId: input.previousClaimId } : {}),
            version: input.version,
            idempotencyKey: input.idempotencyKey,
            gateway: input.gateway.gateway,
            gatewayClaimRef: input.gateway.reference,
            status: input.gateway.status,
            submittedAmountMinor: input.submittedAmountMinor,
            currency: input.currency,
            ...(input.reworkReasonCode ? { reworkReasonCode: input.reworkReasonCode } : {}),
          },
        });
        await tx.claimEvent.create({ data: { claimId: claim.id, status: claim.status, source: "SUBMISSION", gatewayReference: input.gateway.reference } });
        return claim;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (this.isPrismaError(error, "P2002")) {
        const duplicate = await this.prisma.insuranceClaim.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
        if (duplicate) return duplicate;
      }
      throw error;
    }
  }

  private async applyGatewayResult(claimId: string, expectedStatus: InsuranceClaimStatus, payerCode: string, result: GatewayClaimResult) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const claim = await tx.insuranceClaim.findUnique({ where: { id: claimId } });
        if (!claim) throw new NotFoundException("Insurance claim not found.");
        if (claim.status !== expectedStatus) return claim;

        const adjudicated = result.status === "ADJUDICATED" || result.status === "DENIED" || result.status === "PAID";
        if (adjudicated) this.assertAdjudicationAmounts(claim.submittedAmountMinor, result);
        let reconciliationStatus = claim.reconciliationStatus;
        if (adjudicated) reconciliationStatus = await this.reconcileInvoice(tx, claim.invoiceId, result);

        const updated = await tx.insuranceClaim.update({
          where: { id: claim.id },
          data: {
            status: result.status,
            gateway: result.gateway,
            gatewayClaimRef: result.reference,
            reconciliationStatus,
            ...(result.allowedMinor !== undefined ? { allowedMinor: result.allowedMinor } : {}),
            ...(result.insurerPaidMinor !== undefined ? { insurerPaidMinor: result.insurerPaidMinor } : {}),
            ...(result.patientResponsibilityMinor !== undefined ? { patientResponsibilityMinor: result.patientResponsibilityMinor } : {}),
            ...(result.adjustmentMinor !== undefined ? { adjustmentMinor: result.adjustmentMinor } : {}),
            ...(result.denialCode ? { denialCode: result.denialCode } : {}),
            ...(result.denialPublicMessage ? { denialPublicMessage: result.denialPublicMessage } : {}),
            ...(adjudicated ? { adjudicatedAt: claim.adjudicatedAt ?? new Date() } : {}),
            ...(result.status === "PAID" ? { paidAt: claim.paidAt ?? new Date() } : {}),
          },
        });
        await tx.claimEvent.create({ data: { claimId: claim.id, status: result.status, source: "PAYER_STATUS", gatewayReference: result.reference } });

        if (adjudicated) {
          await tx.explanationOfBenefits.upsert({
            where: { claimId: claim.id },
            create: {
              claimId: claim.id,
              patientId: claim.patientId,
              providerId: claim.providerId,
              payerCode,
              externalEobRef: result.eobReference!,
              billedMinor: claim.submittedAmountMinor,
              allowedMinor: result.allowedMinor!,
              insurerPaidMinor: result.insurerPaidMinor!,
              patientResponsibilityMinor: result.patientResponsibilityMinor!,
              adjustmentMinor: result.adjustmentMinor!,
              currency: claim.currency,
              ...(result.denialCode ? { denialCode: result.denialCode } : {}),
              ...(result.denialPublicMessage ? { denialPublicMessage: result.denialPublicMessage } : {}),
            },
            update: {
              externalEobRef: result.eobReference!,
              allowedMinor: result.allowedMinor!,
              insurerPaidMinor: result.insurerPaidMinor!,
              patientResponsibilityMinor: result.patientResponsibilityMinor!,
              adjustmentMinor: result.adjustmentMinor!,
              denialCode: result.denialCode ?? null,
              denialPublicMessage: result.denialPublicMessage ?? null,
            },
          });
        }

        if (result.status === "PAID" && result.remittanceReference && result.insurerPaidMinor && result.insurerPaidMinor > 0) {
          const existing = await tx.insuranceRemittance.findUnique({ where: { externalRemittanceRef: result.remittanceReference } });
          if (!existing) {
            const remittance = await tx.insuranceRemittance.create({
              data: {
                claimId: claim.id,
                providerId: claim.providerId,
                invoiceId: claim.invoiceId,
                externalRemittanceRef: result.remittanceReference,
                idempotencyKey: `claim-remittance-${claim.id}`,
                amountMinor: result.insurerPaidMinor,
                currency: claim.currency,
              },
            });
            await tx.providerLedgerEntry.create({
              data: {
                providerId: claim.providerId,
                invoiceId: claim.invoiceId,
                type: "INSURANCE_PAYMENT",
                amountMinor: remittance.amountMinor,
                currency: remittance.currency,
                reference: remittance.externalRemittanceRef,
              },
            });
          }
        }
        return updated;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (this.isPrismaError(error, "P2002")) return this.prisma.insuranceClaim.findUniqueOrThrow({ where: { id: claimId } });
      throw error;
    }
  }

  private async reconcileInvoice(tx: Prisma.TransactionClient, invoiceId: string, result: GatewayClaimResult): Promise<"NOT_RECONCILED" | "RECONCILED" | "REVIEW_REQUIRED"> {
    const invoice = await tx.invoice.findUnique({ where: { id: invoiceId } });
    if (!invoice || result.patientResponsibilityMinor === undefined || result.insurerPaidMinor === undefined || result.adjustmentMinor === undefined) return "REVIEW_REQUIRED";
    if (result.adjustmentMinor > 0) return "REVIEW_REQUIRED";
    if (invoice.amountPaidMinor > 0 || invoice.amountRefundedMinor > 0) {
      return invoice.patientResponsibilityMinor === result.patientResponsibilityMinor && invoice.insurerResponsibilityMinor === result.insurerPaidMinor ? "RECONCILED" : "REVIEW_REQUIRED";
    }
    if (result.patientResponsibilityMinor + result.insurerPaidMinor !== invoice.totalMinor) return "REVIEW_REQUIRED";
    await tx.invoice.update({
      where: { id: invoice.id },
      data: {
        patientResponsibilityMinor: result.patientResponsibilityMinor,
        insurerResponsibilityMinor: result.insurerPaidMinor,
        balanceDueMinor: result.patientResponsibilityMinor,
        status: result.patientResponsibilityMinor === 0 ? "PAID" : "OPEN",
      },
    });
    return "RECONCILED";
  }

  private assertAdjudicationAmounts(submittedAmountMinor: number, result: GatewayClaimResult) {
    if (result.allowedMinor === undefined || result.insurerPaidMinor === undefined || result.patientResponsibilityMinor === undefined || result.adjustmentMinor === undefined || !result.eobReference) {
      throw new ConflictException("Payer adjudication is incomplete.");
    }
    if (result.allowedMinor + result.adjustmentMinor !== submittedAmountMinor) throw new ConflictException("Payer adjudication does not reconcile to the submitted amount.");
    if (result.insurerPaidMinor + result.patientResponsibilityMinor !== result.allowedMinor) throw new ConflictException("Payer adjudication does not reconcile allowed responsibility.");
  }

  private async assertPriorAuthorizationAllowsClaim(appointmentId: string, coverageId: string) {
    const prior = await this.prisma.priorAuthorization.findFirst({ where: { appointmentId, coverageId }, orderBy: { createdAt: "desc" } });
    if (!prior || prior.status === "NOT_REQUIRED" || prior.status === "APPROVED") return;
    throw new ConflictException(`Prior authorization status ${prior.status} does not allow claim submission.`);
  }

  private async requireClaimAppointmentAccess(principal: AuthPrincipal, appointmentId: string) {
    const appointment = await this.prisma.appointment.findUnique({ where: { id: appointmentId }, include: { provider: { select: { userId: true } } } });
    if (!appointment) throw new NotFoundException("Appointment not found.");
    if ((principal.role === "DOCTOR" || principal.role === "OTHER_PROVIDER") && roleHasPermission(principal.role, "PROVIDER_MANAGE_CLAIMS") && appointment.provider.userId === principal.accountId) return appointment;
    if (roleHasPermission(principal.role, "REVENUE_CYCLE_OPERATE")) return appointment;
    throw new ForbiddenException("Claim submission access denied.");
  }

  private async requireClaimAccess(principal: AuthPrincipal, claimId: string) {
    const claim = await this.prisma.insuranceClaim.findUnique({ where: { id: claimId } });
    if (!claim) throw new NotFoundException("Insurance claim not found.");
    if (principal.role === "PATIENT") {
      const patient = await this.requirePatient(principal);
      if (claim.patientId === patient.id) return claim;
    }
    if ((principal.role === "DOCTOR" || principal.role === "OTHER_PROVIDER") && roleHasPermission(principal.role, "PROVIDER_MANAGE_CLAIMS")) {
      const provider = await this.requireActiveProvider(principal);
      if (claim.providerId === provider.id) return claim;
    }
    if (roleHasPermission(principal.role, "REVENUE_CYCLE_OPERATE")) return claim;
    throw new ForbiddenException("Insurance claim access denied.");
  }

  private async requirePatient(principal: AuthPrincipal) {
    if (principal.role !== "PATIENT") throw new ForbiddenException("A patient account is required.");
    const patient = await this.prisma.patientProfile.findUnique({ where: { userId: principal.accountId } });
    if (!patient) throw new NotFoundException("Patient profile not found.");
    return patient;
  }

  private async requireActiveProvider(principal: AuthPrincipal) {
    if (principal.role !== "DOCTOR" && principal.role !== "OTHER_PROVIDER") throw new ForbiddenException("A provider account is required.");
    const provider = await this.prisma.provider.findUnique({ where: { userId: principal.accountId } });
    if (!provider || provider.status !== "ACTIVE") throw new ForbiddenException("Provider must be active.");
    return provider;
  }

  private assertCoverageEffective(coverage: { status: string; effectiveFrom: Date | null; effectiveUntil: Date | null }) {
    if (coverage.status !== "ACTIVE") throw new ConflictException("Insurance coverage is not active.");
    const now = Date.now();
    if (coverage.effectiveFrom && coverage.effectiveFrom.getTime() > now) throw new ConflictException("Insurance coverage is not effective yet.");
    if (coverage.effectiveUntil && coverage.effectiveUntil.getTime() < now) throw new ConflictException("Insurance coverage has expired.");
  }

  private presentPatientClaim<T extends { gatewayClaimRef: string | null; gateway: string; reworkReasonCode: string | null }>(claim: T) {
    const { gatewayClaimRef: _gatewayReference, gateway: _gateway, reworkReasonCode: _internalReason, ...safe } = claim;
    return safe;
  }

  private idempotencyKey(value: string): string {
    const key = value?.trim();
    if (!key || key.length < 8 || key.length > 128) throw new BadRequestException("idempotencyKey must contain between 8 and 128 characters.");
    return key;
  }

  private reasonCode(value: string): string {
    const code = value?.trim().toUpperCase();
    if (!code || !/^[A-Z0-9_-]{2,40}$/.test(code)) throw new BadRequestException("reasonCode must contain 2-40 letters, numbers, underscore or dash characters.");
    return code;
  }

  private claimStatus(value: string): InsuranceClaimStatus {
    if (value === "SUBMITTED" || value === "ACCEPTED" || value === "PENDING" || value === "ADJUDICATED" || value === "DENIED" || value === "PAID" || value === "VOID") return value;
    throw new BadRequestException("Unsupported insurance claim status filter.");
  }

  private isPrismaError(error: unknown, code: string): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;
  }
}
