import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, type AppointmentModality } from "@prisma/client";
import type { AuthPrincipal } from "@carepoint/identity";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { SchedulingService } from "./scheduling.service";
import type { HomeVisitBookingInput, Release1BookingInput } from "./release1-scheduling-context.types";

const BOOKING_RETRIES = 3;

type VisitContextCreate = {
  modality: AppointmentModality;
  sourceProviderLocationId?: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  region?: string;
  postalCode?: string;
  countryCode: string;
  latitude: number;
  longitude: number;
  instructions?: string;
  contactPhone?: string;
  contactConfirmedAt?: Date;
  addressValidatedAt?: Date;
};

@Injectable()
export class Release1ContextualBookingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
    private readonly scheduling: SchedulingService,
  ) {}

  async book(principal: AuthPrincipal, input: Release1BookingInput) {
    if (principal.role !== "PATIENT") throw new ForbiddenException("Only patients can create appointments.");
    const slotId = this.text(input.slotId, 1, 128, "slotId");
    const idempotencyKey = this.text(input.idempotencyKey, 8, 128, "idempotencyKey");
    const patient = await this.prisma.patientProfile.findUnique({ where: { userId: principal.accountId } });
    if (!patient) throw new BadRequestException("Patient profile is required before booking.");

    const existing = await this.prisma.appointment.findUnique({ where: { idempotencyKey } });
    if (existing) {
      if (existing.patientId !== patient.id) throw new ConflictException("idempotencyKey is already in use.");
      return this.presentAppointment(existing.id);
    }

    for (let attempt = 1; attempt <= BOOKING_RETRIES; attempt += 1) {
      try {
        const result = await this.prisma.$transaction(async (tx) => {
          const duplicate = await tx.appointment.findUnique({ where: { idempotencyKey } });
          if (duplicate) {
            if (duplicate.patientId !== patient.id) throw new ConflictException("idempotencyKey is already in use.");
            return { appointmentId: duplicate.id, created: false };
          }
          const slot = await tx.availabilitySlot.findUnique({ where: { id: slotId }, include: { service: { include: { modalities: true } }, provider: true } });
          if (!slot || slot.status !== "OPEN" || !slot.service.active || slot.provider.status !== "ACTIVE") throw new ConflictException("The selected slot is not available.");
          if (slot.startsAt.getTime() <= Date.now()) throw new ConflictException("The selected slot is no longer in the future.");
          const modalityConfig = slot.service.modalities.find((item) => item.modality === slot.modality && item.active);
          if (!modalityConfig) throw new ConflictException("The selected service modality is no longer active.");

          const visitContext = await this.resolveVisitContext(tx, slot.serviceId, slot.providerId, slot.modality, input.homeVisit);
          const inventory = await tx.availabilitySlot.updateMany({ where: { id: slot.id, status: "OPEN", bookedCount: { lt: slot.capacity } }, data: { bookedCount: { increment: 1 }, version: { increment: 1 } } });
          if (inventory.count !== 1) throw new ConflictException("The selected slot has just been booked by another patient.");

          const appointment = await tx.appointment.create({
            data: { patientId: patient.id, providerId: slot.providerId, serviceId: slot.serviceId, slotId: slot.id, idempotencyKey, modality: slot.modality, status: "CONFIRMED", startsAt: slot.startsAt, endsAt: slot.endsAt },
          });
          if (visitContext) await tx.appointmentVisitContext.create({ data: { appointmentId: appointment.id, ...visitContext } });
          return { appointmentId: appointment.id, created: true };
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

        if (result.created) {
          await this.audit.write({ actorId: principal.accountId, action: "APPOINTMENT_BOOKED", objectType: "APPOINTMENT", objectId: result.appointmentId, result: "SUCCESS", metadata: { slotId, structuredVisitContext: true } });
        }
        return this.presentAppointment(result.appointmentId);
      } catch (error) {
        if (this.prismaError(error, "P2034") && attempt < BOOKING_RETRIES) continue;
        if (this.prismaError(error, "P2002")) {
          const duplicate = await this.prisma.appointment.findUnique({ where: { idempotencyKey } });
          if (duplicate?.patientId === patient.id) return this.presentAppointment(duplicate.id);
          throw new ConflictException("The booking request was already processed.");
        }
        if (this.prismaError(error, "P2004")) throw new ConflictException("The selected time conflicts with another active appointment.");
        throw error;
      }
    }
    throw new ConflictException("The booking could not be completed because of concurrent activity. Please retry.");
  }

  async listPatientAppointments(principal: AuthPrincipal) {
    return this.enrichAppointments(await this.scheduling.listPatientAppointments(principal));
  }

  async listProviderAppointments(principal: AuthPrincipal, input: { from?: string; to?: string }) {
    return this.enrichAppointments(await this.scheduling.listProviderAppointments(principal, input));
  }

  private strictClinicContextRequired() {
    return process.env.NODE_ENV === "production" || process.env.RELEASE1_TEST_STRICT_VISIT_CONTEXT === "true";
  }

  private async resolveVisitContext(tx: Prisma.TransactionClient, serviceId: string, providerId: string, modality: AppointmentModality, homeVisit?: HomeVisitBookingInput): Promise<VisitContextCreate | null> {
    if (modality === "TELEMEDICINE") return null;
    if (modality === "CLINIC") return this.clinicContext(tx, serviceId, providerId);
    return this.homeVisitContext(tx, serviceId, homeVisit);
  }

  private async clinicContext(tx: Prisma.TransactionClient, serviceId: string, providerId: string): Promise<VisitContextCreate | null> {
    const delivery = await tx.serviceDeliveryContext.findUnique({ where: { serviceId_modality: { serviceId, modality: "CLINIC" } } });
    if (!delivery?.clinicLocationId) {
      if (this.strictClinicContextRequired()) throw new ConflictException("Clinic service is missing its Release 1 location context.");
      return null;
    }
    const location = await tx.providerLocation.findUnique({ where: { id: delivery.clinicLocationId } });
    if (!location || location.providerId !== providerId || !location.active || !location.addressValidatedAt) throw new ConflictException("Clinic location is not active and validated.");
    const instructions = delivery.clinicArrivalInstructions?.trim() || location.arrivalInstructions?.trim();
    if (!instructions) throw new ConflictException("Clinic arrival instructions are required before booking.");
    return {
      modality: "CLINIC",
      sourceProviderLocationId: location.id,
      addressLine1: location.addressLine1,
      ...(location.addressLine2 ? { addressLine2: location.addressLine2 } : {}),
      city: location.city,
      ...(location.region ? { region: location.region } : {}),
      ...(location.postalCode ? { postalCode: location.postalCode } : {}),
      countryCode: location.countryCode,
      latitude: Number(location.latitude),
      longitude: Number(location.longitude),
      instructions,
      addressValidatedAt: location.addressValidatedAt,
    };
  }

  private async homeVisitContext(tx: Prisma.TransactionClient, serviceId: string, homeVisit?: HomeVisitBookingInput): Promise<VisitContextCreate> {
    const addressLine1 = this.text(homeVisit?.addressLine1, 3, 300, "homeVisit.addressLine1");
    const city = this.text(homeVisit?.city, 1, 120, "homeVisit.city");
    const countryCode = this.country(homeVisit?.countryCode);
    const latitude = this.latitude(homeVisit?.latitude);
    const longitude = this.longitude(homeVisit?.longitude);
    const contactPhone = this.text(homeVisit?.contactPhone, 5, 40, "homeVisit.contactPhone");
    if (homeVisit?.contactConfirmed !== true) throw new BadRequestException("homeVisit.contactConfirmed must be true before booking.");
    if (homeVisit?.addressValidated !== true) throw new BadRequestException("homeVisit.addressValidated must be true before booking.");

    const delivery = await tx.serviceDeliveryContext.findUnique({ where: { serviceId_modality: { serviceId, modality: "HOME_VISIT" } } });
    if (delivery?.homeCoverageRadiusKm !== null && delivery?.homeCoverageRadiusKm !== undefined) {
      if (delivery.homeCoverageCenterLatitude === null || delivery.homeCoverageCenterLongitude === null) throw new ConflictException("Home-visit coverage configuration is incomplete.");
      const distance = this.distanceKm(latitude, longitude, Number(delivery.homeCoverageCenterLatitude), Number(delivery.homeCoverageCenterLongitude));
      if (distance > Number(delivery.homeCoverageRadiusKm)) throw new ConflictException("Home-visit address is outside the configured service coverage.");
    }

    const addressLine2 = this.optional(homeVisit?.addressLine2, 300, "homeVisit.addressLine2");
    const region = this.optional(homeVisit?.region, 120, "homeVisit.region");
    const postalCode = this.optional(homeVisit?.postalCode, 40, "homeVisit.postalCode");
    const instructions = this.optional(homeVisit?.instructions, 1_000, "homeVisit.instructions");
    return {
      modality: "HOME_VISIT",
      addressLine1,
      ...(addressLine2 ? { addressLine2 } : {}),
      city,
      ...(region ? { region } : {}),
      ...(postalCode ? { postalCode } : {}),
      countryCode,
      latitude,
      longitude,
      ...(instructions ? { instructions } : {}),
      contactPhone,
      contactConfirmedAt: new Date(),
      addressValidatedAt: new Date(),
    };
  }

  private async presentAppointment(appointmentId: string) {
    const appointment = await this.prisma.appointment.findUnique({ where: { id: appointmentId }, include: { service: true, provider: true, slot: true } });
    if (!appointment) throw new NotFoundException("Appointment not found.");
    const context = await this.prisma.appointmentVisitContext.findUnique({ where: { appointmentId } });
    return { ...appointment, visitContext: context ? this.presentContext(context) : null };
  }

  private async enrichAppointments<T extends { id: string }>(rows: T[]) {
    if (!rows.length) return rows.map((row) => ({ ...row, visitContext: null }));
    const contexts = await this.prisma.appointmentVisitContext.findMany({ where: { appointmentId: { in: rows.map((row) => row.id) } } });
    const byAppointment = new Map(contexts.map((row) => [row.appointmentId, row]));
    return rows.map((row) => ({ ...row, visitContext: byAppointment.has(row.id) ? this.presentContext(byAppointment.get(row.id)!) : null }));
  }

  private presentContext(context: { id: string; appointmentId: string; modality: AppointmentModality; sourceProviderLocationId: string | null; addressLine1: string; addressLine2: string | null; city: string; region: string | null; postalCode: string | null; countryCode: string; latitude: Prisma.Decimal; longitude: Prisma.Decimal; instructions: string | null; contactPhone: string | null; contactConfirmedAt: Date | null; addressValidatedAt: Date | null; createdAt: Date; updatedAt: Date }) {
    return { ...context, latitude: Number(context.latitude), longitude: Number(context.longitude), addressValidated: Boolean(context.addressValidatedAt), contactConfirmed: Boolean(context.contactConfirmedAt), navigation: { latitude: Number(context.latitude), longitude: Number(context.longitude) } };
  }

  private text(value: unknown, min: number, max: number, field: string) { if (typeof value !== "string") throw new BadRequestException(`${field} must be text.`); const text = value.trim(); if (text.length < min || text.length > max) throw new BadRequestException(`${field} must contain between ${min} and ${max} characters.`); return text; }
  private optional(value: unknown, max: number, field: string) { if (value === undefined || value === null || value === "") return null; return this.text(value, 1, max, field); }
  private country(value: unknown) { const code = this.text(value, 2, 2, "homeVisit.countryCode").toUpperCase(); if (!/^[A-Z]{2}$/.test(code)) throw new BadRequestException("homeVisit.countryCode must use a two-letter ISO-style code."); return code; }
  private latitude(value: unknown) { if (typeof value !== "number" || !Number.isFinite(value) || value < -90 || value > 90) throw new BadRequestException("homeVisit.latitude must be between -90 and 90."); return value; }
  private longitude(value: unknown) { if (typeof value !== "number" || !Number.isFinite(value) || value < -180 || value > 180) throw new BadRequestException("homeVisit.longitude must be between -180 and 180."); return value; }
  private distanceKm(lat1: number, lon1: number, lat2: number, lon2: number) { const rad = (d: number) => d * Math.PI / 180; const dLat = rad(lat2 - lat1); const dLon = rad(lon2 - lon1); const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2; return 6_371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)); }
  private prismaError(error: unknown, code: string) { return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code; }
}
