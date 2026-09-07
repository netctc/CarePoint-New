import { Body, Controller, Get, Module, Param, Post } from "@nestjs/common";
import type {
  CreateInsuranceCoverageInput,
  CreatePaymentIntentInput,
  CreateProviderPayoutInput,
  CreateRefundInput,
  InsuranceEligibilityInput,
  PriorAuthorizationInput,
} from "@carepoint/contracts";
import type { AuthPrincipal } from "@carepoint/identity";
import { CurrentPrincipal, RequirePermissions } from "../../security/api-security.module";
import { BillingIdempotencyService } from "./billing-idempotency.service";
import { BillingService } from "./billing.service";
import { PaymentGatewayService } from "./payment-gateway.service";
import { InsuranceGatewayService } from "./insurance-gateway.service";
import { InsurancePresentationService } from "./insurance-presentation.service";

@Controller("billing")
class PatientBillingController {
  constructor(
    private readonly billing: BillingService,
    private readonly idempotency: BillingIdempotencyService,
  ) {}

  @RequirePermissions("PATIENT_MANAGE_BILLING")
  @Get("me")
  mine(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.billing.patientBilling(principal);
  }

  @RequirePermissions("PATIENT_MANAGE_BILLING")
  @Post("invoices/:invoiceId/payment-intents")
  createIntent(@CurrentPrincipal() principal: AuthPrincipal, @Param("invoiceId") invoiceId: string, @Body() body: CreatePaymentIntentInput) {
    return this.idempotency.createPaymentIntent(principal, invoiceId, body);
  }

  @RequirePermissions("PATIENT_MANAGE_BILLING", "FINANCE_OPERATE")
  @Post("payment-intents/:intentId/refresh")
  refreshIntent(@CurrentPrincipal() principal: AuthPrincipal, @Param("intentId") intentId: string) {
    return this.billing.refreshPaymentIntent(principal, intentId);
  }
}

@Controller("insurance")
class InsuranceController {
  constructor(
    private readonly billing: BillingService,
    private readonly presentation: InsurancePresentationService,
  ) {}

  @RequirePermissions("PATIENT_MANAGE_INSURANCE")
  @Get("me/coverages")
  coverages(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.presentation.listPatientCoverages(principal);
  }

  @RequirePermissions("PATIENT_MANAGE_INSURANCE")
  @Post("me/coverages")
  createCoverage(@CurrentPrincipal() principal: AuthPrincipal, @Body() body: CreateInsuranceCoverageInput) {
    return this.billing.createPatientCoverage(principal, body);
  }

  @RequirePermissions("PATIENT_MANAGE_INSURANCE")
  @Post("me/coverages/:coverageId/deactivate")
  deactivateCoverage(@CurrentPrincipal() principal: AuthPrincipal, @Param("coverageId") coverageId: string) {
    return this.billing.deactivatePatientCoverage(principal, coverageId);
  }

  @RequirePermissions("PATIENT_MANAGE_INSURANCE")
  @Get("me/activity")
  activity(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.billing.insuranceActivity(principal);
  }

  @RequirePermissions("INSURANCE_CHECK", "INSURANCE_OPERATE")
  @Post("appointments/:appointmentId/eligibility")
  eligibility(@CurrentPrincipal() principal: AuthPrincipal, @Param("appointmentId") appointmentId: string, @Body() body: InsuranceEligibilityInput) {
    return this.billing.checkEligibility(principal, appointmentId, body);
  }

  @RequirePermissions("INSURANCE_OPERATE")
  @Post("appointments/:appointmentId/prior-authorization")
  priorAuthorization(@CurrentPrincipal() principal: AuthPrincipal, @Param("appointmentId") appointmentId: string, @Body() body: PriorAuthorizationInput) {
    return this.billing.requestPriorAuthorization(principal, appointmentId, body);
  }
}

@Controller("provider/finance")
class ProviderFinanceController {
  constructor(private readonly billing: BillingService) {}

  @RequirePermissions("PROVIDER_READ_FINANCIALS")
  @Get("summary")
  summary(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.billing.providerSummary(principal);
  }

  @RequirePermissions("PROVIDER_READ_FINANCIALS")
  @Get("ledger")
  ledger(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.billing.providerLedger(principal);
  }

  @RequirePermissions("PROVIDER_READ_FINANCIALS")
  @Get("appointments/:appointmentId")
  appointment(@CurrentPrincipal() principal: AuthPrincipal, @Param("appointmentId") appointmentId: string) {
    return this.billing.providerAppointmentFinance(principal, appointmentId);
  }

  @RequirePermissions("PROVIDER_REFUND_PAYMENTS")
  @Post("payment-intents/:intentId/refunds")
  refund(@CurrentPrincipal() principal: AuthPrincipal, @Param("intentId") intentId: string, @Body() body: CreateRefundInput) {
    return this.billing.refundPayment(principal, intentId, body);
  }
}

@Controller("finance")
class FinanceOperationsController {
  constructor(private readonly billing: BillingService) {}

  @RequirePermissions("FINANCE_OPERATE")
  @Post("payment-intents/:intentId/refunds")
  refund(@CurrentPrincipal() principal: AuthPrincipal, @Param("intentId") intentId: string, @Body() body: CreateRefundInput) {
    return this.billing.refundPayment(principal, intentId, body);
  }

  @RequirePermissions("FINANCE_OPERATE")
  @Post("payouts")
  payout(@CurrentPrincipal() principal: AuthPrincipal, @Body() body: CreateProviderPayoutInput) {
    return this.billing.createProviderPayout(principal, body);
  }
}

@Module({
  controllers: [PatientBillingController, InsuranceController, ProviderFinanceController, FinanceOperationsController],
  providers: [BillingService, BillingIdempotencyService, InsurancePresentationService, PaymentGatewayService, InsuranceGatewayService],
  exports: [BillingService],
})
export class BillingModule {}
