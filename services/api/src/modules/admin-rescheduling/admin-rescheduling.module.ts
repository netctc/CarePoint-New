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
import { Prisma, type AppointmentModality, type AppointmentStatus, type TelehealthSessionStatus } from "@prisma/client";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { CurrentPrincipal, RequirePermissions } from "../../security/api-security.module";

const MAX_RESCHEDULE_WINDOW_MS = 31 * 24 * 60 * 60 * 1000;
const MAX_OPTIONS = 250;
const BLOCKING_TELEHEALTH_STATES = ["ACTIVE", "ENDED", "CANCELLED"] as const;

type AppointmentForReschedule = {
  id: string;
  status: AppointmentStatus;
  modality: AppointmentModality;
  startsAt: Date;
  endsAt: Date;
  slotId: string | null;
  providerId: string;
  serviceId: string;
  provider: { id: string; class: string; displayName: string };
  service: { id: string; name: string };
  telehealthSession: {
    status: TelehealthSessionStatus;
    startedAt: Date | null;
    endedAt: Date | null;
  } | null;
};

@Injectable()
class AdminReschedulingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
  ) {}

  async options(principal: AuthPrincipal, appointmentId: string, input: { from?: string; to?: string }) {
    this.requireAdmin(principal);
    const id = this.identifier(appointmentId, "appointmentId");
    const now = new Date();
    const appointment = await this.loadAppointment(id);
    this.assertReschedulable(appointment, now);
    const { from, to } = this.window(now, input.from, input.to);

    const candidates = await this.prisma.availabilitySlot.findMany({
      where: {
        providerId: appointment.providerId,
        serviceId: appointment.serviceId,
        modality: appointment.modality,
        status: "OPEN",
        startsAt: { gte: from, lt: to, gt: now },
        id: appointment.slotId ? { not: appointment.slotId } : undefined,
        provider: { status: "ACTIVE" },
        service: { active: true },
      },
      orderBy: [{ startsAt: "asc" }, { id: "asc" }],
      take: 500,
      select: {
        id: true,
        startsAt: true,
        endsAt: true,
        capacity: true,
        bookedCount: true,
      },
    });

    const available = candidates.filter((slot) => slot.bookedCount < slot.capacity);
    const items = available.slice(0, MAX_OPTIONS).map((slot) => ({
      slotId: slot.id,
      startsAt: slot.startsAt.toISOString(),
      endsAt: slot.endsAt.toISOString(),
      remainingCapacity: slot.capacity - slot.bookedCount,
    }));

    return {
      generatedAt: now.toISOString(),
      appointment: this.presentAppointment(appointment),
      window: { from: from.toISOString(), to: to.toISOString() },
      totalAvailable: available.length,
      truncated: available.length > items.length,
      items,
      policy: {
        sameProvider: true,
        sameService: true,
        sameModality: true,
        pricingSnapshotPreserved: true,
        invoicePreserved: true,
      },
    };
  }

  async reschedule(principal: AuthPrincipal, appointmentId: string, input: { slotId?: string }) {
    this.requireAdmin(principal);
    const id = this.identifier(appointmentId, "appointmentId");
    const slotId = this.identifier(input.slotId, "slotId");
    const now = new Date();

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const current = await tx.appointment.findUnique({
          where: { id },
          select: {
            id: true,
            status: true,
            modality: true,
            startsAt: true,
            endsAt: true,
            slotId: true,
            providerId: true,
            serviceId: true,
            provider: { select: { id: true, class: true, displayName: true } },
            service: { select: { id: true, name: true } },
            telehealthSession: { select: { status: true, startedAt: true, endedAt: true } },
          },
        });
        if (!current) throw new NotFoundException("Appointment not found.");
        this.assertReschedulable(current, now);
        if (current.slotId === slotId) throw new ConflictException("Appointment is already assigned to the selected slot.");

        const destination = await tx.availabilitySlot.findUnique({
          where: { id: slotId },
          select: {
            id: true,
            providerId: true,
            serviceId: true,
            modality: true,
            startsAt: true,
            endsAt: true,
            capacity: true,
            bookedCount: true,
            status: true,
            provider: { select: { status: true } },
            service: { select: { active: true } },
          },
        });
        if (!destination || destination.status !== "OPEN" || !destination.service.active || destination.provider.status !== "ACTIVE") {
          throw new ConflictException("The selected reschedule slot is not available.");
        }
        if (destination.startsAt.getTime() <= now.getTime()) throw new ConflictException("The selected reschedule slot must be in the future.");
        if (destination.providerId !== current.providerId || destination.serviceId !== current.serviceId || destination.modality !== current.modality) {
          throw new ConflictException("Administrative rescheduling must preserve provider, service and modality.");
        }
        if (destination.bookedCount >= destination.capacity) throw new ConflictException("The selected reschedule slot is full.");

        const claim = await tx.insuranceClaim.findFirst({ where: { appointmentId: current.id }, select: { id: true } });
        if (claim) throw new ConflictException("An appointment with an issued insurance claim cannot be administratively rescheduled.");

        const latestEligibility = await tx.insuranceEligibilityCheck.findFirst({
          where: { appointmentId: current.id, status: "ELIGIBLE" },
          orderBy: { checkedAt: "desc" },
          select: { expiresAt: true },
        });
        if (latestEligibility?.expiresAt && latestEligibility.expiresAt.getTime() < destination.startsAt.getTime()) {
          throw new ConflictException("Insurance eligibility does not cover the selected reschedule time.");
        }
        const latestAuthorization = await tx.priorAuthorization.findFirst({
          where: { appointmentId: current.id, status: "APPROVED" },
          orderBy: { createdAt: "desc" },
          select: { validUntil: true },
        });
        if (latestAuthorization?.validUntil && latestAuthorization.validUntil.getTime() < destination.startsAt.getTime()) {
          throw new ConflictException("Prior authorization does not cover the selected reschedule time.");
        }

        const reserve = await tx.availabilitySlot.updateMany({
          where: { id: destination.id, status: "OPEN", bookedCount: { lt: destination.capacity } },
          data: { bookedCount: { increment: 1 }, version: { increment: 1 } },
        });
        if (reserve.count !== 1) throw new ConflictException("The selected reschedule slot was taken concurrently.");

        const changed = await tx.appointment.updateMany({
          where: { id: current.id, status: current.status, startsAt: current.startsAt },
          data: { slotId: destination.id, startsAt: destination.startsAt, endsAt: destination.endsAt },
        });
        if (changed.count !== 1) throw new ConflictException("Appointment changed concurrently. Refresh and retry.");

        if (current.slotId) {
          const release = await tx.availabilitySlot.updateMany({
            where: { id: current.slotId, bookedCount: { gt: 0 } },
            data: { bookedCount: { decrement: 1 }, version: { increment: 1 } },
          });
          if (release.count !== 1) throw new ConflictException("Current slot inventory is inconsistent; reschedule was rolled back.");
        }

        let telehealthReadinessReset = false;
        if (current.modality === "TELEMEDICINE" && current.telehealthSession) {
          await tx.telehealthSession.update({
            where: { appointmentId: current.id },
            data: {
              status: "WAITING",
              patientReadyAt: null,
              providerReadyAt: null,
              patientReadiness: Prisma.DbNull,
              providerReadiness: Prisma.DbNull,
            },
          });
          telehealthReadinessReset = true;
        }

        return {
          appointmentId: current.id,
          providerId: current.providerId,
          serviceId: current.serviceId,
          modality: current.modality,
          fromSlotId: current.slotId,
          toSlotId: destination.id,
          fromStartsAt: current.startsAt,
          toStartsAt: destination.startsAt,
          telehealthReadinessReset,
        };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

      await this.audit.write({
        actorId: principal.accountId,
        action: "ADMIN_APPOINTMENT_RESCHEDULED",
        objectType: "APPOINTMENT",
        objectId: result.appointmentId,
        purpose: "APPOINTMENT_OPERATIONS",
        result: "SUCCESS",
        metadata: {
          providerId: result.providerId,
          serviceId: result.serviceId,
          modality: result.modality,
          fromSlotId: result.fromSlotId,
          toSlotId: result.toSlotId,
          fromStartsAt: result.fromStartsAt.toISOString(),
          toStartsAt: result.toStartsAt.toISOString(),
          telehealthReadinessReset: result.telehealthReadinessReset,
        },
      });

      const updated = await this.loadAppointment(id);
      return {
        ...this.presentAppointment(updated),
        reschedule: {
          fromSlotId: result.fromSlotId,
          toSlotId: result.toSlotId,
          telehealthReadinessReset: result.telehealthReadinessReset,
        },
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2034" || error.code === "P2004")) {
        throw new ConflictException("Appointment reschedule conflicted with concurrent scheduling activity. Refresh and retry.");
      }
      throw error;
    }
  }

  private async loadAppointment(id: string): Promise<AppointmentForReschedule> {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        modality: true,
        startsAt: true,
        endsAt: true,
        slotId: true,
        providerId: true,
        serviceId: true,
        provider: { select: { id: true, class: true, displayName: true } },
        service: { select: { id: true, name: true } },
        telehealthSession: { select: { status: true, startedAt: true, endedAt: true } },
      },
    });
    if (!appointment) throw new NotFoundException("Appointment not found.");
    return appointment;
  }

  private assertReschedulable(appointment: AppointmentForReschedule, now: Date) {
    if (appointment.status !== "REQUESTED" && appointment.status !== "CONFIRMED") {
      throw new ConflictException("Only active appointments can be rescheduled.");
    }
    if (appointment.startsAt.getTime() <= now.getTime()) throw new ConflictException("An appointment that has already started cannot be rescheduled.");
    const telehealth = appointment.telehealthSession;
    if (telehealth && ((BLOCKING_TELEHEALTH_STATES as readonly string[]).includes(telehealth.status) || telehealth.startedAt || telehealth.endedAt)) {
      throw new ConflictException("A telemedicine session that has started or ended cannot be rescheduled.");
    }
  }

  private presentAppointment(appointment: AppointmentForReschedule) {
    return {
      appointmentId: appointment.id,
      status: appointment.status,
      modality: appointment.modality,
      startsAt: appointment.startsAt.toISOString(),
      endsAt: appointment.endsAt.toISOString(),
      slotId: appointment.slotId,
      provider: appointment.provider,
      service: appointment.service,
      telehealth: appointment.telehealthSession ? { status: appointment.telehealthSession.status } : null,
    };
  }

  private window(now: Date, rawFrom?: string, rawTo?: string) {
    if (!rawFrom && !rawTo) return { from: now, to: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000) };
    if (!rawFrom || !rawTo) throw new BadRequestException("from and to must be supplied together.");
    const from = new Date(rawFrom);
    const to = new Date(rawTo);
    if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || to.getTime() <= from.getTime()) {
      throw new BadRequestException("A valid from/to reschedule interval is required.");
    }
    if (to.getTime() - from.getTime() > MAX_RESCHEDULE_WINDOW_MS) throw new BadRequestException("Reschedule options are limited to a 31-day interval.");
    return { from, to };
  }

  private identifier(value: string | undefined, field: string): string {
    const cleaned = value?.trim();
    if (!cleaned) throw new BadRequestException(`${field} is required.`);
    if (cleaned.length > 128) throw new BadRequestException(`${field} is too long.`);
    return cleaned;
  }

  private requireAdmin(principal: AuthPrincipal) {
    if (principal.role !== "ADMIN") throw new ForbiddenException("Administrator operations access is required.");
  }
}

@Controller("admin/operations/appointments")
class AdminReschedulingController {
  constructor(private readonly rescheduling: AdminReschedulingService) {}

  @RequirePermissions("APPOINTMENT_OPERATE")
  @Get(":appointmentId/reschedule-options")
  options(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("appointmentId") appointmentId: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    return this.rescheduling.options(principal, appointmentId, {
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
    });
  }

  @RequirePermissions("APPOINTMENT_OPERATE")
  @Post(":appointmentId/reschedule")
  reschedule(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("appointmentId") appointmentId: string,
    @Body() body: { slotId?: string },
  ) {
    return this.rescheduling.reschedule(principal, appointmentId, body);
  }
}

@Module({
  controllers: [AdminReschedulingController],
  providers: [AdminReschedulingService],
})
export class AdminReschedulingModule {}
