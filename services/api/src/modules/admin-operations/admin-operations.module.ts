import { BadRequestException, Controller, ForbiddenException, Get, Injectable, Module, Query } from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { CurrentPrincipal } from "../../security/api-security.module";

const ACTIVE_EMERGENCY_STATUSES = ["REQUESTED", "DISPATCHING", "ASSIGNED", "EN_ROUTE", "ARRIVED", "TRANSPORTING"] as const;
const ACTIVE_TRANSPORT_STATUSES = ["REQUESTED", "ASSIGNED", "EN_ROUTE", "ARRIVED", "TRANSPORTING"] as const;
const REVIEW_ONBOARDING_STATES = ["PENDING_REVIEW", "REQUEST_CHANGES"] as const;
const OPEN_INVOICE_STATUSES = ["OPEN", "PARTIALLY_PAID"] as const;
const ACTIVE_PAYOUT_STATUSES = ["PENDING", "PROCESSING"] as const;
const SECURITY_WINDOW_MS = 24 * 60 * 60 * 1000;

@Injectable()
class AdminOperationsService {
  constructor(private readonly prisma: PrismaService) {}

  async commandCenter(principal: AuthPrincipal, rawTimezoneOffset?: string) {
    this.requireAdmin(principal);
    const timezoneOffsetMinutes = this.timezoneOffset(rawTimezoneOffset);
    const generatedAt = new Date();
    const { start, end } = this.localDayBounds(generatedAt, timezoneOffsetMinutes);
    const securitySince = new Date(generatedAt.getTime() - SECURITY_WINDOW_MS);

    const [
      appointmentGroups,
      activeDoctors,
      activeOtherProviders,
      onboardingGroups,
      emergencyActive,
      emergencyQueue,
      transportGroups,
      invoiceGroups,
      payoutGroups,
      claimAttention,
      deniedSecurityEvents,
      recentDeniedEvents,
    ] = await Promise.all([
      this.prisma.appointment.groupBy({
        by: ["modality", "status"],
        where: { startsAt: { gte: start, lt: end }, status: { not: "CANCELLED" } },
        _count: { _all: true },
      }),
      this.prisma.provider.count({ where: { class: "DOCTOR", status: "ACTIVE" } }),
      this.prisma.provider.count({ where: { class: "OTHER_PROVIDER", status: "ACTIVE" } }),
      this.prisma.providerOnboarding.groupBy({
        by: ["kind", "state"],
        where: { state: { in: [...REVIEW_ONBOARDING_STATES] } },
        _count: { _all: true },
      }),
      this.prisma.emergencyAmbulanceRequest.count({ where: { status: { in: [...ACTIVE_EMERGENCY_STATUSES] } } }),
      this.prisma.emergencyAmbulanceRequest.findMany({
        where: { status: { in: [...ACTIVE_EMERGENCY_STATUSES] } },
        orderBy: { requestedAt: "asc" },
        take: 5,
        select: {
          id: true,
          status: true,
          requestedAt: true,
          etaMinutes: true,
          assignedProvider: { select: { displayName: true } },
        },
      }),
      this.prisma.medicalTransportRequest.groupBy({
        by: ["mode", "status"],
        where: { status: { in: [...ACTIVE_TRANSPORT_STATUSES] } },
        _count: { _all: true },
      }),
      this.prisma.invoice.groupBy({
        by: ["currency"],
        where: { status: { in: [...OPEN_INVOICE_STATUSES] }, balanceDueMinor: { gt: 0 } },
        _count: { _all: true },
        _sum: { balanceDueMinor: true },
      }),
      this.prisma.providerPayout.groupBy({
        by: ["currency"],
        where: { status: { in: [...ACTIVE_PAYOUT_STATUSES] } },
        _count: { _all: true },
        _sum: { amountMinor: true },
      }),
      this.prisma.insuranceClaim.count({
        where: { OR: [{ reconciliationStatus: "REVIEW_REQUIRED" }, { status: "DENIED" }] },
      }),
      this.prisma.auditEvent.count({ where: { result: "DENIED", occurredAt: { gte: securitySince } } }),
      this.prisma.auditEvent.findMany({
        where: { result: "DENIED", occurredAt: { gte: securitySince } },
        orderBy: { occurredAt: "desc" },
        take: 5,
        select: { action: true, objectType: true, result: true, occurredAt: true },
      }),
    ]);

    const appointmentByModality = {
      CLINIC: this.appointmentSummary(appointmentGroups, "CLINIC"),
      TELEMEDICINE: this.appointmentSummary(appointmentGroups, "TELEMEDICINE"),
      HOME_VISIT: this.appointmentSummary(appointmentGroups, "HOME_VISIT"),
    };
    const visitsToday = Object.values(appointmentByModality).reduce((sum, item) => sum + item.total, 0);

    return {
      generatedAt: generatedAt.toISOString(),
      window: {
        timezoneOffsetMinutes,
        start: start.toISOString(),
        end: end.toISOString(),
      },
      health: {
        status: "OPERATIONAL",
        source: "LIVE_DATABASE_SNAPSHOT",
      },
      kpis: {
        visitsToday,
        activeDoctors,
        activeOtherProviders,
        urgentRequests: emergencyActive,
      },
      appointments: {
        total: visitsToday,
        byModality: appointmentByModality,
      },
      governance: {
        doctors: this.onboardingSummary(onboardingGroups, "DOCTOR"),
        otherProviders: this.onboardingSummary(onboardingGroups, "OTHER_PROVIDER"),
      },
      emergency: {
        active: emergencyActive,
        queue: emergencyQueue.map((item) => ({
          requestId: item.id,
          status: item.status,
          requestedAt: item.requestedAt.toISOString(),
          etaMinutes: item.etaMinutes,
          assignedProvider: item.assignedProvider?.displayName ?? null,
        })),
      },
      transport: {
        ground: this.transportSummary(transportGroups, "GROUND"),
        air: this.transportSummary(transportGroups, "AIR"),
      },
      finance: {
        outstandingInvoices: invoiceGroups.map((item) => ({
          currency: item.currency,
          count: item._count._all,
          balanceDueMinor: item._sum.balanceDueMinor ?? 0,
        })),
        pendingPayouts: payoutGroups.map((item) => ({
          currency: item.currency,
          count: item._count._all,
          amountMinor: item._sum.amountMinor ?? 0,
        })),
      },
      revenueCycle: {
        attentionClaims: claimAttention,
      },
      security: {
        deniedEventsLast24h: deniedSecurityEvents,
        recentDeniedEvents: recentDeniedEvents.map((item) => ({
          action: item.action,
          objectType: item.objectType,
          result: item.result,
          occurredAt: item.occurredAt.toISOString(),
        })),
      },
    };
  }

