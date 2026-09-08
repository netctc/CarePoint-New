import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Post,
  Query,
} from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { Prisma, type AppointmentModality, type AppointmentStatus } from "@prisma/client";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { CurrentPrincipal, RequirePermissions } from "../../security/api-security.module";

const ACTIVE_EMERGENCY_STATUSES = ["REQUESTED", "DISPATCHING", "ASSIGNED", "EN_ROUTE", "ARRIVED", "TRANSPORTING"] as const;
const ACTIVE_TRANSPORT_STATUSES = ["REQUESTED", "ASSIGNED", "EN_ROUTE", "ARRIVED", "TRANSPORTING"] as const;
const REVIEW_ONBOARDING_STATES = ["PENDING_REVIEW", "REQUEST_CHANGES"] as const;
const OPEN_INVOICE_STATUSES = ["OPEN", "PARTIALLY_PAID"] as const;
const ACTIVE_PAYOUT_STATUSES = ["PENDING", "PROCESSING"] as const;
const SECURITY_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_APPOINTMENT_WINDOW_MS = 31 * 24 * 60 * 60 * 1000;
const APPOINTMENT_MODALITIES = ["CLINIC", "TELEMEDICINE", "HOME_VISIT"] as const;
const APPOINTMENT_STATUSES = ["REQUESTED", "CONFIRMED", "CANCELLED", "COMPLETED", "NO_SHOW"] as const;
const APPOINTMENT_ACTIONS = ["CANCEL", "COMPLETE", "NO_SHOW"] as const;
const CANCELLATION_REASON_CODES = ["PATIENT_REQUEST", "PROVIDER_UNAVAILABLE", "OPERATIONS", "DUPLICATE", "OTHER"] as const;

type AppointmentAction = (typeof APPOINTMENT_ACTIONS)[number];
type CancellationReasonCode = (typeof CANCELLATION_REASON_CODES)[number];

