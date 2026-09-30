import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, type AppointmentModality } from "@prisma/client";
import type {
  CreateAvailabilityRuleInput,
  CreateBookingInput,
  CreateProviderServiceInput,
  LocalizedText,
} from "@carepoint/contracts";
import { roleHasPermission, type AuthPrincipal } from "@carepoint/identity";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";

dayjs.extend(utc);
dayjs.extend(timezone);

const MAX_GENERATION_DAYS = 31;
const MAX_SEARCH_DAYS = 62;
const BOOKING_RETRIES = 3;

@Injectable()
export class SchedulingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
  ) {}

  async listProviderServices(principal: AuthPrincipal) {
    const provider = await this.requireActiveProvider(principal);
    return this.prisma.service.findMany({
      where: { providerId: provider.id },
      include: { modalities: { orderBy: { modality: "asc" } } },
      orderBy: { createdAt: "desc" },
    });
  }

  async createProviderService(principal: AuthPrincipal, input: CreateProviderServiceInput) {
    const provider = await this.requireActiveProvider(principal);
    this.requireLabels(input.labels);
    if (input.descriptionLabels) this.requireLabels(input.descriptionLabels);
    const currency = input.currency?.trim().toUpperCase();
    if (!currency || !/^[A-Z]{3}$/.test(currency)) throw new BadRequestException("currency must be a 3-letter ISO code.");
    if (!Array.isArray(input.modalities) || input.modalities.length === 0) throw new BadRequestException("At least one service modality is required.");

    const seen = new Set<string>();
    const modalities = input.modalities.map((item) => {
      if (!["CLINIC", "TELEMEDICINE", "HOME_VISIT"].includes(item.modality)) throw new BadRequestException(`Unsupported modality: ${item.modality}`);
      if (seen.has(item.modality)) throw new BadRequestException(`Duplicate modality: ${item.modality}`);
      seen.add(item.modality);
      if (!Number.isInteger(item.durationMinutes) || item.durationMinutes < 5 || item.durationMinutes > 480) throw new BadRequestException("durationMinutes must be an integer between 5 and 480.");
      if (!Number.isInteger(item.priceMinor) || item.priceMinor < 0) throw new BadRequestException("priceMinor must be a non-negative integer.");
      return { modality: item.modality, durationMinutes: item.durationMinutes, priceMinor: item.priceMinor };
    });

    const service = await this.prisma.service.create({
      data: {
        providerId: provider.id,
        name: input.labels.en.trim(),
        labels: input.labels as unknown as Prisma.InputJsonValue,
        description: input.descriptionLabels?.en.trim() || null,
        descriptionLabels: input.descriptionLabels ? (input.descriptionLabels as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
        currency,
        modalities: { create: modalities },
      },
      include: { modalities: true },
    });
    await this.audit.write({ actorId: principal.accountId, action: "SERVICE_CREATED", objectType: "SERVICE", objectId: service.id, result: "SUCCESS", metadata: { providerId: provider.id, modalities: [...seen] } });
    return service;
  }

  async setServiceActive(principal: AuthPrincipal, serviceId: string, active: boolean) {
    const provider = await this.requireActiveProvider(principal);
    const service = await this.requireOwnedService(provider.id, serviceId);
    const updated = await this.prisma.service.update({ where: { id: service.id }, data: { active } });
    await this.audit.write({ actorId: principal.accountId, action: active ? "SERVICE_ACTIVATED" : "SERVICE_DEACTIVATED", objectType: "SERVICE", objectId: service.id, result: "SUCCESS" });
    return updated;
  }

  async listAvailabilityRules(principal: AuthPrincipal) {
    const provider = await this.requireActiveProvider(principal);
    return this.prisma.availabilityRule.findMany({
      where: { providerId: provider.id },
      include: { service: { include: { modalities: true } } },
      orderBy: [{ active: "desc" }, { weekday: "asc" }, { startMinute: "asc" }],
    });
  }

  async createAvailabilityRule(principal: AuthPrincipal, input: CreateAvailabilityRuleInput) {
    const provider = await this.requireActiveProvider(principal);
    const service = await this.requireOwnedService(provider.id, input.serviceId);
    if (!service.active) throw new ConflictException("Service must be active before availability can be configured.");
    const modality = this.parseModality(input.modality);
    const modalityConfig = await this.prisma.serviceModality.findUnique({ where: { serviceId_modality: { serviceId: service.id, modality } } });
    if (!modalityConfig?.active) throw new BadRequestException("The selected modality is not active for this service.");
    this.validateTimezone(input.timezone);
    if (!Number.isInteger(input.weekday) || input.weekday < 0 || input.weekday > 6) throw new BadRequestException("weekday must be an integer from 0 (Sunday) to 6 (Saturday).");
    if (!Number.isInteger(input.startMinute) || !Number.isInteger(input.endMinute) || input.startMinute < 0 || input.endMinute > 1440 || input.startMinute >= input.endMinute) throw new BadRequestException("Availability minutes must define a valid range within the day.");
    if (!Number.isInteger(input.intervalMinutes) || input.intervalMinutes < modalityConfig.durationMinutes) throw new BadRequestException("intervalMinutes must be at least the service duration.");
    const slotCapacity = input.slotCapacity ?? 1;
    if (!Number.isInteger(slotCapacity) || slotCapacity < 1 || slotCapacity > 100) throw new BadRequestException("slotCapacity must be an integer between 1 and 100.");
    const effectiveFrom = this.parseDateOnly(input.effectiveFrom, "effectiveFrom");
    const effectiveUntil = input.effectiveUntil ? this.parseDateOnly(input.effectiveUntil, "effectiveUntil") : null;
    if (effectiveUntil && effectiveUntil < effectiveFrom) throw new BadRequestException("effectiveUntil cannot be before effectiveFrom.");

    const rule = await this.prisma.availabilityRule.create({
      data: {
        providerId: provider.id,
        serviceId: service.id,
        modality,
        timezone: input.timezone,
        weekday: input.weekday,
        startMinute: input.startMinute,
        endMinute: input.endMinute,
        intervalMinutes: input.intervalMinutes,
        slotCapacity,
        effectiveFrom,
        effectiveUntil,
      },
    });
    await this.audit.write({ actorId: principal.accountId, action: "AVAILABILITY_RULE_CREATED", objectType: "AVAILABILITY_RULE", objectId: rule.id, result: "SUCCESS", metadata: { providerId: provider.id, serviceId: service.id, modality } });
    return rule;
  }

  async generateAvailability(principal: AuthPrincipal, input: { fromDate: string; toDate: string; ruleId?: string }) {
    const provider = await this.requireActiveProvider(principal);
    const from = this.parseDateOnly(input.fromDate, "fromDate");
    const to = this.parseDateOnly(input.toDate, "toDate");
    const start = dayjs.utc(from);
    const end = dayjs.utc(to);
    const days = end.diff(start, "day");
    if (days < 0 || days >= MAX_GENERATION_DAYS) throw new BadRequestException(`Availability generation is limited to ${MAX_GENERATION_DAYS} days per request.`);

    const rules = await this.prisma.availabilityRule.findMany({
      where: { providerId: provider.id, active: true, ...(input.ruleId ? { id: input.ruleId } : {}) },
      include: { service: { include: { modalities: true } } },
    });
    if (input.ruleId && rules.length === 0) throw new NotFoundException("Availability rule not found.");

    const candidates: Prisma.AvailabilitySlotCreateManyInput[] = [];
    for (let dayOffset = 0; dayOffset <= days; dayOffset += 1) {
      const dateText = start.add(dayOffset, "day").format("YYYY-MM-DD");
      for (const rule of rules) {
        const effectiveFrom = dayjs.utc(rule.effectiveFrom).format("YYYY-MM-DD");
        const effectiveUntil = rule.effectiveUntil ? dayjs.utc(rule.effectiveUntil).format("YYYY-MM-DD") : null;
        if (dateText < effectiveFrom || (effectiveUntil && dateText > effectiveUntil)) continue;
        const localNoon = dayjs.tz(`${dateText}T12:00:00`, rule.timezone);
        if (localNoon.day() !== rule.weekday) continue;
        const modalityConfig = rule.service.modalities.find((item) => item.modality === rule.modality && item.active);
        if (!modalityConfig || !rule.service.active) continue;

        for (let minute = rule.startMinute; minute + modalityConfig.durationMinutes <= rule.endMinute; minute += rule.intervalMinutes) {
          const hour = Math.floor(minute / 60).toString().padStart(2, "0");
          const mins = (minute % 60).toString().padStart(2, "0");
          const localStart = dayjs.tz(`${dateText}T${hour}:${mins}:00`, rule.timezone);
          if (!localStart.isValid()) continue;
          const localEnd = localStart.add(modalityConfig.durationMinutes, "minute");
          candidates.push({
            providerId: provider.id,
            serviceId: rule.serviceId,
            modality: rule.modality,
            startsAt: localStart.toDate(),
            endsAt: localEnd.toDate(),
            capacity: rule.slotCapacity,
            sourceRuleId: rule.id,
          });
        }
      }
    }

    const result = candidates.length > 0 ? await this.prisma.availabilitySlot.createMany({ data: candidates, skipDuplicates: true }) : { count: 0 };
    await this.audit.write({ actorId: principal.accountId, action: "AVAILABILITY_GENERATED", objectType: "PROVIDER", objectId: provider.id, result: "SUCCESS", metadata: { candidateCount: candidates.length, createdCount: result.count, fromDate: input.fromDate, toDate: input.toDate } });
    return { candidateCount: candidates.length, createdCount: result.count };
  }

  async blockSlot(principal: AuthPrincipal, slotId: string) {
    const provider = await this.requireActiveProvider(principal);
    const slot = await this.prisma.availabilitySlot.findUnique({ where: { id: slotId } });
    if (!slot || slot.providerId !== provider.id) throw new NotFoundException("Availability slot not found.");
    if (slot.bookedCount > 0) throw new ConflictException("A slot with confirmed bookings cannot be blocked.");
    const updated = await this.prisma.availabilitySlot.update({ where: { id: slot.id }, data: { status: "BLOCKED", version: { increment: 1 } } });
    await this.audit.write({ actorId: principal.accountId, action: "AVAILABILITY_SLOT_BLOCKED", objectType: "AVAILABILITY_SLOT", objectId: slot.id, result: "SUCCESS" });
    return updated;
  }

  async searchServices(input: { q?: string; modality?: string }) {
    const modality = input.modality ? this.parseModality(input.modality) : null;
    const q = input.q?.trim();
    const where: Prisma.ServiceWhereInput = {
      active: true,
      provider: { status: "ACTIVE" },
      modalities: { some: { active: true, ...(modality ? { modality } : {}) } },
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { provider: { displayName: { contains: q, mode: "insensitive" } } },
            ],
          }
        : {}),
    };
    return this.prisma.service.findMany({
      where,
      include: {
        modalities: { where: { active: true, ...(modality ? { modality } : {}) }, orderBy: { modality: "asc" } },
        provider: {
          include: {
            doctorProfile: { include: { specialties: { include: { specialty: true } } } },
            otherProviderProfile: { include: { category: true } },
          },
        },
      },
      orderBy: [{ provider: { displayName: "asc" } }, { name: "asc" }],
      take: 100,
    });
  }

  async searchAvailability(input: { serviceId: string; modality: string; from?: string; to?: string }) {
    if (!input.serviceId?.trim()) throw new BadRequestException("serviceId is required.");
    const modality = this.parseModality(input.modality);
    const from = input.from ? new Date(input.from) : new Date();
    const to = input.to ? new Date(input.to) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) throw new BadRequestException("A valid from/to interval is required.");
    if (to.getTime() - from.getTime() > MAX_SEARCH_DAYS * 24 * 60 * 60 * 1000) throw new BadRequestException(`Availability search is limited to ${MAX_SEARCH_DAYS} days.`);

    const slots = await this.prisma.availabilitySlot.findMany({
      where: { serviceId: input.serviceId, modality, status: "OPEN", startsAt: { gte: from, lt: to }, service: { active: true, provider: { status: "ACTIVE" } } },
      include: { service: { include: { modalities: { where: { modality, active: true } } } }, provider: { select: { id: true, class: true, displayName: true } } },
      orderBy: { startsAt: "asc" },
      take: 500,
    });
    return slots.filter((slot) => slot.bookedCount < slot.capacity).map((slot) => ({ ...slot, remainingCapacity: slot.capacity - slot.bookedCount }));
  }

  async book(principal: AuthPrincipal, input: CreateBookingInput) {
    if (principal.role !== "PATIENT") throw new ForbiddenException("Only patients can create appointments.");
    if (!input.slotId?.trim()) throw new BadRequestException("slotId is required.");
    if (!input.idempotencyKey?.trim() || input.idempotencyKey.length < 8 || input.idempotencyKey.length > 128) throw new BadRequestException("idempotencyKey must contain between 8 and 128 characters.");
    const patient = await this.prisma.patientProfile.findUnique({ where: { userId: principal.accountId } });
    if (!patient) throw new BadRequestException("Patient profile is required before booking.");

    const existing = await this.prisma.appointment.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (existing) {
      if (existing.patientId !== patient.id) throw new ConflictException("idempotencyKey is already in use.");
      return existing;
    }

    for (let attempt = 1; attempt <= BOOKING_RETRIES; attempt += 1) {
      try {
        const appointment = await this.prisma.$transaction(
          async (tx) => {
            const duplicate = await tx.appointment.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
            if (duplicate) {
              if (duplicate.patientId !== patient.id) throw new ConflictException("idempotencyKey is already in use.");
              return duplicate;
            }
            const slot = await tx.availabilitySlot.findUnique({
              where: { id: input.slotId },
              include: { service: { include: { modalities: true } }, provider: true },
            });
            if (!slot || slot.status !== "OPEN" || !slot.service.active || slot.provider.status !== "ACTIVE") throw new ConflictException("The selected slot is not available.");
            if (slot.startsAt.getTime() <= Date.now()) throw new ConflictException("The selected slot is no longer in the future.");
            const modalityConfig = slot.service.modalities.find((item) => item.modality === slot.modality && item.active);
            if (!modalityConfig) throw new ConflictException("The selected service modality is no longer active.");

            const inventory = await tx.availabilitySlot.updateMany({
              where: { id: slot.id, status: "OPEN", bookedCount: { lt: slot.capacity } },
              data: { bookedCount: { increment: 1 }, version: { increment: 1 } },
            });
            if (inventory.count !== 1) throw new ConflictException("The selected slot has just been booked by another patient.");

            return tx.appointment.create({
              data: {
                patientId: patient.id,
                providerId: slot.providerId,
                serviceId: slot.serviceId,
                slotId: slot.id,
                idempotencyKey: input.idempotencyKey,
                modality: slot.modality,
                status: "CONFIRMED",
                startsAt: slot.startsAt,
                endsAt: slot.endsAt,
              },
              include: { service: true, provider: true },
            });
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
        await this.audit.write({ actorId: principal.accountId, action: "APPOINTMENT_BOOKED", objectType: "APPOINTMENT", objectId: appointment.id, result: "SUCCESS", metadata: { slotId: input.slotId, serviceId: appointment.serviceId, modality: appointment.modality } });
        return appointment;
      } catch (error) {
        if (this.isPrismaError(error, "P2034") && attempt < BOOKING_RETRIES) continue;
        if (this.isPrismaError(error, "P2002")) {
          const duplicate = await this.prisma.appointment.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
          if (duplicate?.patientId === patient.id) return duplicate;
          throw new ConflictException("The booking request was already processed.");
        }
        if (this.isPrismaError(error, "P2004")) throw new ConflictException("The selected time conflicts with another active appointment.");
        throw error;
      }
    }
    throw new ConflictException("The booking could not be completed because of concurrent activity. Please retry.");
  }

  async listPatientAppointments(principal: AuthPrincipal) {
    if (principal.role !== "PATIENT") throw new ForbiddenException("Only patients can list patient appointments.");
    const patient = await this.prisma.patientProfile.findUnique({ where: { userId: principal.accountId } });
    if (!patient) throw new NotFoundException("Patient profile not found.");
    return this.prisma.appointment.findMany({
      where: { patientId: patient.id },
      include: { service: true, provider: true, slot: true },
      orderBy: { startsAt: "desc" },
      take: 200,
    });
  }

  async cancelAppointment(principal: AuthPrincipal, appointmentId: string, reason?: string) {
    const appointment = await this.prisma.appointment.findUnique({ where: { id: appointmentId }, include: { patient: { select: { userId: true } } } });
    if (!appointment) throw new NotFoundException("Appointment not found.");
    const mayOperate = roleHasPermission(principal.role, "APPOINTMENT_OPERATE");
    if (appointment.patient.userId !== principal.accountId && !mayOperate) throw new ForbiddenException("Appointment access denied.");
    if (appointment.status !== "CONFIRMED" && appointment.status !== "REQUESTED") throw new ConflictException("Only active appointments can be cancelled.");
    const cancellationReason = reason?.trim() || null;
    if (cancellationReason && cancellationReason.length > 500) throw new BadRequestException("cancellationReason cannot exceed 500 characters.");

    const updated = await this.prisma.$transaction(async (tx) => {
      const current = await tx.appointment.findUnique({ where: { id: appointment.id } });
      if (!current || (current.status !== "CONFIRMED" && current.status !== "REQUESTED")) throw new ConflictException("Appointment is no longer active.");
      const cancelled = await tx.appointment.update({ where: { id: current.id }, data: { status: "CANCELLED", cancelledAt: new Date(), cancellationReason } });
      if (current.slotId) {
        await tx.availabilitySlot.updateMany({ where: { id: current.slotId, bookedCount: { gt: 0 } }, data: { bookedCount: { decrement: 1 }, version: { increment: 1 } } });
      }
      return cancelled;
    });
    await this.audit.write({ actorId: principal.accountId, action: "APPOINTMENT_CANCELLED", objectType: "APPOINTMENT", objectId: updated.id, result: "SUCCESS", metadata: { reason: cancellationReason } });
    return updated;
  }

  async listProviderAppointments(principal: AuthPrincipal, input: { from?: string; to?: string }) {
    const provider = await this.requireActiveProvider(principal);
    const from = input.from ? new Date(input.from) : new Date(Date.now() - 24 * 60 * 60 * 1000);
    const to = input.to ? new Date(input.to) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) throw new BadRequestException("A valid from/to interval is required.");
    return this.prisma.appointment.findMany({
      where: { providerId: provider.id, startsAt: { gte: from, lt: to } },
      include: { service: true, patient: { select: { id: true, firstName: true, lastName: true } }, slot: true },
      orderBy: { startsAt: "asc" },
      take: 500,
    });
  }

  private async requireActiveProvider(principal: AuthPrincipal) {
    if (principal.role !== "DOCTOR" && principal.role !== "OTHER_PROVIDER") throw new ForbiddenException("A provider account is required.");
    const provider = await this.prisma.provider.findUnique({ where: { userId: principal.accountId } });
    if (!provider || provider.status !== "ACTIVE") throw new ForbiddenException("Provider must be active before managing services or availability.");
    return provider;
  }

  private async requireOwnedService(providerId: string, serviceId: string) {
    const service = await this.prisma.service.findUnique({ where: { id: serviceId } });
    if (!service || service.providerId !== providerId) throw new NotFoundException("Service not found.");
    return service;
  }

  private requireLabels(labels: LocalizedText): void {
    if (!labels?.en?.trim() || !labels?.ar?.trim() || !labels?.fr?.trim() || !labels?.es?.trim()) throw new BadRequestException("EN/AR/FR/ES labels are required.");
  }

  private parseModality(value: string): AppointmentModality {
    if (value !== "CLINIC" && value !== "TELEMEDICINE" && value !== "HOME_VISIT") throw new BadRequestException("Unsupported appointment modality.");
    return value;
  }

  private validateTimezone(value: string): void {
    if (!value?.trim()) throw new BadRequestException("timezone is required.");
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date());
    } catch {
      throw new BadRequestException("timezone must be a valid IANA time zone.");
    }
  }

  private parseDateOnly(value: string, field: string): Date {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? "")) throw new BadRequestException(`${field} must use YYYY-MM-DD.`);
    const date = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new BadRequestException(`${field} is invalid.`);
    return date;
  }

  private isPrismaError(error: unknown, code: string): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;
  }
}
