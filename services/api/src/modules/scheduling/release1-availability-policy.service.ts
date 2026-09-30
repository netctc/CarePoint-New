import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, type AppointmentModality } from "@prisma/client";
import type { AuthPrincipal } from "@carepoint/identity";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { SchedulingService } from "./scheduling.service";
import type { AvailabilityExceptionInput, Release1AvailabilityRuleInput } from "./release1-scheduling-context.types";

const MAX_EXCEPTION_DAYS = 366;

@Injectable()
export class Release1AvailabilityPolicyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
    private readonly scheduling: SchedulingService,
  ) {}

  async validateAvailabilityRulePolicy(principal: AuthPrincipal, input: Release1AvailabilityRuleInput) {
    const provider = await this.requireProvider(principal);
    const service = await this.ownedService(provider.id, input.serviceId);
    const modality = await this.prisma.serviceModality.findUnique({ where: { serviceId_modality: { serviceId: service.id, modality: input.modality } } });
    if (!modality?.active) throw new BadRequestException("Active service modality is required for availability.");
    const before = this.integer(input.bufferBeforeMinutes ?? 0, 0, 240, "bufferBeforeMinutes");
    const after = this.integer(input.bufferAfterMinutes ?? 0, 0, 240, "bufferAfterMinutes");
    if (!Number.isInteger(input.intervalMinutes) || input.intervalMinutes < modality.durationMinutes + before + after) {
      throw new BadRequestException("intervalMinutes must reserve service duration plus configured before/after buffers.");
    }
    return { before, after };
  }

  async saveAvailabilityRulePolicy(principal: AuthPrincipal, ruleId: string, input: Release1AvailabilityRuleInput) {
    const { before, after } = await this.validateAvailabilityRulePolicy(principal, input);
    await this.prisma.availabilityRulePolicy.upsert({
      where: { ruleId },
      create: { ruleId, bufferBeforeMinutes: before, bufferAfterMinutes: after },
      update: { bufferBeforeMinutes: before, bufferAfterMinutes: after },
    });
    return { bufferBeforeMinutes: before, bufferAfterMinutes: after };
  }

  async listAvailabilityRules(principal: AuthPrincipal) {
    const rows = await this.scheduling.listAvailabilityRules(principal);
    const policies = rows.length ? await this.prisma.availabilityRulePolicy.findMany({ where: { ruleId: { in: rows.map((row) => row.id) } } }) : [];
    const byRule = new Map(policies.map((row) => [row.ruleId, row]));
    return rows.map((row) => ({ ...row, bufferBeforeMinutes: byRule.get(row.id)?.bufferBeforeMinutes ?? 0, bufferAfterMinutes: byRule.get(row.id)?.bufferAfterMinutes ?? 0 }));
  }

  async createAvailabilityException(principal: AuthPrincipal, input: AvailabilityExceptionInput) {
    const provider = await this.requireProvider(principal);
    const startsAt = this.date(input.startsAt, "startsAt");
    const endsAt = this.date(input.endsAt, "endsAt");
    if (endsAt <= startsAt) throw new BadRequestException("endsAt must be after startsAt.");
    if (endsAt.getTime() - startsAt.getTime() > MAX_EXCEPTION_DAYS * 24 * 60 * 60 * 1000) throw new BadRequestException(`Availability exceptions cannot exceed ${MAX_EXCEPTION_DAYS} days.`);
    const kind = input.kind ?? "UNAVAILABLE";
    if (kind !== "UNAVAILABLE" && kind !== "VACATION") throw new BadRequestException("kind must be UNAVAILABLE or VACATION.");
    const modality = input.modality ? this.modality(input.modality) : null;
    const serviceId = input.serviceId ? (await this.ownedService(provider.id, input.serviceId)).id : null;
    await this.assertNoActiveAppointments(provider.id, startsAt, endsAt, serviceId, modality);
    const exception = await this.prisma.availabilityException.create({
      data: { providerId: provider.id, serviceId, modality, kind, startsAt, endsAt, reason: this.optional(input.reason, 500, "reason") },
    });
    const blockedSlots = await this.blockSlots(exception);
    await this.audit.write({ actorId: principal.accountId, action: "AVAILABILITY_EXCEPTION_CREATED", objectType: "AVAILABILITY_EXCEPTION", objectId: exception.id, purpose: "SCHEDULING_CONFIGURATION", result: "SUCCESS", metadata: { providerId: provider.id, kind, blockedSlots } });
    return { ...exception, blockedSlots };
  }

  async listAvailabilityExceptions(principal: AuthPrincipal) {
    const provider = await this.requireProvider(principal);
    return this.prisma.availabilityException.findMany({ where: { providerId: provider.id }, orderBy: [{ startsAt: "asc" }, { id: "asc" }], take: 500 });
  }

  async setAvailabilityExceptionActive(principal: AuthPrincipal, exceptionId: string, active: boolean) {
    const provider = await this.requireProvider(principal);
    const exception = await this.prisma.availabilityException.findUnique({ where: { id: this.text(exceptionId, 1, 128, "exceptionId") } });
    if (!exception || exception.providerId !== provider.id) throw new NotFoundException("Availability exception not found.");
    if (active) await this.assertNoActiveAppointments(provider.id, exception.startsAt, exception.endsAt, exception.serviceId, exception.modality);
    const updated = await this.prisma.availabilityException.update({ where: { id: exception.id }, data: { active } });
    const blockedSlots = active ? await this.blockSlots(updated) : 0;
    await this.audit.write({ actorId: principal.accountId, action: active ? "AVAILABILITY_EXCEPTION_ACTIVATED" : "AVAILABILITY_EXCEPTION_DEACTIVATED", objectType: "AVAILABILITY_EXCEPTION", objectId: exception.id, purpose: "SCHEDULING_CONFIGURATION", result: "SUCCESS", metadata: { blockedSlots } });
    return { ...updated, blockedSlots, blockedSlotsRequireExplicitUnblock: !active };
  }

  async generateAvailability(principal: AuthPrincipal, input: { fromDate: string; toDate: string; ruleId?: string }) {
    const result = await this.scheduling.generateAvailability(principal, input);
    const provider = await this.requireProvider(principal);
    const from = this.dateOnly(input.fromDate, "fromDate");
    const to = new Date(this.dateOnly(input.toDate, "toDate").getTime() + 24 * 60 * 60 * 1000);
    const exceptions = await this.prisma.availabilityException.findMany({ where: { providerId: provider.id, active: true, startsAt: { lt: to }, endsAt: { gt: from } } });
    let blockedByExceptions = 0;
    for (const exception of exceptions) blockedByExceptions += await this.blockSlots(exception);
    return { ...result, blockedByExceptions };
  }

  async unblockSlot(principal: AuthPrincipal, slotId: string) {
    const provider = await this.requireProvider(principal);
    const slot = await this.prisma.availabilitySlot.findUnique({ where: { id: this.text(slotId, 1, 128, "slotId") } });
    if (!slot || slot.providerId !== provider.id) throw new NotFoundException("Availability slot not found.");
    if (slot.bookedCount > 0) throw new ConflictException("A booked slot cannot be unblocked manually.");
    const activeException = await this.prisma.availabilityException.findFirst({
      where: {
        providerId: provider.id,
        active: true,
        startsAt: { lt: slot.endsAt },
        endsAt: { gt: slot.startsAt },
        OR: [{ serviceId: null }, { serviceId: slot.serviceId }],
        AND: [{ OR: [{ modality: null }, { modality: slot.modality }] }],
      },
      select: { id: true },
    });
    if (activeException) throw new ConflictException("Slot remains covered by an active availability exception.");
    const updated = await this.prisma.availabilitySlot.update({ where: { id: slot.id }, data: { status: "OPEN", version: { increment: 1 } } });
    await this.audit.write({ actorId: principal.accountId, action: "AVAILABILITY_SLOT_UNBLOCKED", objectType: "AVAILABILITY_SLOT", objectId: slot.id, purpose: "SCHEDULING_CONFIGURATION", result: "SUCCESS" });
    return updated;
  }

  private async assertNoActiveAppointments(providerId: string, startsAt: Date, endsAt: Date, serviceId: string | null, modality: AppointmentModality | null) {
    const where: Prisma.AppointmentWhereInput = {
      providerId,
      startsAt: { lt: endsAt },
      endsAt: { gt: startsAt },
      status: { in: ["REQUESTED", "CONFIRMED"] },
    };
    if (serviceId) where.serviceId = serviceId;
    if (modality) where.modality = modality;
    if (await this.prisma.appointment.count({ where }) > 0) throw new ConflictException("Availability exception overlaps an active appointment. Resolve or reschedule the booking first.");
  }

  private async blockSlots(exception: { providerId: string; serviceId: string | null; modality: AppointmentModality | null; startsAt: Date; endsAt: Date; active: boolean }) {
    if (!exception.active) return 0;
    const where: Prisma.AvailabilitySlotWhereInput = { providerId: exception.providerId, status: "OPEN", bookedCount: 0, startsAt: { lt: exception.endsAt }, endsAt: { gt: exception.startsAt } };
    if (exception.serviceId) where.serviceId = exception.serviceId;
    if (exception.modality) where.modality = exception.modality;
    return (await this.prisma.availabilitySlot.updateMany({ where, data: { status: "BLOCKED", version: { increment: 1 } } })).count;
  }

  private async requireProvider(principal: AuthPrincipal) {
    if (principal.role !== "DOCTOR" && principal.role !== "OTHER_PROVIDER") throw new ForbiddenException("A provider account is required.");
    const provider = await this.prisma.provider.findUnique({ where: { userId: principal.accountId } });
    if (!provider || provider.status !== "ACTIVE") throw new ForbiddenException("Provider must be active before managing availability.");
    return provider;
  }

  private async ownedService(providerId: string, serviceId: string) {
    const service = await this.prisma.service.findUnique({ where: { id: this.text(serviceId, 1, 128, "serviceId") } });
    if (!service || service.providerId !== providerId) throw new NotFoundException("Service not found.");
    return service;
  }

  private modality(value: string): AppointmentModality { if (value !== "CLINIC" && value !== "TELEMEDICINE" && value !== "HOME_VISIT") throw new BadRequestException("Unsupported appointment modality."); return value; }
  private text(value: unknown, min: number, max: number, field: string) { if (typeof value !== "string") throw new BadRequestException(`${field} must be text.`); const text = value.trim(); if (text.length < min || text.length > max) throw new BadRequestException(`${field} must contain between ${min} and ${max} characters.`); return text; }
  private optional(value: unknown, max: number, field: string) { if (value === undefined || value === null || value === "") return null; return this.text(value, 1, max, field); }
  private integer(value: unknown, min: number, max: number, field: string) { if (!Number.isInteger(value) || Number(value) < min || Number(value) > max) throw new BadRequestException(`${field} must be an integer between ${min} and ${max}.`); return Number(value); }
  private date(value: unknown, field: string) { if (typeof value !== "string" || !value.trim()) throw new BadRequestException(`${field} is required.`); const date = new Date(value); if (!Number.isFinite(date.getTime())) throw new BadRequestException(`${field} must be a valid ISO date-time.`); return date; }
  private dateOnly(value: unknown, field: string) { if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new BadRequestException(`${field} must use YYYY-MM-DD.`); const date = new Date(`${value}T00:00:00.000Z`); if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new BadRequestException(`${field} is invalid.`); return date; }
}