@Injectable()
class AdminOperationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
  ) {}

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

  async appointments(
    principal: AuthPrincipal,
    input: { from?: string; to?: string; modality?: string; status?: string; providerId?: string; tzOffsetMinutes?: string },
  ) {
    this.requireAdmin(principal);
    const generatedAt = new Date();
    const timezoneOffsetMinutes = this.timezoneOffset(input.tzOffsetMinutes);
    const { from, to } = this.appointmentWindow(generatedAt, timezoneOffsetMinutes, input.from, input.to);
    const modality = this.optionalModality(input.modality);
    const status = this.optionalAppointmentStatus(input.status);
    const providerId = this.optionalIdentifier(input.providerId, "providerId");
    const where: Prisma.AppointmentWhereInput = {
      startsAt: { gte: from, lt: to },
      ...(modality ? { modality } : {}),
      ...(status ? { status } : {}),
      ...(providerId ? { providerId } : {}),
    };

    const [groups, total, rows, providers] = await Promise.all([
      this.prisma.appointment.groupBy({
        by: ["modality", "status"],
        where,
        _count: { _all: true },
      }),
      this.prisma.appointment.count({ where }),
      this.prisma.appointment.findMany({
        where,
        orderBy: [{ startsAt: "asc" }, { id: "asc" }],
        take: 250,
        select: {
          id: true,
          status: true,
          modality: true,
          startsAt: true,
          endsAt: true,
          cancelledAt: true,
          provider: { select: { id: true, class: true, displayName: true } },
          service: { select: { id: true, name: true } },
          telehealthSession: { select: { status: true } },
        },
      }),
      this.prisma.provider.findMany({
        where: { status: "ACTIVE" },
        orderBy: [{ displayName: "asc" }, { id: "asc" }],
        take: 500,
        select: { id: true, class: true, displayName: true },
      }),
    ]);

    return {
      generatedAt: generatedAt.toISOString(),
      window: { from: from.toISOString(), to: to.toISOString(), timezoneOffsetMinutes },
      filters: {
        modality,
        status,
        providerId,
        providers,
      },
      total,
      truncated: total > rows.length,
      summary: {
        CLINIC: this.appointmentSummary(groups, "CLINIC"),
        TELEMEDICINE: this.appointmentSummary(groups, "TELEMEDICINE"),
        HOME_VISIT: this.appointmentSummary(groups, "HOME_VISIT"),
      },
      items: rows.map((row) => this.presentAppointment(row, generatedAt)),
    };
  }

  async interveneAppointment(
    principal: AuthPrincipal,
    appointmentId: string,
    input: { action?: string; reasonCode?: string },
  ) {
    this.requireAdmin(principal);
    const id = this.optionalIdentifier(appointmentId, "appointmentId");
    if (!id) throw new BadRequestException("appointmentId is required.");
    const action = this.appointmentAction(input.action);
    const reasonCode = action === "CANCEL" ? this.cancellationReason(input.reasonCode) : null;
    const targetStatus: AppointmentStatus = action === "CANCEL" ? "CANCELLED" : action === "COMPLETE" ? "COMPLETED" : "NO_SHOW";
    const now = new Date();

    const transition = await this.prisma.$transaction(async (tx) => {
      const current = await tx.appointment.findUnique({
        where: { id },
        select: { id: true, status: true, startsAt: true, endsAt: true, slotId: true },
      });
      if (!current) throw new NotFoundException("Appointment not found.");
      if (current.status === targetStatus) return { fromStatus: current.status, changed: false };

      if (action === "CANCEL") {
        if (current.status !== "REQUESTED" && current.status !== "CONFIRMED") throw new ConflictException("Only active appointments can be cancelled.");
      } else if (action === "COMPLETE") {
        if (current.status !== "CONFIRMED") throw new ConflictException("Only confirmed appointments can be marked completed.");
        if (current.startsAt.getTime() > now.getTime()) throw new ConflictException("A future appointment cannot be marked completed.");
      } else {
        if (current.status !== "CONFIRMED") throw new ConflictException("Only confirmed appointments can be marked no-show.");
        if (current.endsAt.getTime() > now.getTime()) throw new ConflictException("An appointment cannot be marked no-show before its scheduled end.");
      }

      const changed = await tx.appointment.updateMany({
        where: { id: current.id, status: current.status },
        data: {
          status: targetStatus,
          ...(targetStatus === "CANCELLED" ? { cancelledAt: now, cancellationReason: reasonCode } : {}),
        },
      });
      if (changed.count !== 1) throw new ConflictException("Appointment changed concurrently. Refresh and retry.");

      if (targetStatus === "CANCELLED" && current.slotId) {
        await tx.availabilitySlot.updateMany({
          where: { id: current.slotId, bookedCount: { gt: 0 } },
          data: { bookedCount: { decrement: 1 }, version: { increment: 1 } },
        });
      }
      return { fromStatus: current.status, changed: true };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    if (transition.changed) {
      await this.audit.write({
        actorId: principal.accountId,
        action: action === "CANCEL" ? "ADMIN_APPOINTMENT_CANCELLED" : action === "COMPLETE" ? "ADMIN_APPOINTMENT_COMPLETED" : "ADMIN_APPOINTMENT_NO_SHOW",
        objectType: "APPOINTMENT",
        objectId: id,
        purpose: "APPOINTMENT_OPERATIONS",
        result: "SUCCESS",
        metadata: { fromStatus: transition.fromStatus, toStatus: targetStatus, ...(reasonCode ? { reasonCode } : {}) },
      });
    }

    const row = await this.prisma.appointment.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        modality: true,
        startsAt: true,
        endsAt: true,
        cancelledAt: true,
        provider: { select: { id: true, class: true, displayName: true } },
        service: { select: { id: true, name: true } },
        telehealthSession: { select: { status: true } },
      },
    });
    if (!row) throw new NotFoundException("Appointment not found.");
    return this.presentAppointment(row, now);
  }

  private presentAppointment(
    row: {
      id: string;
      status: AppointmentStatus;
      modality: AppointmentModality;
      startsAt: Date;
      endsAt: Date;
      cancelledAt: Date | null;
      provider: { id: string; class: string; displayName: string };
      service: { id: string; name: string };
      telehealthSession: { status: string } | null;
    },
    now: Date,
  ) {
    return {
      appointmentId: row.id,
      status: row.status,
      modality: row.modality,
      startsAt: row.startsAt.toISOString(),
      endsAt: row.endsAt.toISOString(),
      cancelledAt: row.cancelledAt?.toISOString() ?? null,
      provider: row.provider,
      service: row.service,
      telehealth: row.telehealthSession ? { status: row.telehealthSession.status } : null,
      operations: {
        canCancel: row.status === "REQUESTED" || row.status === "CONFIRMED",
        canComplete: row.status === "CONFIRMED" && row.startsAt.getTime() <= now.getTime(),
        canNoShow: row.status === "CONFIRMED" && row.endsAt.getTime() <= now.getTime(),
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

  private appointmentWindow(now: Date, timezoneOffsetMinutes: number, rawFrom?: string, rawTo?: string) {
    if (!rawFrom && !rawTo) {
      const bounds = this.localDayBounds(now, timezoneOffsetMinutes);
      return { from: bounds.start, to: bounds.end };
    }
    if (!rawFrom || !rawTo) throw new BadRequestException("from and to must be supplied together.");
    const from = new Date(rawFrom);
    const to = new Date(rawTo);
    if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || to.getTime() <= from.getTime()) throw new BadRequestException("A valid from/to appointment interval is required.");
    if (to.getTime() - from.getTime() > MAX_APPOINTMENT_WINDOW_MS) throw new BadRequestException("Appointment operations are limited to a 31-day interval.");
    return { from, to };
  }

  private optionalModality(value?: string): AppointmentModality | null {
    if (!value?.trim()) return null;
    const normalized = value.trim().toUpperCase();
    if (!(APPOINTMENT_MODALITIES as readonly string[]).includes(normalized)) throw new BadRequestException("Unsupported appointment modality.");
    return normalized as AppointmentModality;
  }

  private optionalAppointmentStatus(value?: string): AppointmentStatus | null {
    if (!value?.trim()) return null;
    const normalized = value.trim().toUpperCase();
    if (!(APPOINTMENT_STATUSES as readonly string[]).includes(normalized)) throw new BadRequestException("Unsupported appointment status.");
    return normalized as AppointmentStatus;
  }

  private appointmentAction(value?: string): AppointmentAction {
    const normalized = value?.trim().toUpperCase() ?? "";
    if (!(APPOINTMENT_ACTIONS as readonly string[]).includes(normalized)) throw new BadRequestException("Unsupported appointment intervention.");
    return normalized as AppointmentAction;
  }

  private cancellationReason(value?: string): CancellationReasonCode {
    const normalized = value?.trim().toUpperCase() ?? "";
    if (!(CANCELLATION_REASON_CODES as readonly string[]).includes(normalized)) throw new BadRequestException("A supported cancellation reasonCode is required.");
    return normalized as CancellationReasonCode;
  }

  private optionalIdentifier(value: string | undefined, field: string): string | null {
    if (!value?.trim()) return null;
    const cleaned = value.trim();
    if (cleaned.length > 128) throw new BadRequestException(`${field} is too long.`);
    return cleaned;
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
    if (principal.role !== "ADMIN") throw new ForbiddenException("Administrator operations access is required.");
  }
}

@Controller("admin/operations")
class AdminOperationsController {
  constructor(private readonly operations: AdminOperationsService) {}

  @Get("command-center")
  commandCenter(@CurrentPrincipal() principal: AuthPrincipal, @Query("tzOffsetMinutes") timezoneOffsetMinutes?: string) {
    return this.operations.commandCenter(principal, timezoneOffsetMinutes);
  }

  @RequirePermissions("APPOINTMENT_OPERATE")
  @Get("appointments")
  appointments(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("modality") modality?: string,
    @Query("status") status?: string,
    @Query("providerId") providerId?: string,
    @Query("tzOffsetMinutes") timezoneOffsetMinutes?: string,
  ) {
    return this.operations.appointments(principal, { from, to, modality, status, providerId, tzOffsetMinutes: timezoneOffsetMinutes });
  }

  @RequirePermissions("APPOINTMENT_OPERATE")
  @Post("appointments/:appointmentId/intervention")
  interveneAppointment(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("appointmentId") appointmentId: string,
    @Body() body: { action?: string; reasonCode?: string },
  ) {
    return this.operations.interveneAppointment(principal, appointmentId, body);
  }
}

@Module({
  controllers: [AdminOperationsController],
  providers: [AdminOperationsService],
})
export class AdminOperationsModule {}
