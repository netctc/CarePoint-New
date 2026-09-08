import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  Query,
} from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { CurrentPrincipal } from "../../security/api-security.module";

const PERIOD_DAYS = [7, 30, 90] as const;
const TELEHEALTH_STATUSES = ["WAITING", "READY", "ACTIVE", "ENDED", "CANCELLED"] as const;
const SECURITY_ACTIONS = [
  "LOGIN_FAILED",
  "LOGIN_SUCCEEDED",
  "MFA_CHALLENGE_ISSUED",
  "MFA_CHALLENGE_VERIFIED",
  "MFA_CHALLENGE_REPLAY_DENIED",
  "MFA_ENROLLMENT_STARTED",
  "MFA_ENABLED",
  "REFRESH_TOKEN_REPLAY_DENIED",
  "SESSION_ROTATED",
  "SESSION_REVOKED",
  "ALL_SESSIONS_REVOKED",
  "ACCOUNT_SUSPENDED",
  "AUTHORIZATION_DENIED",
] as const;
const REPLAY_ACTIONS = ["MFA_CHALLENGE_REPLAY_DENIED", "REFRESH_TOKEN_REPLAY_DENIED"] as const;
const REVIEW_ONBOARDING_STATES = ["PENDING_REVIEW", "REQUEST_CHANGES"] as const;

type PeriodDays = (typeof PERIOD_DAYS)[number];
type Period = { from: Date; to: Date };
type FavorableDirection = "HIGHER" | "LOWER" | "NEUTRAL";

@Injectable()
class AdminAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async workspace(principal: AuthPrincipal, rawDays?: string) {
    this.requireAdmin(principal);
    const days = this.periodDays(rawDays);
    const generatedAt = new Date();
    const spanMs = days * 24 * 60 * 60 * 1000;
    const current: Period = { from: new Date(generatedAt.getTime() - spanMs), to: generatedAt };
    const previous: Period = { from: new Date(generatedAt.getTime() - 2 * spanMs), to: current.from };

    const [currentSnapshot, previousSnapshot, network] = await Promise.all([
      this.periodSnapshot(current),
      this.periodSnapshot(previous),
      this.networkSnapshot(),
    ]);

