import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  Post,
} from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import type { CreateProviderPayoutInput, CreateRefundInput, ReworkInsuranceClaimInput } from "@carepoint/contracts";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { CurrentPrincipal, RequirePermissions } from "../../security/api-security.module";
import { BillingModule } from "../billing/billing.module";
import { BillingService } from "../billing/billing.service";
import { ClaimsModule } from "../claims/claims.module";
import { ClaimsService } from "../claims/claims.service";

const OUTSTANDING_INVOICE_STATUSES = ["OPEN", "PARTIALLY_PAID"] as const;
const ACTIVE_PAYMENT_STATUSES = ["REQUIRES_ACTION", "PROCESSING", "FAILED", "SUCCEEDED"] as const;
const ACTIVE_CLAIM_STATUSES = ["SUBMITTED", "ACCEPTED", "PENDING", "ADJUDICATED", "DENIED"] as const;
const PAYOUT_QUEUE_STATUSES = ["PENDING", "PROCESSING", "FAILED"] as const;
const ACTIVE_PAYOUT_STATUSES = ["PENDING", "PROCESSING"] as const;
const MAX_QUEUE = 250;
const FINANCE_ACTIONS = ["REFRESH_PAYMENT", "REFUND_PAYMENT", "REFRESH_CLAIM", "REWORK_CLAIM", "CREATE_PAYOUT"] as const;

type FinanceAction = (typeof FINANCE_ACTIONS)[number];

type FinanceActionBody = {
  action?: string;
  resourceId?: string;
  idempotencyKey?: string;
  amountMinor?: number;
  reason?: string;
  reasonCode?: string;
  providerId?: string;
  currency?: string;
  periodStart?: string;
  periodEnd?: string;
};

