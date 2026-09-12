import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  CreateInsuranceCoverageInput,
  CreatePaymentIntentInput,
  CreateProviderPayoutInput,
  CreateRefundInput,
  InsuranceEligibilityInput,
  PriorAuthorizationInput,
} from "@carepoint/contracts";
import { roleHasPermission, type AuthPrincipal } from "@carepoint/identity";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { PaymentGatewayService } from "./payment-gateway.service";
import { InsuranceGatewayService } from "./insurance-gateway.service";

const FINANCIAL_RETRIES = 3;

@Injectable()
export class BillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
    private readonly payments: PaymentGatewayService,
    private readonly insurance: InsuranceGatewayService,
  ) {}

  async patientBilling(principal: AuthPrincipal) {
    const patient = await this.requirePatient(principal);
    const [invoices, intents, receipts] = await Promise.all([
      this.prisma.invoice.findMany({ where: { patientId: patient.id }, orderBy: { issuedAt: "desc" }, take: 200 }),
      this.prisma.paymentIntent.findMany({ where: { patientId: patient.id }, orderBy: { createdAt: "desc" }, take: 200 }),
      this.prisma.paymentReceipt.findMany({ where: { patientId: patient.id }, orderBy: { issuedAt: "desc" }, take: 200 }),
    ]);
    return { patientId: patient.id, invoices, paymentIntents: intents, receipts };
  }

  async createPaymentIntent(principal: AuthPrincipal, invoiceId: string, input: CreatePaymentIntentInput) {
    const patient = await this.requirePatient(principal);
    const invoice = await this.prisma.invoice.findUnique({ where: { id: invoiceId } });
    if (!invoice || invoice.patientId !== patient.id) throw new NotFoundException("Invoice not found.");
    if (invoice.status === "VOID" || invoice.status === "REFUNDED") throw new ConflictException("This invoice cannot accept payments.");
    if (invoice.balanceDueMinor <= 0) throw new ConflictException("This invoice has no payable balance.");
    const idempotencyKey = this.idempotencyKey(input.idempotencyKey);
    const duplicate = await this.prisma.paymentIntent.findUnique({ where: { idempotencyKey } });
    if (duplicate) {
      if (duplicate.patientId !== patient.id || duplicate.invoiceId !== invoice.id) throw new ConflictException("idempotencyKey is already in use.");
      return this.presentIntent(duplicate);
    }
    const amountMinor = input.amountMinor ?? invoice.balanceDueMinor;
    if (!Number.isInteger(amountMinor) || amountMinor <= 0 || amountMinor > invoice.balanceDueMinor) throw new BadRequestException("amountMinor must be a positive integer not exceeding the invoice balance.");
    const paymentMethodToken = input.paymentMethodToken?.trim();
    if (paymentMethodToken && paymentMethodToken.length > 512) throw new BadRequestException("paymentMethodToken is too long.");

    const intent = await this.prisma.paymentIntent.create({
      data: {
        invoiceId: invoice.id,
        patientId: patient.id,
        providerId: invoice.providerId,
        amountMinor,
        currency: invoice.currency,
        gateway: this.payments.name(),
        idempotencyKey,
        status: "PROCESSING",
      },
    });

    try {
      const gateway = await this.payments.createIntent({
        idempotencyKey,
        amountMinor,
        currency: invoice.currency,
        reference: invoice.number,
        ...(paymentMethodToken ? { paymentMethodToken } : {}),
      });
      if (gateway.status === "SUCCEEDED") {
        const settled = await this.settleSuccessfulPayment(intent.id, gateway.reference);
        await this.audit.write({ actorId: principal.accountId, action: "PAYMENT_SUCCEEDED", objectType: "PAYMENT_INTENT", objectId: intent.id, result: "SUCCESS", metadata: { invoiceId: invoice.id, amountMinor, currency: invoice.currency } });
        return { ...this.presentIntent(settled.intent), receipt: settled.receipt };
      }
      const updated = await this.prisma.paymentIntent.update({
        where: { id: intent.id },
        data: {
          gatewayIntentRef: gateway.reference,
          status: gateway.status,
          failureCode: gateway.failureCode ?? null,
        },
      });
      await this.audit.write({ actorId: principal.accountId, action: "PAYMENT_INTENT_CREATED", objectType: "PAYMENT_INTENT", objectId: intent.id, result: "SUCCESS", metadata: { invoiceId: invoice.id, status: gateway.status } });
      return { ...this.presentIntent(updated), ...(gateway.actionUrl ? { actionUrl: gateway.actionUrl } : {}) };
    } catch (error) {
      await this.prisma.paymentIntent.update({ where: { id: intent.id }, data: { status: "FAILED", failureCode: "GATEWAY_ERROR" } }).catch(() => undefined);
      throw error;
    }
  }

  async refreshPaymentIntent(principal: AuthPrincipal, intentId: string) {
    const intent = await this.prisma.paymentIntent.findUnique({ where: { id: intentId } });
    if (!intent) throw new NotFoundException("Payment intent not found.");
    await this.requirePaymentIntentAccess(principal, intent.patientId);
    if (intent.status === "SUCCEEDED" || intent.status === "FAILED" || intent.status === "CANCELLED") return this.presentIntent(intent);
    if (!intent.gatewayIntentRef) throw new ConflictException("Payment intent has no gateway reference yet.");
    const gateway = await this.payments.retrieveIntent(intent.gatewayIntentRef);
    if (gateway.status === "SUCCEEDED") {
      const settled = await this.settleSuccessfulPayment(intent.id, gateway.reference);
      return { ...this.presentIntent(settled.intent), receipt: settled.receipt };
    }
    const updated = await this.prisma.paymentIntent.update({ where: { id: intent.id }, data: { status: gateway.status, failureCode: gateway.failureCode ?? null } });
    return { ...this.presentIntent(updated), ...(gateway.actionUrl ? { actionUrl: gateway.actionUrl } : {}) };
  }

  async refundPayment(principal: AuthPrincipal, paymentIntentId: string, input: CreateRefundInput) {
    const intent = await this.prisma.paymentIntent.findUnique({ where: { id: paymentIntentId } });
    if (!intent || intent.status !== "SUCCEEDED" || !intent.gatewayIntentRef) throw new ConflictException("Only a settled payment can be refunded.");
    await this.requireRefundAuthority(principal, intent.providerId);
    const idempotencyKey = this.idempotencyKey(input.idempotencyKey);
    const duplicate = await this.prisma.paymentRefund.findUnique({ where: { idempotencyKey } });
    if (duplicate) {
      if (duplicate.paymentIntentId !== intent.id) throw new ConflictException("idempotencyKey is already in use.");
      return duplicate;
    }
    if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) throw new BadRequestException("amountMinor must be a positive integer.");
    const successful = await this.prisma.paymentRefund.findMany({ where: { paymentIntentId: intent.id, status: "SUCCEEDED" }, select: { amountMinor: true } });
    const refunded = successful.reduce((sum, item) => sum + item.amountMinor, 0);
    if (input.amountMinor > intent.amountMinor - refunded) throw new ConflictException("Refund exceeds the remaining refundable payment amount.");
    const reason = input.reason?.trim();
    if (reason && reason.length > 500) throw new BadRequestException("reason cannot exceed 500 characters.");

    const refund = await this.prisma.paymentRefund.create({
      data: {
        invoiceId: intent.invoiceId,
        paymentIntentId: intent.id,
        providerId: intent.providerId,
        amountMinor: input.amountMinor,
        currency: intent.currency,
        ...(reason ? { reason } : {}),
        idempotencyKey,
        status: "PENDING",
      },
    });
    const gateway = await this.payments.refund({
      idempotencyKey,
      paymentReference: intent.gatewayIntentRef,
      amountMinor: refund.amountMinor,
      currency: refund.currency,
      ...(reason ? { reason } : {}),
    });
    if (gateway.status === "SUCCEEDED") {
      const settled = await this.settleSuccessfulRefund(refund.id, gateway.reference);
      await this.audit.write({ actorId: principal.accountId, action: "PAYMENT_REFUNDED", objectType: "PAYMENT_REFUND", objectId: refund.id, result: "SUCCESS", metadata: { paymentIntentId: intent.id, amountMinor: refund.amountMinor } });
      return settled;
    }
    const updated = await this.prisma.paymentRefund.update({ where: { id: refund.id }, data: { gatewayRefundRef: gateway.reference, status: gateway.status } });
    return updated;
  }

  async providerSummary(principal: AuthPrincipal) {
    const provider = await this.requireActiveProvider(principal);
    const entries = await this.prisma.providerLedgerEntry.findMany({ where: { providerId: provider.id }, orderBy: { createdAt: "desc" }, take: 5000 });
    const balances: Record<string, number> = {};
    for (const entry of entries) balances[entry.currency] = (balances[entry.currency] ?? 0) + entry.amountMinor;
    const pendingPayouts = await this.prisma.providerPayout.findMany({ where: { providerId: provider.id, status: { in: ["PENDING", "PROCESSING"] } }, orderBy: { createdAt: "desc" }, take: 100 });
    return { providerId: provider.id, availableBalanceMinorByCurrency: balances, pendingPayouts };
  }

  async providerLedger(principal: AuthPrincipal) {
    const provider = await this.requireActiveProvider(principal);
    return this.prisma.providerLedgerEntry.findMany({ where: { providerId: provider.id }, orderBy: { createdAt: "desc" }, take: 500 });
  }

  async providerAppointmentFinance(principal: AuthPrincipal, appointmentId: string) {
    const provider = await this.requireActiveProvider(principal);
    const appointment = await this.prisma.appointment.findUnique({ where: { id: appointmentId } });
    if (!appointment || appointment.providerId !== provider.id) throw new NotFoundException("Appointment not found.");
    const [snapshot, invoice, eligibility, priorAuthorizations] = await Promise.all([
      this.prisma.pricingSnapshot.findUnique({ where: { appointmentId } }),
      this.prisma.invoice.findUnique({ where: { appointmentId } }),
      this.prisma.insuranceEligibilityCheck.findMany({ where: { appointmentId }, orderBy: { checkedAt: "desc" }, take: 20 }),
      this.prisma.priorAuthorization.findMany({ where: { appointmentId }, orderBy: { createdAt: "desc" }, take: 20 }),
    ]);
    return { appointmentId, pricingSnapshot: snapshot, invoice, eligibility, priorAuthorizations };
  }

  async createProviderPayout(principal: AuthPrincipal, input: CreateProviderPayoutInput) {
    if (!roleHasPermission(principal.role, "FINANCE_OPERATE")) throw new ForbiddenException("Finance operator permission is required.");
    const provider = await this.prisma.provider.findUnique({ where: { id: input.providerId } });
    if (!provider || provider.status !== "ACTIVE") throw new NotFoundException("Active provider not found.");
    const currency = this.currency(input.currency);
    if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) throw new BadRequestException("amountMinor must be a positive integer.");
    const idempotencyKey = this.idempotencyKey(input.idempotencyKey);
    const duplicate = await this.prisma.providerPayout.findUnique({ where: { idempotencyKey } });
    if (duplicate) return duplicate;
    const entries = await this.prisma.providerLedgerEntry.findMany({ where: { providerId: provider.id, currency }, select: { amountMinor: true } });
    const available = entries.reduce((sum, item) => sum + item.amountMinor, 0);
    if (input.amountMinor > available) throw new ConflictException("Payout exceeds the provider available balance.");
    const periodStart = input.periodStart ? this.dateTime(input.periodStart, "periodStart") : null;
    const periodEnd = input.periodEnd ? this.dateTime(input.periodEnd, "periodEnd") : null;
    if (periodStart && periodEnd && periodEnd < periodStart) throw new BadRequestException("periodEnd cannot be before periodStart.");
    const payout = await this.prisma.providerPayout.create({
      data: {
        providerId: provider.id,
        amountMinor: input.amountMinor,
        currency,
        idempotencyKey,
        gateway: this.payments.name(),
        ...(periodStart ? { periodStart } : {}),
        ...(periodEnd ? { periodEnd } : {}),
      },
    });
    const gateway = await this.payments.payout({ idempotencyKey, providerId: provider.id, amountMinor: payout.amountMinor, currency });
    if (gateway.status === "PAID") {
      const settled = await this.settlePaidPayout(payout.id, gateway.reference);
      await this.audit.write({ actorId: principal.accountId, action: "PROVIDER_PAYOUT_PAID", objectType: "PROVIDER_PAYOUT", objectId: payout.id, result: "SUCCESS", metadata: { providerId: provider.id, amountMinor: payout.amountMinor, currency } });
      return settled;
    }
    return this.prisma.providerPayout.update({ where: { id: payout.id }, data: { gatewayPayoutRef: gateway.reference, status: gateway.status } });
  }

  async listPatientCoverages(principal: AuthPrincipal) {
    const patient = await this.requirePatient(principal);
    return this.prisma.insuranceCoverage.findMany({ where: { patientId: patient.id }, orderBy: { createdAt: "desc" }, take: 100 });
  }

  async createPatientCoverage(principal: AuthPrincipal, input: CreateInsuranceCoverageInput) {
    const patient = await this.requirePatient(principal);
    const payerCode = this.requiredText(input.payerCode, 80, "payerCode").toUpperCase();
    const payerName = this.requiredText(input.payerName, 200, "payerName");
    const externalPolicyRef = this.requiredText(input.externalPolicyRef, 300, "externalPolicyRef");
    const displayLabel = input.displayLabel?.trim();
    if (displayLabel && displayLabel.length > 160) throw new BadRequestException("displayLabel cannot exceed 160 characters.");
    const effectiveFrom = input.effectiveFrom ? this.dateOnly(input.effectiveFrom, "effectiveFrom") : null;
    const effectiveUntil = input.effectiveUntil ? this.dateOnly(input.effectiveUntil, "effectiveUntil") : null;
    if (effectiveFrom && effectiveUntil && effectiveUntil < effectiveFrom) throw new BadRequestException("effectiveUntil cannot be before effectiveFrom.");
    const coverage = await this.prisma.insuranceCoverage.create({
      data: {
        patientId: patient.id,
        payerCode,
        payerName,
        externalPolicyRef,
        ...(displayLabel ? { displayLabel } : {}),
        ...(effectiveFrom ? { effectiveFrom } : {}),
        ...(effectiveUntil ? { effectiveUntil } : {}),
      },
    });
    await this.audit.write({ actorId: principal.accountId, action: "INSURANCE_COVERAGE_ADDED", objectType: "INSURANCE_COVERAGE", objectId: coverage.id, result: "SUCCESS", metadata: { payerCode } });
    return this.presentCoverage(coverage);
  }

  async deactivatePatientCoverage(principal: AuthPrincipal, coverageId: string) {
    const patient = await this.requirePatient(principal);
    const coverage = await this.prisma.insuranceCoverage.findUnique({ where: { id: coverageId } });
    if (!coverage || coverage.patientId !== patient.id) throw new NotFoundException("Insurance coverage not found.");
    const updated = await this.prisma.insuranceCoverage.update({ where: { id: coverage.id }, data: { status: "INACTIVE" } });
    return this.presentCoverage(updated);
  }

  async insuranceActivity(principal: AuthPrincipal) {
    const patient = await this.requirePatient(principal);
    const [eligibility, priorAuthorizations] = await Promise.all([
      this.prisma.insuranceEligibilityCheck.findMany({ where: { patientId: patient.id }, orderBy: { checkedAt: "desc" }, take: 100 }),
      this.prisma.priorAuthorization.findMany({ where: { patientId: patient.id }, orderBy: { createdAt: "desc" }, take: 100 }),
    ]);
    return { patientId: patient.id, eligibility, priorAuthorizations };
  }

  async checkEligibility(principal: AuthPrincipal, appointmentId: string, input: InsuranceEligibilityInput) {
    const appointment = await this.requireAppointmentFinancialAccess(principal, appointmentId, true);
    const invoice = await this.prisma.invoice.findUnique({ where: { appointmentId } });
    const snapshot = await this.prisma.pricingSnapshot.findUnique({ where: { appointmentId } });
    if (!invoice || !snapshot) throw new ConflictException("This appointment does not have a Slice 6 pricing snapshot.");
    if (invoice.amountPaidMinor > 0) throw new ConflictException("Insurance responsibility cannot be recalculated after patient payment has started.");
    const coverage = await this.requireCoverageForPatient(input.coverageId, appointment.patientId);
    this.assertCoverageEffective(coverage);
    const idempotencyKey = this.idempotencyKey(input.idempotencyKey);
    const duplicate = await this.prisma.insuranceEligibilityCheck.findUnique({ where: { idempotencyKey } });
    if (duplicate) {
      if (duplicate.appointmentId !== appointment.id || duplicate.coverageId !== coverage.id) throw new ConflictException("idempotencyKey is already in use.");
      return duplicate;
    }
    const gateway = await this.insurance.checkEligibility({
      idempotencyKey,
      payerCode: coverage.payerCode,
      externalPolicyRef: coverage.externalPolicyRef,
      appointmentId: appointment.id,
      serviceId: appointment.serviceId,
      totalMinor: invoice.totalMinor,
      currency: invoice.currency,
    });
    if (gateway.status === "ELIGIBLE") {
      if (gateway.estimatedPatientMinor === undefined || gateway.estimatedInsurerMinor === undefined || gateway.estimatedPatientMinor + gateway.estimatedInsurerMinor !== invoice.totalMinor) {
        throw new BadGatewayException("Eligible insurance response must allocate the full invoice total.");
      }
    }
    const check = await this.prisma.insuranceEligibilityCheck.create({
      data: {
        appointmentId: appointment.id,
        coverageId: coverage.id,
        patientId: appointment.patientId,
        providerId: appointment.providerId,
        idempotencyKey,
        gateway: gateway.gateway,
        gatewayReference: gateway.reference,
        status: gateway.status,
        ...(gateway.estimatedPatientMinor !== undefined ? { estimatedPatientMinor: gateway.estimatedPatientMinor } : {}),
        ...(gateway.estimatedInsurerMinor !== undefined ? { estimatedInsurerMinor: gateway.estimatedInsurerMinor } : {}),
        ...(gateway.expiresAt ? { expiresAt: gateway.expiresAt } : {}),
      },
    });
    if (gateway.status === "ELIGIBLE") {
      await this.prisma.invoice.update({
        where: { id: invoice.id },
        data: {
          patientResponsibilityMinor: gateway.estimatedPatientMinor!,
          insurerResponsibilityMinor: gateway.estimatedInsurerMinor!,
          balanceDueMinor: gateway.estimatedPatientMinor!,
          status: gateway.estimatedPatientMinor === 0 ? "PAID" : "OPEN",
        },
      });
    }
    await this.audit.write({ actorId: principal.accountId, action: "INSURANCE_ELIGIBILITY_CHECKED", objectType: "INSURANCE_ELIGIBILITY", objectId: check.id, result: "SUCCESS", metadata: { appointmentId, status: check.status, payerCode: coverage.payerCode } });
    return check;
  }

  async requestPriorAuthorization(principal: AuthPrincipal, appointmentId: string, input: PriorAuthorizationInput) {
    if (principal.role === "PATIENT") throw new ForbiddenException("Prior authorization is submitted by the treating provider or finance operator.");
    const appointment = await this.requireAppointmentFinancialAccess(principal, appointmentId, false);
    const invoice = await this.prisma.invoice.findUnique({ where: { appointmentId } });
    if (!invoice) throw new ConflictException("This appointment does not have a Slice 6 invoice.");
    const coverage = await this.requireCoverageForPatient(input.coverageId, appointment.patientId);
    this.assertCoverageEffective(coverage);
    const idempotencyKey = this.idempotencyKey(input.idempotencyKey);
    const duplicate = await this.prisma.priorAuthorization.findUnique({ where: { idempotencyKey } });
    if (duplicate) {
      if (duplicate.appointmentId !== appointment.id || duplicate.coverageId !== coverage.id) throw new ConflictException("idempotencyKey is already in use.");
      return duplicate;
    }
    let eligibilityReference: string | undefined;
    if (input.eligibilityCheckId) {
      const eligibility = await this.prisma.insuranceEligibilityCheck.findUnique({ where: { id: input.eligibilityCheckId } });
      if (!eligibility || eligibility.appointmentId !== appointment.id || eligibility.coverageId !== coverage.id) throw new BadRequestException("eligibilityCheckId does not match this appointment and coverage.");
      eligibilityReference = eligibility.gatewayReference ?? undefined;
    }
    const gateway = await this.insurance.requestPriorAuthorization({
      idempotencyKey,
      payerCode: coverage.payerCode,
      externalPolicyRef: coverage.externalPolicyRef,
      appointmentId: appointment.id,
      serviceId: appointment.serviceId,
      totalMinor: invoice.totalMinor,
      currency: invoice.currency,
      ...(eligibilityReference ? { eligibilityReference } : {}),
    });
    const authorization = await this.prisma.priorAuthorization.create({
      data: {
        appointmentId: appointment.id,
        coverageId: coverage.id,
        patientId: appointment.patientId,
        providerId: appointment.providerId,
        ...(input.eligibilityCheckId ? { eligibilityCheckId: input.eligibilityCheckId } : {}),
        idempotencyKey,
        gateway: gateway.gateway,
        gatewayReference: gateway.reference,
        status: gateway.status,
        ...(gateway.approvedAmountMinor !== undefined ? { approvedAmountMinor: gateway.approvedAmountMinor } : {}),
        ...(gateway.validUntil ? { validUntil: gateway.validUntil } : {}),
      },
    });
    await this.audit.write({ actorId: principal.accountId, action: "INSURANCE_PRIOR_AUTH_REQUESTED", objectType: "PRIOR_AUTHORIZATION", objectId: authorization.id, result: "SUCCESS", metadata: { appointmentId, status: authorization.status, payerCode: coverage.payerCode } });
    return authorization;
  }

  private async settleSuccessfulPayment(intentId: string, gatewayReference: string) {
    for (let attempt = 1; attempt <= FINANCIAL_RETRIES; attempt += 1) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const intent = await tx.paymentIntent.findUnique({ where: { id: intentId } });
          if (!intent) throw new NotFoundException("Payment intent not found.");
          const existingReceipt = await tx.paymentReceipt.findUnique({ where: { paymentIntentId: intent.id } });
          if (existingReceipt) return { intent, receipt: existingReceipt };
          const claim = await tx.paymentIntent.updateMany({
            where: { id: intent.id, status: { not: "SUCCEEDED" } },
            data: { status: "SUCCEEDED", gatewayIntentRef: gatewayReference, succeededAt: new Date(), failureCode: null },
          });
          if (claim.count !== 1) {
            const receipt = await tx.paymentReceipt.findUnique({ where: { paymentIntentId: intent.id } });
            if (!receipt) throw new ConflictException("Payment settlement is already being processed.");
            return { intent: await tx.paymentIntent.findUniqueOrThrow({ where: { id: intent.id } }), receipt };
          }
          const invoice = await tx.invoice.findUnique({ where: { id: intent.invoiceId } });
          if (!invoice || invoice.status === "VOID" || invoice.status === "REFUNDED") throw new ConflictException("Invoice cannot be settled.");
          const nextPaid = invoice.amountPaidMinor + intent.amountMinor;
          if (nextPaid > invoice.patientResponsibilityMinor) throw new ConflictException("Payment exceeds patient responsibility.");
          const balanceDueMinor = Math.max(invoice.patientResponsibilityMinor - nextPaid, 0);
          await tx.invoice.update({ where: { id: invoice.id }, data: { amountPaidMinor: nextPaid, balanceDueMinor, status: balanceDueMinor === 0 ? "PAID" : "PARTIALLY_PAID" } });
          const receipt = await tx.paymentReceipt.create({
            data: {
              number: this.receiptNumber(intent.id),
              invoiceId: invoice.id,
              paymentIntentId: intent.id,
              patientId: intent.patientId,
              providerId: intent.providerId,
              amountMinor: intent.amountMinor,
              currency: intent.currency,
            },
          });
          await tx.providerLedgerEntry.create({
            data: {
              providerId: intent.providerId,
              invoiceId: invoice.id,
              paymentIntentId: intent.id,
              type: "CHARGE",
              amountMinor: intent.amountMinor,
              currency: intent.currency,
              reference: receipt.number,
            },
          });
          return { intent: await tx.paymentIntent.findUniqueOrThrow({ where: { id: intent.id } }), receipt };
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      } catch (error) {
        if (this.isPrismaError(error, "P2034") && attempt < FINANCIAL_RETRIES) continue;
        throw error;
      }
    }
    throw new ConflictException("Payment settlement could not complete because of concurrent financial activity.");
  }

  private async settleSuccessfulRefund(refundId: string, gatewayReference: string) {
    return this.prisma.$transaction(async (tx) => {
      const refund = await tx.paymentRefund.findUnique({ where: { id: refundId } });
      if (!refund) throw new NotFoundException("Refund not found.");
      if (refund.status === "SUCCEEDED") return refund;
      const claim = await tx.paymentRefund.updateMany({ where: { id: refund.id, status: "PENDING" }, data: { status: "SUCCEEDED", gatewayRefundRef: gatewayReference, succeededAt: new Date() } });
      if (claim.count !== 1) return tx.paymentRefund.findUniqueOrThrow({ where: { id: refund.id } });
      const invoice = await tx.invoice.findUniqueOrThrow({ where: { id: refund.invoiceId } });
      const amountRefundedMinor = invoice.amountRefundedMinor + refund.amountMinor;
      await tx.invoice.update({ where: { id: invoice.id }, data: { amountRefundedMinor, status: "REFUNDED" } });
      await tx.providerLedgerEntry.create({
        data: {
          providerId: refund.providerId,
          invoiceId: refund.invoiceId,
          paymentIntentId: refund.paymentIntentId,
          refundId: refund.id,
          type: "REFUND",
          amountMinor: -refund.amountMinor,
          currency: refund.currency,
          reference: gatewayReference,
        },
      });
      return tx.paymentRefund.findUniqueOrThrow({ where: { id: refund.id } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  private async settlePaidPayout(payoutId: string, gatewayReference: string) {
    return this.prisma.$transaction(async (tx) => {
      const payout = await tx.providerPayout.findUnique({ where: { id: payoutId } });
      if (!payout) throw new NotFoundException("Provider payout not found.");
      if (payout.status === "PAID") return payout;
      const claim = await tx.providerPayout.updateMany({ where: { id: payout.id, status: { in: ["PENDING", "PROCESSING"] } }, data: { status: "PAID", gatewayPayoutRef: gatewayReference, paidAt: new Date() } });
      if (claim.count !== 1) return tx.providerPayout.findUniqueOrThrow({ where: { id: payout.id } });
      await tx.providerLedgerEntry.create({
        data: {
          providerId: payout.providerId,
          payoutId: payout.id,
          type: "PAYOUT",
          amountMinor: -payout.amountMinor,
          currency: payout.currency,
          reference: gatewayReference,
        },
      });
      return tx.providerPayout.findUniqueOrThrow({ where: { id: payout.id } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
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

  private async requirePaymentIntentAccess(principal: AuthPrincipal, patientId: string) {
    if (principal.role === "PATIENT") {
      const patient = await this.requirePatient(principal);
      if (patient.id !== patientId) throw new ForbiddenException("Payment intent access denied.");
      return;
    }
    if (!roleHasPermission(principal.role, "FINANCE_OPERATE")) throw new ForbiddenException("Payment intent access denied.");
  }

  private async requireRefundAuthority(principal: AuthPrincipal, providerId: string) {
    if (roleHasPermission(principal.role, "FINANCE_OPERATE")) return;
    if (!roleHasPermission(principal.role, "PROVIDER_REFUND_PAYMENTS")) throw new ForbiddenException("Refund permission is required.");
    const provider = await this.requireActiveProvider(principal);
    if (provider.id !== providerId) throw new ForbiddenException("A provider can refund only its own payments.");
  }

  private async requireAppointmentFinancialAccess(principal: AuthPrincipal, appointmentId: string, patientAllowed: boolean) {
    const appointment = await this.prisma.appointment.findUnique({ where: { id: appointmentId }, include: { patient: { select: { userId: true } }, provider: { select: { userId: true } } } });
    if (!appointment) throw new NotFoundException("Appointment not found.");
    if (patientAllowed && principal.role === "PATIENT" && appointment.patient.userId === principal.accountId) return appointment;
    if ((principal.role === "DOCTOR" || principal.role === "OTHER_PROVIDER") && appointment.provider.userId === principal.accountId) return appointment;
    if (roleHasPermission(principal.role, "INSURANCE_OPERATE") || roleHasPermission(principal.role, "FINANCE_OPERATE")) return appointment;
    throw new ForbiddenException("Appointment financial access denied.");
  }

  private async requireCoverageForPatient(coverageId: string, patientId: string) {
    const coverage = await this.prisma.insuranceCoverage.findUnique({ where: { id: coverageId } });
    if (!coverage || coverage.patientId !== patientId) throw new NotFoundException("Insurance coverage not found.");
    return coverage;
  }

  private assertCoverageEffective(coverage: { status: string; effectiveFrom: Date | null; effectiveUntil: Date | null }) {
    if (coverage.status !== "ACTIVE") throw new ConflictException("Insurance coverage is not active.");
    const today = new Date();
    if (coverage.effectiveFrom && coverage.effectiveFrom.getTime() > today.getTime()) throw new ConflictException("Insurance coverage is not effective yet.");
    if (coverage.effectiveUntil && coverage.effectiveUntil.getTime() < today.getTime()) throw new ConflictException("Insurance coverage has expired.");
  }

  private presentCoverage<T extends { externalPolicyRef: string }>(coverage: T) {
    const { externalPolicyRef: _secret, ...safe } = coverage;
    return { ...safe, policyReferenceStoredExternally: true };
  }

  private presentIntent<T extends { id: string; invoiceId: string; amountMinor: number; currency: string; gateway: string; gatewayIntentRef: string | null; status: unknown; failureCode: string | null; createdAt: Date; updatedAt: Date; succeededAt: Date | null }>(intent: T) {
    return {
      id: intent.id,
      invoiceId: intent.invoiceId,
      amountMinor: intent.amountMinor,
      currency: intent.currency,
      gateway: intent.gateway,
      gatewayIntentRef: intent.gatewayIntentRef,
      status: intent.status,
      failureCode: intent.failureCode,
      createdAt: intent.createdAt,
      updatedAt: intent.updatedAt,
      succeededAt: intent.succeededAt,
    };
  }

  private idempotencyKey(value: string): string {
    const key = value?.trim();
    if (!key || key.length < 8 || key.length > 128) throw new BadRequestException("idempotencyKey must contain between 8 and 128 characters.");
    return key;
  }

  private currency(value: string): string {
    const currency = value?.trim().toUpperCase();
    if (!currency || !/^[A-Z]{3}$/.test(currency)) throw new BadRequestException("currency must be a 3-letter ISO code.");
    return currency;
  }

  private requiredText(value: string, max: number, field: string): string {
    const text = value?.trim();
    if (!text) throw new BadRequestException(`${field} is required.`);
    if (text.length > max) throw new BadRequestException(`${field} cannot exceed ${max} characters.`);
    return text;
  }

  private dateOnly(value: string, field: string): Date {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? "")) throw new BadRequestException(`${field} must use YYYY-MM-DD.`);
    const date = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new BadRequestException(`${field} is invalid.`);
    return date;
  }

  private dateTime(value: string, field: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new BadRequestException(`${field} must be a valid ISO date-time.`);
    return date;
  }

  private receiptNumber(intentId: string): string {
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    return `RCT-${date}-${intentId.replace(/-/g, "").slice(0, 10).toUpperCase()}`;
  }

  private isPrismaError(error: unknown, code: string): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;
  }
}