    return {
      generatedAt: generatedAt.toISOString(),
      window: {
        days,
        current: this.presentPeriod(current),
        previous: this.presentPeriod(previous),
      },
      privacy: {
        aggregateOnly: true,
        phiNeutral: true,
        patientIdentityExcluded: true,
        providerIdentityExcluded: true,
        clinicalContentExcluded: true,
        policyIdentifiersExcluded: true,
        roomCredentialsExcluded: true,
        encryptionMaterialExcluded: true,
      },
      network,
      current: currentSnapshot,
      previous: previousSnapshot,
      signals: {
        appointmentVolume: this.trend(currentSnapshot.appointments.total, previousSnapshot.appointments.total, "NEUTRAL"),
        noShowRate: this.trend(currentSnapshot.appointments.noShowRate, previousSnapshot.appointments.noShowRate, "LOWER"),
        claimDenialRate: this.trend(currentSnapshot.claims.denialRate, previousSnapshot.claims.denialRate, "LOWER"),
        deniedSecurityEvents: this.trend(currentSnapshot.security.denied, previousSnapshot.security.denied, "LOWER"),
        telehealthInitializationRate: this.trend(
          currentSnapshot.telehealth.initializationRate,
          previousSnapshot.telehealth.initializationRate,
          "HIGHER",
        ),
        emergencyDemand: this.trend(currentSnapshot.mobility.emergencyRequests, previousSnapshot.mobility.emergencyRequests, "NEUTRAL"),
      },
    };
  }

  private async periodSnapshot(period: Period) {
    const range = { gte: period.from, lt: period.to };
    const telehealthStatusCounts = await Promise.all(
      TELEHEALTH_STATUSES.map(async (status) => ({
        status,
        count: await this.prisma.telehealthSession.count({
          where: {
            status,
            appointment: {
              modality: "TELEMEDICINE",
              startsAt: range,
            },
          },
        }),
      })),
    );

    const [
      appointmentGroups,
      invoiceGroups,
      paymentGroups,
      claimGroups,
      claimsReviewRequired,
      securityEvents,
      deniedSecurityEvents,
      replayDeniedEvents,
      emergencyRequests,
      transportGroups,
    ] = await Promise.all([
      this.prisma.appointment.groupBy({
        by: ["status", "modality"],
        where: { startsAt: range },
        _count: { _all: true },
      }),
      this.prisma.invoice.groupBy({
        by: ["currency"],
        where: { issuedAt: range },
        _count: { _all: true },
        _sum: { totalMinor: true },
      }),
      this.prisma.paymentIntent.groupBy({
        by: ["currency"],
        where: { status: "SUCCEEDED", succeededAt: range },
        _count: { _all: true },
        _sum: { amountMinor: true },
      }),
      this.prisma.insuranceClaim.groupBy({
        by: ["status"],
        where: { submittedAt: range },
        _count: { _all: true },
      }),
      this.prisma.insuranceClaim.count({
        where: { submittedAt: range, reconciliationStatus: "REVIEW_REQUIRED" },
      }),
      this.prisma.auditEvent.count({
        where: { action: { in: [...SECURITY_ACTIONS] }, occurredAt: range },
      }),
      this.prisma.auditEvent.count({
        where: { action: { in: [...SECURITY_ACTIONS] }, result: "DENIED", occurredAt: range },
      }),
      this.prisma.auditEvent.count({
        where: { action: { in: [...REPLAY_ACTIONS] }, occurredAt: range },
      }),
      this.prisma.emergencyAmbulanceRequest.count({ where: { requestedAt: range } }),
      this.prisma.medicalTransportRequest.groupBy({
        by: ["mode"],
        where: { requestedAt: range },
        _count: { _all: true },
      }),
    ]);

    const appointments = this.appointmentAnalytics(appointmentGroups);
    const telehealthByStatus = Object.fromEntries(TELEHEALTH_STATUSES.map((status) => [status, 0])) as Record<string, number>;
    for (const item of telehealthStatusCounts) telehealthByStatus[item.status] = item.count;
    const initializedSessions = Object.values(telehealthByStatus).reduce((sum, value) => sum + value, 0);
    const telemedicineAppointments = appointments.byModality.TELEMEDICINE;

    return {
      appointments,
      telehealth: {
        appointments: telemedicineAppointments,
        initializedSessions,
        initializationRate: this.rate(initializedSessions, telemedicineAppointments),
        byStatus: telehealthByStatus,
      },
      finance: this.financeAnalytics(invoiceGroups, paymentGroups),
      claims: this.claimAnalytics(claimGroups, claimsReviewRequired),
      security: {
        events: securityEvents,
        denied: deniedSecurityEvents,
        replayDenied: replayDeniedEvents,
      },
      mobility: {
        emergencyRequests,
        scheduledTransport: {
          ground: this.groupCount(transportGroups, "mode", "GROUND"),
          air: this.groupCount(transportGroups, "mode", "AIR"),
        },
      },
    };
  }

  private async networkSnapshot() {
    const [activeDoctors, activeOtherProviders, onboardingReview] = await Promise.all([
      this.prisma.provider.count({ where: { class: "DOCTOR", status: "ACTIVE" } }),
      this.prisma.provider.count({ where: { class: "OTHER_PROVIDER", status: "ACTIVE" } }),
      this.prisma.providerOnboarding.count({ where: { state: { in: [...REVIEW_ONBOARDING_STATES] } } }),
    ]);
    return { activeDoctors, activeOtherProviders, onboardingReview };
  }

  private appointmentAnalytics(groups: Array<{ status: string; modality: string; _count: { _all: number } }>) {
    const byStatus: Record<string, number> = {
      REQUESTED: 0,
      CONFIRMED: 0,
      CANCELLED: 0,
      COMPLETED: 0,
      NO_SHOW: 0,
    };
    const byModality: Record<string, number> = { CLINIC: 0, TELEMEDICINE: 0, HOME_VISIT: 0 };
    let total = 0;
    for (const row of groups) {
      total += row._count._all;
      byStatus[row.status] = (byStatus[row.status] ?? 0) + row._count._all;
      byModality[row.modality] = (byModality[row.modality] ?? 0) + row._count._all;
    }
    return {
      total,
      byStatus,
      byModality,
      completionRate: this.rate(byStatus.COMPLETED, total),
      cancellationRate: this.rate(byStatus.CANCELLED, total),
      noShowRate: this.rate(byStatus.NO_SHOW, total),
    };
  }

  private financeAnalytics(
    invoiceGroups: Array<{ currency: string; _count: { _all: number }; _sum: { totalMinor: number | null } }>,
    paymentGroups: Array<{ currency: string; _count: { _all: number }; _sum: { amountMinor: number | null } }>,
  ) {
    const currencies = new Map<string, { currency: string; invoiceCount: number; invoicedMinor: number; successfulPaymentCount: number; successfulPaymentsMinor: number }>();
    for (const row of invoiceGroups) {
      currencies.set(row.currency, {
        currency: row.currency,
        invoiceCount: row._count._all,
        invoicedMinor: row._sum.totalMinor ?? 0,
        successfulPaymentCount: 0,
        successfulPaymentsMinor: 0,
      });
    }
    for (const row of paymentGroups) {
      const current = currencies.get(row.currency) ?? {
        currency: row.currency,
        invoiceCount: 0,
        invoicedMinor: 0,
        successfulPaymentCount: 0,
        successfulPaymentsMinor: 0,
      };
      current.successfulPaymentCount = row._count._all;
      current.successfulPaymentsMinor = row._sum.amountMinor ?? 0;
      currencies.set(row.currency, current);
    }
    return [...currencies.values()].sort((left, right) => left.currency.localeCompare(right.currency));
  }

  private claimAnalytics(groups: Array<{ status: string; _count: { _all: number } }>, reviewRequired: number) {
    const byStatus: Record<string, number> = {
      SUBMITTED: 0,
      ACCEPTED: 0,
      PENDING: 0,
      ADJUDICATED: 0,
      DENIED: 0,
      PAID: 0,
      VOID: 0,
    };
    let total = 0;
    for (const row of groups) {
      total += row._count._all;
      byStatus[row.status] = (byStatus[row.status] ?? 0) + row._count._all;
    }
    return {
      total,
      byStatus,
      reviewRequired,
      denialRate: this.rate(byStatus.DENIED, total),
    };
  }

  private groupCount<T extends Record<string, unknown>>(groups: Array<T & { _count: { _all: number } }>, field: keyof T, value: string) {
    return groups.find((row) => String(row[field]) === value)?._count._all ?? 0;
  }

  private trend(current: number, previous: number, favorableDirection: FavorableDirection) {
    const direction = current === previous ? "STABLE" : previous === 0 && current > 0 ? "NEW" : current > previous ? "UP" : "DOWN";
    const deltaPercent = previous === 0 ? (current === 0 ? 0 : null) : this.round(((current - previous) / previous) * 100);
    const favorable = favorableDirection === "NEUTRAL" || current === previous
      ? null
      : favorableDirection === "HIGHER"
        ? current > previous
        : current < previous;
    return { current, previous, direction, deltaPercent, favorable };
  }

  private rate(numerator: number, denominator: number) {
    if (denominator <= 0) return 0;
    return this.round((numerator / denominator) * 100);
  }

  private round(value: number) {
    return Math.round(value * 10) / 10;
  }

  private presentPeriod(period: Period) {
    return { from: period.from.toISOString(), to: period.to.toISOString() };
  }

  private periodDays(raw?: string): PeriodDays {
    if (!raw?.trim()) return 30;
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || !(PERIOD_DAYS as readonly number[]).includes(parsed)) {
      throw new BadRequestException(`days must be one of: ${PERIOD_DAYS.join(", ")}.`);
    }
    return parsed as PeriodDays;
  }

  private requireAdmin(principal: AuthPrincipal) {
    if (principal.role !== "ADMIN") throw new ForbiddenException("Administrator analytics access is required.");
  }
}

@Controller("admin/operations/analytics")
class AdminAnalyticsController {
  constructor(private readonly analytics: AdminAnalyticsService) {}

  @Get("workspace")
  workspace(@CurrentPrincipal() principal: AuthPrincipal, @Query("days") days?: string) {
    return this.analytics.workspace(principal, days);
  }
}

@Module({ controllers: [AdminAnalyticsController], providers: [AdminAnalyticsService] })
export class AdminAnalyticsModule {}