  private appointmentSummary(rows: Array<{ modality: string; status: string; _count: { _all: number } }>, modality: string) {
    const matches = rows.filter((row) => row.modality === modality);
    const statuses: Record<string, number> = {};
    let total = 0;
    for (const row of matches) {
      statuses[row.status] = row._count._all;
      total += row._count._all;
    }
    return { total, statuses };
  }

  private onboardingSummary(rows: Array<{ kind: string; state: string; _count: { _all: number } }>, kind: string) {
    let pendingReview = 0;
    let requestChanges = 0;
    for (const row of rows) {
      if (row.kind !== kind) continue;
      if (row.state === "PENDING_REVIEW") pendingReview += row._count._all;
      if (row.state === "REQUEST_CHANGES") requestChanges += row._count._all;
    }
    return { pendingReview, requestChanges, totalOpen: pendingReview + requestChanges };
  }

  private transportSummary(rows: Array<{ mode: string; status: string; _count: { _all: number } }>, mode: string) {
    const matches = rows.filter((row) => row.mode === mode);
    const statuses: Record<string, number> = {};
    let active = 0;
    for (const row of matches) {
      statuses[row.status] = row._count._all;
      active += row._count._all;
    }
    return { active, statuses };
  }

  private timezoneOffset(value?: string): number {
    if (value === undefined || value === "") return 0;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < -720 || parsed > 840) {
      throw new BadRequestException("tzOffsetMinutes must be an integer between -720 and 840.");
    }
    return parsed;
  }

  private localDayBounds(now: Date, timezoneOffsetMinutes: number) {
    const offsetMs = timezoneOffsetMinutes * 60_000;
    const shifted = new Date(now.getTime() + offsetMs);
    const shiftedStart = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate());
    const start = new Date(shiftedStart - offsetMs);
    return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
  }

  private requireAdmin(principal: AuthPrincipal) {
    if (principal.role !== "ADMIN") throw new ForbiddenException("Administrator command center access is required.");
  }
}

@Controller("admin/operations")
class AdminOperationsController {
  constructor(private readonly operations: AdminOperationsService) {}

  @Get("command-center")
  commandCenter(@CurrentPrincipal() principal: AuthPrincipal, @Query("tzOffsetMinutes") timezoneOffsetMinutes?: string) {
    return this.operations.commandCenter(principal, timezoneOffsetMinutes);
  }
}

@Module({
  controllers: [AdminOperationsController],
  providers: [AdminOperationsService],
})
export class AdminOperationsModule {}