@Injectable()
class AdminFinanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly billing: BillingService,
    private readonly claims: ClaimsService,
    private readonly audit: DatabaseAuditService,
  ) {}

  async workspace(principal: AuthPrincipal) {
    this.requireAdmin(principal);
    const generatedAt = new Date();

    const [invoices, paymentIntents, refunds, claims, payouts, activePayouts, ledgerBalances] = await Promise.all([
      this.prisma.invoice.findMany({
        where: { status: { in: [...OUTSTANDING_INVOICE_STATUSES] }, balanceDueMinor: { gt: 0 } },
        orderBy: [{ issuedAt: "asc" }, { id: "asc" }],
        take: MAX_QUEUE,
        select: {
          id: true,
          number: true,
          providerId: true,
          currency: true,
          totalMinor: true,
          patientResponsibilityMinor: true,
          insurerResponsibilityMinor: true,
          amountPaidMinor: true,
          amountRefundedMinor: true,
          balanceDueMinor: true,
          status: true,
          issuedAt: true,
          updatedAt: true,
        },
      }),
      this.prisma.paymentIntent.findMany({
        where: { status: { in: [...ACTIVE_PAYMENT_STATUSES] } },
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        take: MAX_QUEUE,
        select: {
          id: true,
          invoiceId: true,
          providerId: true,
          amountMinor: true,
          currency: true,
          status: true,
          failureCode: true,
          createdAt: true,
          updatedAt: true,
          succeededAt: true,
        },
      }),
      this.prisma.paymentRefund.findMany({
        where: { status: "SUCCEEDED" },
        orderBy: { createdAt: "desc" },
        take: 2000,
        select: { paymentIntentId: true, amountMinor: true },
      }),
      this.prisma.insuranceClaim.findMany({
        where: {
          OR: [
            { status: { in: [...ACTIVE_CLAIM_STATUSES] } },
            { reconciliationStatus: "REVIEW_REQUIRED" },
          ],
        },
        orderBy: [{ submittedAt: "asc" }, { version: "desc" }],
        take: MAX_QUEUE,
        select: {
          id: true,
          invoiceId: true,
          providerId: true,
          previousClaimId: true,
          version: true,
          status: true,
          reconciliationStatus: true,
          submittedAmountMinor: true,
          currency: true,
          allowedMinor: true,
          insurerPaidMinor: true,
          patientResponsibilityMinor: true,
          adjustmentMinor: true,
          denialCode: true,
          denialPublicMessage: true,
          reworkReasonCode: true,
          submittedAt: true,
          adjudicatedAt: true,
          paidAt: true,
        },
      }),
      this.prisma.providerPayout.findMany({
        where: { status: { in: [...PAYOUT_QUEUE_STATUSES] } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: MAX_QUEUE,
        select: {
          id: true,
          providerId: true,
          amountMinor: true,
          currency: true,
          status: true,
          periodStart: true,
          periodEnd: true,
          createdAt: true,
          updatedAt: true,
          paidAt: true,
        },
      }),
      this.prisma.providerPayout.findMany({
        where: { status: { in: [...ACTIVE_PAYOUT_STATUSES] } },
        select: { providerId: true, currency: true, amountMinor: true },
      }),
      this.prisma.providerLedgerEntry.groupBy({
        by: ["providerId", "currency"],
        _sum: { amountMinor: true },
      }),
    ]);

    const providerIds = new Set<string>();
    for (const row of invoices) providerIds.add(row.providerId);
    for (const row of paymentIntents) providerIds.add(row.providerId);
    for (const row of claims) providerIds.add(row.providerId);
    for (const row of payouts) providerIds.add(row.providerId);
    for (const row of ledgerBalances) providerIds.add(row.providerId);
    const providers = await this.prisma.provider.findMany({
      where: { id: { in: [...providerIds] } },
      select: { id: true, class: true, displayName: true, status: true },
      orderBy: [{ displayName: "asc" }, { id: "asc" }],
    });
    const providerMap = new Map(providers.map((provider) => [provider.id, provider]));

    const refundedByIntent = new Map<string, number>();
    for (const refund of refunds) refundedByIntent.set(refund.paymentIntentId, (refundedByIntent.get(refund.paymentIntentId) ?? 0) + refund.amountMinor);
    const committedPayoutByProviderCurrency = new Map<string, number>();
    for (const payout of activePayouts) {
      const key = `${payout.providerId}:${payout.currency}`;
      committedPayoutByProviderCurrency.set(key, (committedPayoutByProviderCurrency.get(key) ?? 0) + payout.amountMinor);
    }

    const paymentItems = paymentIntents.map((intent) => {
      const refundedMinor = refundedByIntent.get(intent.id) ?? 0;
      return {
        paymentIntentId: intent.id,
        invoiceId: intent.invoiceId,
        provider: this.provider(providerMap, intent.providerId),
        amountMinor: intent.amountMinor,
        refundedMinor,
        refundableMinor: intent.status === "SUCCEEDED" ? Math.max(0, intent.amountMinor - refundedMinor) : 0,
        currency: intent.currency,
        status: intent.status,
        failureCode: intent.failureCode,
        createdAt: intent.createdAt.toISOString(),
        updatedAt: intent.updatedAt.toISOString(),
        succeededAt: intent.succeededAt?.toISOString() ?? null,
      };
    });

    const payoutCapacity = ledgerBalances
      .map((balance) => {
        const gross = balance._sum.amountMinor ?? 0;
        const committedMinor = committedPayoutByProviderCurrency.get(`${balance.providerId}:${balance.currency}`) ?? 0;
        return {
          provider: this.provider(providerMap, balance.providerId),
          currency: balance.currency,
          ledgerBalanceMinor: gross,
          committedPayoutMinor: committedMinor,
          availableForPayoutMinor: Math.max(0, gross - committedMinor),
        };
      })
      .filter((item) => item.availableForPayoutMinor > 0 && item.provider.status === "ACTIVE")
      .sort((left, right) => left.provider.displayName.localeCompare(right.provider.displayName) || left.currency.localeCompare(right.currency));

    return {
      generatedAt: generatedAt.toISOString(),
      privacy: {
        phiNeutral: true,
        patientIdentityExcluded: true,
        policyIdentifiersExcluded: true,
        gatewayReferencesExcluded: true,
        clinicalContentExcluded: true,
      },
      summary: {
        outstandingInvoices: this.moneySummary(invoices.map((item) => ({ currency: item.currency, amountMinor: item.balanceDueMinor }))),
        refundablePayments: this.moneySummary(paymentItems.filter((item) => item.refundableMinor > 0).map((item) => ({ currency: item.currency, amountMinor: item.refundableMinor }))),
        pendingPayouts: this.moneySummary(activePayouts.map((item) => ({ currency: item.currency, amountMinor: item.amountMinor }))),
        claimsInFlight: claims.filter((claim) => claim.status !== "DENIED").length,
        claimsAttention: claims.filter((claim) => claim.status === "DENIED" || claim.reconciliationStatus === "REVIEW_REQUIRED").length,
      },
      queues: {
        invoices: invoices.map((invoice) => ({
          invoiceId: invoice.id,
          number: invoice.number,
          provider: this.provider(providerMap, invoice.providerId),
          currency: invoice.currency,
          totalMinor: invoice.totalMinor,
          patientResponsibilityMinor: invoice.patientResponsibilityMinor,
          insurerResponsibilityMinor: invoice.insurerResponsibilityMinor,
          amountPaidMinor: invoice.amountPaidMinor,
          amountRefundedMinor: invoice.amountRefundedMinor,
          balanceDueMinor: invoice.balanceDueMinor,
          status: invoice.status,
          issuedAt: invoice.issuedAt.toISOString(),
          updatedAt: invoice.updatedAt.toISOString(),
        })),
        paymentIntents: paymentItems,
        claims: claims.map((claim) => ({
          claimId: claim.id,
          invoiceId: claim.invoiceId,
          provider: this.provider(providerMap, claim.providerId),
          previousClaimId: claim.previousClaimId,
          version: claim.version,
          status: claim.status,
          reconciliationStatus: claim.reconciliationStatus,
          submittedAmountMinor: claim.submittedAmountMinor,
          currency: claim.currency,
          allowedMinor: claim.allowedMinor,
          insurerPaidMinor: claim.insurerPaidMinor,
          patientResponsibilityMinor: claim.patientResponsibilityMinor,
          adjustmentMinor: claim.adjustmentMinor,
          denialCode: claim.denialCode,
          denialPublicMessage: claim.denialPublicMessage,
          reworkReasonCode: claim.reworkReasonCode,
          submittedAt: claim.submittedAt.toISOString(),
          adjudicatedAt: claim.adjudicatedAt?.toISOString() ?? null,
          paidAt: claim.paidAt?.toISOString() ?? null,
        })),
        payouts: payouts.map((payout) => ({
          payoutId: payout.id,
          provider: this.provider(providerMap, payout.providerId),
          amountMinor: payout.amountMinor,
          currency: payout.currency,
          status: payout.status,
          periodStart: payout.periodStart?.toISOString() ?? null,
          periodEnd: payout.periodEnd?.toISOString() ?? null,
          createdAt: payout.createdAt.toISOString(),
          updatedAt: payout.updatedAt.toISOString(),
          paidAt: payout.paidAt?.toISOString() ?? null,
        })),
        payoutCapacity,
      },
    };
  }

  async act(principal: AuthPrincipal, body: FinanceActionBody) {
    this.requireAdmin(principal);
    const action = this.action(body.action);

    if (action === "REFRESH_PAYMENT") {
      const resourceId = this.identifier(body.resourceId, "resourceId");
      await this.billing.refreshPaymentIntent(principal, resourceId);
      const row = await this.prisma.paymentIntent.findUniqueOrThrow({ where: { id: resourceId }, select: { id: true, invoiceId: true, status: true, updatedAt: true } });
      await this.adminAudit(principal, action, "PAYMENT_INTENT", row.id, { invoiceId: row.invoiceId, status: row.status });
      return { action, paymentIntentId: row.id, invoiceId: row.invoiceId, status: row.status, updatedAt: row.updatedAt.toISOString() };
    }

    if (action === "REFUND_PAYMENT") {
      const resourceId = this.identifier(body.resourceId, "resourceId");
      const input: CreateRefundInput = {
        idempotencyKey: this.identifier(body.idempotencyKey, "idempotencyKey"),
        amountMinor: this.money(body.amountMinor, "amountMinor"),
        ...(body.reason?.trim() ? { reason: body.reason.trim() } : {}),
      };
      const refund = await this.billing.refundPayment(principal, resourceId, input);
      const row = await this.prisma.paymentRefund.findUniqueOrThrow({ where: { id: refund.id }, select: { id: true, paymentIntentId: true, invoiceId: true, amountMinor: true, currency: true, status: true } });
      await this.adminAudit(principal, action, "PAYMENT_REFUND", row.id, { paymentIntentId: row.paymentIntentId, invoiceId: row.invoiceId, amountMinor: row.amountMinor, currency: row.currency, status: row.status });
      return { action, refundId: row.id, paymentIntentId: row.paymentIntentId, invoiceId: row.invoiceId, amountMinor: row.amountMinor, currency: row.currency, status: row.status };
    }

    if (action === "REFRESH_CLAIM") {
      const resourceId = this.identifier(body.resourceId, "resourceId");
      await this.claims.refreshClaim(principal, resourceId);
      const row = await this.safeClaim(resourceId);
      await this.adminAudit(principal, action, "INSURANCE_CLAIM", row.claimId, { invoiceId: row.invoiceId, status: row.status, reconciliationStatus: row.reconciliationStatus });
      return { action, ...row };
    }

    if (action === "REWORK_CLAIM") {
      const resourceId = this.identifier(body.resourceId, "resourceId");
      const input: ReworkInsuranceClaimInput = {
        idempotencyKey: this.identifier(body.idempotencyKey, "idempotencyKey"),
        reasonCode: this.identifier(body.reasonCode, "reasonCode"),
      };
      const replacement = await this.claims.reworkClaim(principal, resourceId, input);
      const row = await this.safeClaim(replacement.id);
      await this.adminAudit(principal, action, "INSURANCE_CLAIM", row.claimId, { originalClaimId: resourceId, invoiceId: row.invoiceId, version: row.version, status: row.status });
      return { action, originalClaimId: resourceId, ...row };
    }

    const input: CreateProviderPayoutInput = {
      providerId: this.identifier(body.providerId, "providerId"),
      amountMinor: this.money(body.amountMinor, "amountMinor"),
      currency: this.currency(body.currency),
      idempotencyKey: this.identifier(body.idempotencyKey, "idempotencyKey"),
      ...(body.periodStart?.trim() ? { periodStart: body.periodStart.trim() } : {}),
      ...(body.periodEnd?.trim() ? { periodEnd: body.periodEnd.trim() } : {}),
    };
    const payout = await this.billing.createProviderPayout(principal, input);
    const row = await this.prisma.providerPayout.findUniqueOrThrow({ where: { id: payout.id }, select: { id: true, providerId: true, amountMinor: true, currency: true, status: true, paidAt: true } });
    await this.adminAudit(principal, action, "PROVIDER_PAYOUT", row.id, { providerId: row.providerId, amountMinor: row.amountMinor, currency: row.currency, status: row.status });
    return { action, payoutId: row.id, providerId: row.providerId, amountMinor: row.amountMinor, currency: row.currency, status: row.status, paidAt: row.paidAt?.toISOString() ?? null };
  }

  private async safeClaim(claimId: string) {
    const row = await this.prisma.insuranceClaim.findUniqueOrThrow({
      where: { id: claimId },
      select: { id: true, invoiceId: true, previousClaimId: true, version: true, status: true, reconciliationStatus: true, submittedAmountMinor: true, currency: true, denialCode: true },
    });
    return {
      claimId: row.id,
      invoiceId: row.invoiceId,
      previousClaimId: row.previousClaimId,
      version: row.version,
      status: row.status,
      reconciliationStatus: row.reconciliationStatus,
      submittedAmountMinor: row.submittedAmountMinor,
      currency: row.currency,
      denialCode: row.denialCode,
    };
  }

  private provider(map: Map<string, { id: string; class: string; displayName: string; status: string }>, providerId: string) {
    return map.get(providerId) ?? { id: providerId, class: "UNKNOWN", displayName: "Unavailable provider", status: "UNAVAILABLE" };
  }

  private moneySummary(items: { currency: string; amountMinor: number }[]) {
    const totals = new Map<string, { count: number; amountMinor: number }>();
    for (const item of items) {
      const current = totals.get(item.currency) ?? { count: 0, amountMinor: 0 };
      current.count += 1;
      current.amountMinor += item.amountMinor;
      totals.set(item.currency, current);
    }
    return [...totals.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([currency, value]) => ({ currency, ...value }));
  }

  private async adminAudit(principal: AuthPrincipal, action: FinanceAction, objectType: string, objectId: string, metadata: Record<string, unknown>) {
    await this.audit.write({ actorId: principal.accountId, action: `ADMIN_FINANCE_${action}`, objectType, objectId, purpose: "FINANCIAL_OPERATIONS", result: "SUCCESS", metadata });
  }

  private action(value?: string): FinanceAction {
    const normalized = value?.trim().toUpperCase() ?? "";
    if (!(FINANCE_ACTIONS as readonly string[]).includes(normalized)) throw new BadRequestException("Unsupported finance action.");
    return normalized as FinanceAction;
  }

  private identifier(value: string | undefined, field: string): string {
    const cleaned = value?.trim();
    if (!cleaned) throw new BadRequestException(`${field} is required.`);
    if (cleaned.length > 500) throw new BadRequestException(`${field} is too long.`);
    return cleaned;
  }

  private money(value: number | undefined, field: string): number {
    if (!Number.isInteger(value) || (value ?? 0) <= 0) throw new BadRequestException(`${field} must be a positive integer.`);
    return value as number;
  }

  private currency(value?: string): string {
    const normalized = value?.trim().toUpperCase() ?? "";
    if (!/^[A-Z]{3}$/.test(normalized)) throw new BadRequestException("currency must be a 3-letter ISO code.");
    return normalized;
  }

  private requireAdmin(principal: AuthPrincipal) {
    if (principal.role !== "ADMIN") throw new ForbiddenException("Administrator financial operations access is required.");
  }
}

@Controller("admin/finance")
class AdminFinanceController {
  constructor(private readonly finance: AdminFinanceService) {}

  @RequirePermissions("FINANCE_OPERATE", "REVENUE_CYCLE_OPERATE")
  @Get("workspace")
  workspace(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.finance.workspace(principal);
  }

  @RequirePermissions("FINANCE_OPERATE", "REVENUE_CYCLE_OPERATE")
  @Post("actions")
  action(@CurrentPrincipal() principal: AuthPrincipal, @Body() body: FinanceActionBody) {
    return this.finance.act(principal, body);
  }
}

@Module({
  imports: [BillingModule, ClaimsModule],
  controllers: [AdminFinanceController],
  providers: [AdminFinanceService],
})
export class AdminFinanceModule {}
