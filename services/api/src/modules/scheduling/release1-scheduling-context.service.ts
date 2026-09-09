import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, type AppointmentModality } from "@prisma/client";
import type { AuthPrincipal } from "@carepoint/identity";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { SchedulingService } from "./scheduling.service";

const BOOKING_RETRIES = 3;
const MAX_EXCEPTION_DAYS = 366;
const MAX_DISCOVERY_PAGE = 1_000;
const MAX_DISCOVERY_LIMIT = 50;

type ClinicDeliveryContextInput = {
  clinicLocationId?: string;
  clinicArrivalInstructions?: string;
};

type HomeVisitCoverageInput = {
  centerLatitude: number;
  centerLongitude: number;
  radiusKm: number;
};

type Release1ServiceModalityInput = {
  modality: AppointmentModality;
  durationMinutes: number;
  priceMinor: number;
  clinicLocationId?: string;
  clinicArrivalInstructions?: string;
  homeVisitCoverage?: HomeVisitCoverageInput;
};

type Release1DeliveryContextInput = {
  clinicLocationId?: string;
  clinicArrivalInstructions?: string;
  homeVisitCoverage?: HomeVisitCoverageInput;
};

type Release1AvailabilityRuleInput = {
  serviceId: string;
  modality: AppointmentModality;
  timezone: string;
  weekday: number;
  startMinute: number;
  endMinute: number;
  intervalMinutes: number;
  slotCapacity?: number;
  effectiveFrom: string;
  effectiveUntil?: string;
  bufferBeforeMinutes?: number;
  bufferAfterMinutes?: number;
};

type ProviderLocationInput = {
  label?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  region?: string;
  postalCode?: string;
  countryCode?: string;
  latitude?: number;
  longitude?: number;
  arrivalInstructions?: string;
  addressValidated?: boolean;
};

type AvailabilityExceptionInput = {
  serviceId?: string;
  modality?: AppointmentModality;
  kind?: "UNAVAILABLE" | "VACATION";
  startsAt?: string;
  endsAt?: string;
  reason?: string;
};

type HomeVisitBookingInput = {
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  region?: string;
  postalCode?: string;
  countryCode?: string;
  latitude?: number;
  longitude?: number;
  instructions?: string;
  contactPhone?: string;
  contactConfirmed?: boolean;
  addressValidated?: boolean;
};

type Release1BookingInput = {
  slotId: string;
  idempotencyKey: string;
  homeVisit?: HomeVisitBookingInput;
};

type DiscoveryInput = {
  q?: string;
  specialty?: string;
  providerClass?: string;
  providerCategory?: string;
  service?: string;
  modality?: string;
  location?: string;
  page?: string;
  limit?: string;
};

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
export class Release1SchedulingContextService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
    private readonly scheduling: SchedulingService,
  ) {}

  async listProviderLocations(principal: AuthPrincipal) {
    const provider = await this.requireActiveProvider(principal);
    const rows = await this.prisma.providerLocation.findMany({
      where: { providerId: provider.id },
      orderBy: [{ active: "desc" }, { label: "asc" }, { id: "asc" }],
    });
    return rows.map((row) => this.presentLocation(row));
  }

  async createProviderLocation(principal: AuthPrincipal, input: ProviderLocationInput) {
    const provider = await this.requireActiveProvider(principal);
    const label = this.requiredText(input.label, 2, 120, "label");
    const addressLine1 = this.requiredText(input.addressLine1, 3, 300, "addressLine1");
    const city = this.requiredText(input.city, 1, 120, "city");
    const countryCode = this.countryCode(input.countryCode);
    const latitude = this.latitude(input.latitude);
    const longitude = this.longitude(input.longitude);
    if (input.addressValidated !== true) throw new BadRequestException("Provider location addressValidated must be true after address validation.");
    const arrivalInstructions = this.optionalText(input.arrivalInstructions, 1_000, "arrivalInstructions");
    const row = await this.prisma.providerLocation.create({
      data: {
        providerId: provider.id,
        label,
        addressLine1,
        addressLine2: this.optionalText(input.addressLine2, 300, "addressLine2"),
        city,
        region: this.optionalText(input.region, 120, "region"),
        postalCode: this.optionalText(input.postalCode, 40, "postalCode"),
        countryCode,
        latitude,
        longitude,
        arrivalInstructions,
        addressValidatedAt: new Date(),
      },
    });
    await this.audit.write({
      actorId: principal.accountId,
      action: "PROVIDER_LOCATION_CREATED",
      objectType: "PROVIDER_LOCATION",
      objectId: row.id,
      purpose: "SCHEDULING_CONFIGURATION",
      result: "SUCCESS",
      metadata: { providerId: provider.id, countryCode },
    });
    return this.presentLocation(row);
  }

  async setProviderLocationActive(principal: AuthPrincipal, locationId: string, active: boolean) {
    const provider = await this.requireActiveProvider(principal);
    const location = await this.prisma.providerLocation.findUnique({ where: { id: this.identifier(locationId, "locationId") } });
    if (!location || location.providerId !== provider.id) throw new NotFoundException("Provider location not found.");
    if (!active) {
      const referenced = await this.prisma.serviceDeliveryContext.count({ where: { clinicLocationId: location.id, modality: "CLINIC" } });
      if (referenced > 0) throw new ConflictException("Provider location is still assigned to a clinic service. Reconfigure the service before deactivating the location.");
    }
    const updated = await this.prisma.providerLocation.update({ where: { id: location.id }, data: { active } });
    await this.audit.write({ actorId: principal.accountId, action: active ? "PROVIDER_LOCATION_ACTIVATED" : "PROVIDER_LOCATION_DEACTIVATED", objectType: "PROVIDER_LOCATION", objectId: location.id, purpose: "SCHEDULING_CONFIGURATION", result: "SUCCESS" });
    return this.presentLocation(updated);
  }

  async validateServiceContexts(principal: AuthPrincipal, modalities: readonly Release1ServiceModalityInput[]) {
    const provider = await this.requireActiveProvider(principal);
    for (const item of modalities) {
      if (item.modality === "CLINIC" && item.clinicLocationId) {
        await this.validateClinicContext(provider.id, { clinicLocationId: item.clinicLocationId, clinicArrivalInstructions: item.clinicArrivalInstructions });
      } else if (item.modality === "CLINIC" && item.clinicArrivalInstructions) {
        throw new BadRequestException("clinicLocationId is required when clinicArrivalInstructions is provided.");
      }
      if (item.modality === "HOME_VISIT") this.validateHomeCoverage(item.homeVisitCoverage);
      else if (item.homeVisitCoverage) throw new BadRequestException("homeVisitCoverage is only valid for HOME_VISIT services.");
    }
  }

  async configureServiceContexts(principal: AuthPrincipal, serviceId: string, modalities: readonly Release1ServiceModalityInput[]) {
    const provider = await this.requireActiveProvider(principal);
    const service = await this.requireOwnedService(provider.id, serviceId);
    await this.validateServiceContexts(principal, modalities);
    for (const item of modalities) {
      if (item.modality === "CLINIC" && !item.clinicLocationId) continue;
      if (item.modality === "HOME_VISIT" && !item.homeVisitCoverage) continue;
      if (item.modality !== "CLINIC" && item.modality !== "HOME_VISIT") continue;
      await this.upsertDeliveryContext(service.id, item.modality, item);
    }
    return this.serviceWithContexts(service.id);
  }

  async configureSingleServiceContext(principal: AuthPrincipal, serviceId: string, modalityText: string, input: Release1DeliveryContextInput) {
    const provider = await this.requireActiveProvider(principal);
    const service = await this.requireOwnedService(provider.id, serviceId);
    const modality = this.modality(modalityText);
    if (modality === "TELEMEDICINE") throw new BadRequestException("TELEMEDICINE does not use physical delivery context.");
    const configured = await this.prisma.serviceModality.findUnique({ where: { serviceId_modality: { serviceId: service.id, modality } } });
    if (!configured?.active) throw new BadRequestException("The selected modality is not active for this service.");
    if (modality === "CLINIC") await this.validateClinicContext(provider.id, input);
    if (modality === "HOME_VISIT") this.validateHomeCoverage(input.homeVisitCoverage);
    await this.upsertDeliveryContext(service.id, modality, input);
    await this.audit.write({ actorId: principal.accountId, action: "SERVICE_DELIVERY_CONTEXT_CONFIGURED", objectType: "SERVICE", objectId: service.id, purpose: "SCHEDULING_CONFIGURATION", result: "SUCCESS", metadata: { modality } });
    return this.serviceWithContexts(service.id);
  }

  async listProviderServices(principal: AuthPrincipal) {
    return this.enrichServices(await this.scheduling.listProviderServices(principal));
  }

  async legacySearch(input: { q?: string; modality?: string }) {
    return this.enrichServices(await this.scheduling.searchServices(input));
  }

  async discovery(input: DiscoveryInput) {
    const page = this.page(input.page);
    const limit = this.limit(input.limit);
    const modality = input.modality ? this.modality(input.modality) : null;
    const providerClass = input.providerClass?.trim().toUpperCase();
    if (providerClass && providerClass !== "DOCTOR" && providerClass !== "OTHER_PROVIDER") throw new BadRequestException("providerClass must be DOCTOR or OTHER_PROVIDER.");
    if (input.specialty?.trim() && providerClass === "OTHER_PROVIDER") return { page, limit, nextPage: null, items: [] };
    if (input.providerCategory?.trim() && providerClass === "DOCTOR") return { page, limit, nextPage: null, items: [] };

    const modalityClause = modality ? Prisma.sql`AND sm.modality = CAST(${modality} AS "AppointmentModality")` : Prisma.sql``;
    const conditions: Prisma.Sql[] = [
      Prisma.sql`s.active = true`,
      Prisma.sql`p.status = 'ACTIVE'`,
      Prisma.sql`EXISTS (
        SELECT 1 FROM "ServiceModality" sm
        WHERE sm."serviceId" = s.id
          AND sm.active = true
          ${modalityClause}
          AND (
            sm.modality <> 'CLINIC'
            OR EXISTS (
              SELECT 1
              FROM "ServiceDeliveryContext" sdc
              JOIN "ProviderLocation" pl ON pl.id = sdc."clinicLocationId"
              WHERE sdc."serviceId" = s.id
                AND sdc.modality = 'CLINIC'
                AND pl.active = true
                AND pl."addressValidatedAt" IS NOT NULL
                AND COALESCE(NULLIF(BTRIM(sdc."clinicArrivalInstructions"), ''), NULLIF(BTRIM(pl."arrivalInstructions"), '')) IS NOT NULL
            )
          )
      )`,
    ];

    const q = input.q?.trim();
    if (q) {
      const like = `%${this.escapeLike(q)}%`;
      conditions.push(Prisma.sql`(s.name ILIKE ${like} ESCAPE '\\' OR p."displayName" ILIKE ${like} ESCAPE '\\')`);
    }
    const serviceFilter = input.service?.trim();
    if (serviceFilter) {
      const like = `%${this.escapeLike(serviceFilter)}%`;
      conditions.push(Prisma.sql`(s.id = ${serviceFilter} OR s.name ILIKE ${like} ESCAPE '\\')`);
    }
    if (providerClass) conditions.push(Prisma.sql`p.class = CAST(${providerClass} AS "ProviderClass")`);
    const specialty = input.specialty?.trim();
    if (specialty) {
      conditions.push(Prisma.sql`EXISTS (
        SELECT 1
        FROM "DoctorProfile" dp
        JOIN "DoctorSpecialty" ds ON ds."doctorId" = dp.id
        JOIN "MedicalSpecialty" ms ON ms.id = ds."specialtyId"
        WHERE dp."providerId" = p.id AND ms.active = true AND (ms.id = ${specialty} OR UPPER(ms.code) = UPPER(${specialty}))
      )`);
    }
    const category = input.providerCategory?.trim();
    if (category) {
      conditions.push(Prisma.sql`EXISTS (
        SELECT 1
        FROM "OtherProviderProfile" opp
        JOIN "ProviderCategory" pc ON pc.id = opp."categoryId"
        WHERE opp."providerId" = p.id AND pc.active = true AND (pc.id = ${category} OR LOWER(pc.slug) = LOWER(${category}))
      )`);
    }
    const location = input.location?.trim();
    if (location) {
      const like = `%${this.escapeLike(location)}%`;
      if (modality === "CLINIC") {
        conditions.push(Prisma.sql`EXISTS (
          SELECT 1 FROM "ServiceDeliveryContext" sdc
          JOIN "ProviderLocation" pl ON pl.id = sdc."clinicLocationId"
          WHERE sdc."serviceId" = s.id AND sdc.modality = 'CLINIC' AND pl.active = true
            AND (pl.city ILIKE ${like} ESCAPE '\\' OR COALESCE(pl.region, '') ILIKE ${like} ESCAPE '\\' OR pl."countryCode" ILIKE ${like} ESCAPE '\\' OR pl."addressLine1" ILIKE ${like} ESCAPE '\\')
        )`);
      } else {
        conditions.push(Prisma.sql`EXISTS (
          SELECT 1 FROM "ProviderLocation" pl
          WHERE pl."providerId" = p.id AND pl.active = true
            AND (pl.city ILIKE ${like} ESCAPE '\\' OR COALESCE(pl.region, '') ILIKE ${like} ESCAPE '\\' OR pl."countryCode" ILIKE ${like} ESCAPE '\\' OR pl."addressLine1" ILIKE ${like} ESCAPE '\\')
        )`);
      }
    }

    const offset = (page - 1) * limit;
    const ids = await this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT s.id
      FROM "Service" s
      JOIN "Provider" p ON p.id = s."providerId"
      WHERE ${Prisma.join(conditions, " AND ")}
      ORDER BY LOWER(p."displayName") ASC, LOWER(s.name) ASC, s.id ASC
      OFFSET ${offset}
      LIMIT ${limit + 1}
    `);
    const hasNext = ids.length > limit;
    const pageIds = ids.slice(0, limit).map((row) => row.id);
    if (pageIds.length === 0) return { page, limit, nextPage: null, items: [] };

    const services = await this.prisma.service.findMany({
      where: { id: { in: pageIds } },
      include: {
        modalities: { where: { active: true }, orderBy: { modality: "asc" } },
        provider: {
          include: {
            doctorProfile: { include: { specialties: { include: { specialty: true } } } },
            otherProviderProfile: { include: { category: true } },
          },
        },
      },
    });
    const enriched = await this.enrichServices(services);
    const byId = new Map(enriched.map((item) => [item.id, item]));
    const items = pageIds
      .map((id) => byId.get(id))
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
      .map((service) => ({ ...service, modalities: this.discoveryReadyModalities(service.modalities, service.deliveryContexts, modality ?? undefined) }))
      .filter((service) => service.modalities.length > 0);
    return { page, limit, nextPage: hasNext ? page + 1 : null, items };
  }

  async validateAvailabilityRulePolicy(principal: AuthPrincipal, input: Release1AvailabilityRuleInput) {
    const provider = await this.requireActiveProvider(principal);
    const service = await this.requireOwnedService(provider.id, input.serviceId);
    const modality = await this.prisma.serviceModality.findUnique({ where: { serviceId_modality: { serviceId: service.id, modality: input.modality } } });
    if (!modality?.active) throw new BadRequestException("Active service modality is required for availability.");
    const before = this.nonNegativeInteger(input.bufferBeforeMinutes ?? 0, 240, "bufferBeforeMinutes");
    const after = this.nonNegativeInteger(input.bufferAfterMinutes ?? 0, 240, "bufferAfterMinutes");
    if (input.intervalMinutes < modality.durationMinutes + before + after) throw new BadRequestException("intervalMinutes must reserve service duration plus configured before/after buffers.");
    return { before, after };
  }

  async saveAvailabilityRulePolicy(principal: AuthPrincipal, ruleId: string, input: Release1AvailabilityRuleInput) {
    const { before, after } = await this.validateAvailabilityRulePolicy(principal, input);
    await this.prisma.availabilityRulePolicy.upsert({ where: { ruleId }, create: { ruleId, bufferBeforeMinutes: before, bufferAfterMinutes: after }, update: { bufferBeforeMinutes: before, bufferAfterMinutes: after } });
    return { bufferBeforeMinutes: before, bufferAfterMinutes: after };
  }

  async listAvailabilityRules(principal: AuthPrincipal) {
    const rows = await this.scheduling.listAvailabilityRules(principal);
    const policies = rows.length > 0 ? await this.prisma.availabilityRulePolicy.findMany({ where: { ruleId: { in: rows.map((row) => row.id) } } }) : [];
    const byRule = new Map(policies.map((row) => [row.ruleId, row]));
    return rows.map((row) => ({ ...row, bufferBeforeMinutes: byRule.get(row.id)?.bufferBeforeMinutes ?? 0, bufferAfterMinutes: byRule.get(row.id)?.bufferAfterMinutes ?? 0 }));
  }

  async createAvailabilityException(principal: AuthPrincipal, input: AvailabilityExceptionInput) {
    const provider = await this.requireActiveProvider(principal);
    const startsAt = this.dateTime(input.startsAt, "startsAt");
    const endsAt = this.dateTime(input.endsAt, "endsAt");
    if (endsAt <= startsAt) throw new BadRequestException("endsAt must be after startsAt.");
    if (endsAt.getTime() - startsAt.getTime() > MAX_EXCEPTION_DAYS * 24 * 60 * 60 * 1000) throw new BadRequestException(`Availability exceptions cannot exceed ${MAX_EXCEPTION_DAYS} days.`);
    const kind = input.kind ?? "UNAVAILABLE";
    if (kind !== "UNAVAILABLE" && kind !== "VACATION") throw new BadRequestException("kind must be UNAVAILABLE or VACATION.");
    const modality = input.modality ? this.modality(input.modality) : null;
    let serviceId: string | null = null;
    if (input.serviceId) serviceId = (await this.requireOwnedService(provider.id, input.serviceId)).id;
    await this.assertNoActiveAppointments(provider.id, startsAt, endsAt, serviceId, modality);
    const exception = await this.prisma.availabilityException.create({ data: { providerId: provider.id, serviceId, modality, kind, startsAt, endsAt, reason: this.optionalText(input.reason, 500, "reason") } });
    const blocked = await this.blockSlotsForException(exception);
    await this.audit.write({ actorId: principal.accountId, action: "AVAILABILITY_EXCEPTION_CREATED", objectType: "AVAILABILITY_EXCEPTION", objectId: exception.id, purpose: "SCHEDULING_CONFIGURATION", result: "SUCCESS", metadata: { providerId: provider.id, kind, blockedSlots: blocked } });
    return { ...exception, blockedSlots: blocked };
  }

  async listAvailabilityExceptions(principal: AuthPrincipal) {
    const provider = await this.requireActiveProvider(principal);
    return this.prisma.availabilityException.findMany({ where: { providerId: provider.id }, orderBy: [{ startsAt: "asc" }, { id: "asc" }], take: 500 });
  }

  async setAvailabilityExceptionActive(principal: AuthPrincipal, exceptionId: string, active: boolean) {
    const provider = await this.requireActiveProvider(principal);
    const exception = await this.prisma.availabilityException.findUnique({ where: { id: this.identifier(exceptionId, "exceptionId") } });
    if (!exception || exception.providerId !== provider.id) throw new NotFoundException("Availability exception not found.");
    if (active) await this.assertNoActiveAppointments(provider.id, exception.startsAt, exception.endsAt, exception.serviceId, exception.modality);
    const updated = await this.prisma.availabilityException.update({ where: { id: exception.id }, data: { active } });
    const blockedSlots = active ? await this.blockSlotsForException(updated) : 0;
    await this.audit.write({ actorId: principal.accountId, action: active ? "AVAILABILITY_EXCEPTION_ACTIVATED" : "AVAILABILITY_EXCEPTION_DEACTIVATED", objectType: "AVAILABILITY_EXCEPTION", objectId: exception.id, purpose: "SCHEDULING_CONFIGURATION", result: "SUCCESS", metadata: { blockedSlots } });
    return { ...updated, blockedSlots, blockedSlotsRequireExplicitUnblock: !active };
  }

  async generateAvailability(principal: AuthPrincipal, input: { fromDate: string; toDate: string; ruleId?: string }) {
    const result = await this.scheduling.generateAvailability(principal, input);
    const provider = await this.requireActiveProvider(principal);
    const from = this.dateOnly(input.fromDate, "fromDate");
    const to = new Date(this.dateOnly(input.toDate, "toDate").getTime() + 24 * 60 * 60 * 1000);
    const exceptions = await this.prisma.availabilityException.findMany({ where: { providerId: provider.id, active: true, startsAt: { lt: to }, endsAt: { gt: from } }, orderBy: { startsAt: "asc" } });
    let blockedByExceptions = 0;
    for (const exception of exceptions) blockedByExceptions += await this.blockSlotsForException(exception);
    return { ...result, blockedByExceptions };
  }

  async unblockSlot(principal: AuthPrincipal, slotId: string) {
    const provider = await this.requireActiveProvider(principal);
    const slot = await this.prisma.availabilitySlot.findUnique({ where: { id: this.identifier(slotId, "slotId") } });
    if (!slot || slot.providerId !== provider.id) throw new NotFoundException("Availability slot not found.");
    if (slot.bookedCount > 0) throw new ConflictException("A booked slot cannot be unblocked manually.");
    const blocking = await this.prisma.availabilityException.count({ where: { providerId: provider.id, active: true, startsAt: { lt: slot.endsAt }, endsAt: { gt: slot.startsAt }, OR: [{ serviceId: null }, { serviceId: slot.serviceId }], AND: [{ OR: [{ modality: null }, { modality: slot.modality }] }] } });
    if (blocking > 0) throw new ConflictException("Slot remains covered by an active availability exception.");
    const updated = await this.prisma.availabilitySlot.update({ where: { id: slot.id }, data: { status: "OPEN", version: { increment: 1 } } });
    await this.audit.write({ actorId: principal.accountId, action: "AVAILABILITY_SLOT_UNBLOCKED", objectType: "AVAILABILITY_SLOT", objectId: slot.id, purpose: "SCHEDULING_CONFIGURATION", result: "SUCCESS" });
    return updated;
  }

  async book(principal: AuthPrincipal, input: Release1BookingInput) {
    if (principal.role !== "PATIENT") throw new ForbiddenException("Only patients can create appointments.");
    const slotId = this.identifier(input.slotId, "slotId");
    const idempotencyKey = this.requiredText(input.idempotencyKey, 8, 128, "idempotencyKey");
    const patient = await this.prisma.patientProfile.findUnique({ where: { userId: principal.accountId } });
    if (!patient) throw new BadRequestException("Patient profile is required before booking.");

    const existing = await this.prisma.appointment.findUnique({ where: { idempotencyKey } });
    if (existing) {
      if (existing.patientId !== patient.id) throw new ConflictException("idempotencyKey is already in use.");
      return this.appointmentPresentation(existing.id);
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
          const appointment = await tx.appointment.create({ data: { patientId: patient.id, providerId: slot.providerId, serviceId: slot.serviceId, slotId: slot.id, idempotencyKey, modality: slot.modality, status: "CONFIRMED", startsAt: slot.startsAt, endsAt: slot.endsAt } });
          if (visitContext) await tx.appointmentVisitContext.create({ data: { appointmentId: appointment.id, ...visitContext } });
          return { appointmentId: appointment.id, created: true };
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

        if (result.created) await this.audit.write({ actorId: principal.accountId, action: "APPOINTMENT_BOOKED", objectType: "APPOINTMENT", objectId: result.appointmentId, result: "SUCCESS", metadata: { slotId, structuredVisitContext: true } });
        return this.appointmentPresentation(result.appointmentId);
      } catch (error) {
        if (this.isPrismaError(error, "P2034") && attempt < BOOKING_RETRIES) continue;
        if (this.isPrismaError(error, "P2002")) {
          const duplicate = await this.prisma.appointment.findUnique({ where: { idempotencyKey } });
          if (duplicate?.patientId === patient.id) return this.appointmentPresentation(duplicate.id);
          throw new ConflictException("The booking request was already processed.");
        }
        if (this.isPrismaError(error, "P2004")) throw new ConflictException("The selected time conflicts with another active appointment.");
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

  private strictVisitContextRequired(): boolean {
    return process.env.NODE_ENV === "production" || process.env.RELEASE1_TEST_STRICT_VISIT_CONTEXT === "true";
  }

  private async resolveVisitContext(tx: Prisma.TransactionClient, serviceId: string, providerId: string, modality: AppointmentModality, homeVisit?: HomeVisitBookingInput): Promise<VisitContextCreate | null> {
    if (modality === "TELEMEDICINE") return null;
    if (modality === "CLINIC") {
      const delivery = await tx.serviceDeliveryContext.findUnique({ where: { serviceId_modality: { serviceId, modality: "CLINIC" } } });
      if (!delivery?.clinicLocationId) {
        if (this.strictVisitContextRequired()) throw new ConflictException("Clinic service is missing its Release 1 location context.");
        return null;
      }
      const location = await tx.providerLocation.findUnique({ where: { id: delivery.clinicLocationId } });
      if (!location || location.providerId !== providerId || !location.active || !location.addressValidatedAt) throw new ConflictException("Clinic location is not active and validated.");
      const instructions = delivery.clinicArrivalInstructions?.trim() || location.arrivalInstructions?.trim();
      if (!instructions) throw new ConflictException("Clinic arrival instructions are required before booking.");
      return {
        modality,
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

    const addressLine1 = this.requiredText(homeVisit?.addressLine1, 3, 300, "homeVisit.addressLine1");
    const city = this.requiredText(homeVisit?.city, 1, 120, "homeVisit.city");
    const countryCode = this.countryCode(homeVisit?.countryCode);
    const latitude = this.latitude(homeVisit?.latitude);
    const longitude = this.longitude(homeVisit?.longitude);
    const contactPhone = this.requiredText(homeVisit?.contactPhone, 5, 40, "homeVisit.contactPhone");
    if (homeVisit?.contactConfirmed !== true) throw new BadRequestException("homeVisit.contactConfirmed must be true before booking.");
    if (homeVisit?.addressValidated !== true) throw new BadRequestException("homeVisit.addressValidated must be true before booking.");
    const delivery = await tx.serviceDeliveryContext.findUnique({ where: { serviceId_modality: { serviceId, modality: "HOME_VISIT" } } });
    if (delivery?.homeCoverageRadiusKm !== null && delivery?.homeCoverageRadiusKm !== undefined) {
      if (delivery.homeCoverageCenterLatitude === null || delivery.homeCoverageCenterLongitude === null) throw new ConflictException("Home-visit coverage configuration is incomplete.");
      const distance = this.distanceKm(latitude, longitude, Number(delivery.homeCoverageCenterLatitude), Number(delivery.homeCoverageCenterLongitude));
      if (distance > Number(delivery.homeCoverageRadiusKm)) throw new ConflictException("Home-visit address is outside the configured service coverage.");
    }
    const addressLine2 = this.optionalText(homeVisit?.addressLine2, 300, "homeVisit.addressLine2");
    const region = this.optionalText(homeVisit?.region, 120, "homeVisit.region");
    const postalCode = this.optionalText(homeVisit?.postalCode, 40, "homeVisit.postalCode");
    const instructions = this.optionalText(homeVisit?.instructions, 1_000, "homeVisit.instructions");
    return {
      modality,
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

  private async appointmentPresentation(appointmentId: string) {
    const appointment = await this.prisma.appointment.findUnique({ where: { id: appointmentId }, include: { service: true, provider: true, slot: true } });
    if (!appointment) throw new NotFoundException("Appointment not found.");
    const visitContext = await this.prisma.appointmentVisitContext.findUnique({ where: { appointmentId } });
    return { ...appointment, visitContext: visitContext ? this.presentVisitContext(visitContext) : null };
  }

  private async enrichAppointments<T extends { id: string }>(rows: T[]) {
    if (rows.length === 0) return rows.map((row) => ({ ...row, visitContext: null }));
    const contexts = await this.prisma.appointmentVisitContext.findMany({ where: { appointmentId: { in: rows.map((row) => row.id) } } });
    const byAppointment = new Map(contexts.map((row) => [row.appointmentId, row]));
    return rows.map((row) => ({ ...row, visitContext: byAppointment.get(row.id) ? this.presentVisitContext(byAppointment.get(row.id)!) : null }));
  }

  private async serviceWithContexts(serviceId: string) {
    const service = await this.prisma.service.findUnique({ where: { id: serviceId }, include: { modalities: { orderBy: { modality: "asc" } }, provider: true } });
    if (!service) throw new NotFoundException("Service not found.");
    return (await this.enrichServices([service]))[0];
  }

  private async enrichServices<T extends { id: string; providerId: string; modalities: Array<{ modality: AppointmentModality; active: boolean }> }>(rows: T[]) {
    if (rows.length === 0) return [] as Array<T & { deliveryContexts: Array<Record<string, unknown>> }>;
    const serviceIds = rows.map((row) => row.id);
    const contexts = await this.prisma.serviceDeliveryContext.findMany({ where: { serviceId: { in: serviceIds } }, orderBy: { modality: "asc" } });
    const locationIds = [...new Set(contexts.map((row) => row.clinicLocationId).filter((value): value is string => Boolean(value)))];
    const locations = locationIds.length > 0 ? await this.prisma.providerLocation.findMany({ where: { id: { in: locationIds } } }) : [];
    const locationById = new Map(locations.map((row) => [row.id, row]));
    return rows.map((row) => ({
      ...row,
      deliveryContexts: contexts.filter((context) => context.serviceId === row.id).map((context): Record<string, unknown> => {
        const location = context.clinicLocationId ? locationById.get(context.clinicLocationId) : undefined;
        return {
          modality: context.modality,
          ...(context.clinicLocationId ? {
            clinic: {
              location: location ? this.presentLocation(location) : null,
              arrivalInstructions: context.clinicArrivalInstructions ?? location?.arrivalInstructions ?? null,
              navigation: location ? { latitude: Number(location.latitude), longitude: Number(location.longitude) } : null,
            },
          } : {}),
          ...(context.homeCoverageRadiusKm !== null ? {
            homeVisitCoverage: {
              centerLatitude: Number(context.homeCoverageCenterLatitude),
              centerLongitude: Number(context.homeCoverageCenterLongitude),
              radiusKm: Number(context.homeCoverageRadiusKm),
            },
          } : {}),
        };
      }),
    }));
  }

  private discoveryReadyModalities(modalities: Array<{ modality: AppointmentModality; active: boolean }>, contexts: Array<Record<string, unknown>>, requested?: string) {
    const contextByModality = new Map(contexts.map((context) => [String(context.modality), context]));
    return modalities.filter((item) => {
      if (!item.active || (requested && item.modality !== requested)) return false;
      if (item.modality !== "CLINIC") return true;
      const context = contextByModality.get("CLINIC");
      const clinic = context?.clinic;
      if (!clinic || typeof clinic !== "object") return false;
      const value = clinic as { location?: unknown; arrivalInstructions?: unknown };
      return Boolean(value.location) && typeof value.arrivalInstructions === "string" && value.arrivalInstructions.trim().length > 0;
    });
  }

  private async validateClinicContext(providerId: string, input: ClinicDeliveryContextInput) {
    const locationId = this.identifier(input.clinicLocationId, "clinicLocationId");
    const location = await this.prisma.providerLocation.findUnique({ where: { id: locationId } });
    if (!location || location.providerId !== providerId || !location.active || !location.addressValidatedAt) throw new BadRequestException("clinicLocationId must reference an active validated location owned by the provider.");
    const instructions = this.optionalText(input.clinicArrivalInstructions, 1_000, "clinicArrivalInstructions") ?? location.arrivalInstructions;
    if (!instructions?.trim()) throw new BadRequestException("Clinic services require arrival instructions before they can be Release 1 discovery-ready.");
  }

  private async upsertDeliveryContext(serviceId: string, modality: AppointmentModality, input: Release1DeliveryContextInput) {
    if (modality === "CLINIC") {
      const locationId = this.identifier(input.clinicLocationId, "clinicLocationId");
      await this.prisma.serviceDeliveryContext.upsert({
        where: { serviceId_modality: { serviceId, modality } },
        create: { serviceId, modality, clinicLocationId: locationId, clinicArrivalInstructions: this.optionalText(input.clinicArrivalInstructions, 1_000, "clinicArrivalInstructions") },
        update: { clinicLocationId: locationId, clinicArrivalInstructions: this.optionalText(input.clinicArrivalInstructions, 1_000, "clinicArrivalInstructions"), homeCoverageCenterLatitude: null, homeCoverageCenterLongitude: null, homeCoverageRadiusKm: null },
      });
      return;
    }
    if (modality === "HOME_VISIT") {
      const coverage = input.homeVisitCoverage;
      await this.prisma.serviceDeliveryContext.upsert({
        where: { serviceId_modality: { serviceId, modality } },
        create: { serviceId, modality, homeCoverageCenterLatitude: coverage?.centerLatitude ?? null, homeCoverageCenterLongitude: coverage?.centerLongitude ?? null, homeCoverageRadiusKm: coverage?.radiusKm ?? null },
        update: { clinicLocationId: null, clinicArrivalInstructions: null, homeCoverageCenterLatitude: coverage?.centerLatitude ?? null, homeCoverageCenterLongitude: coverage?.centerLongitude ?? null, homeCoverageRadiusKm: coverage?.radiusKm ?? null },
      });
    }
  }

  private async assertNoActiveAppointments(providerId: string, startsAt: Date, endsAt: Date, serviceId: string | null, modality: AppointmentModality | null) {
    const where: Prisma.AppointmentWhereInput = {
      providerId,
      startsAt: { lt: endsAt },
      endsAt: { gt: startsAt },
      status: { in: ["REQUESTED", "CONFIRMED"] },
      ...(serviceId ? { serviceId } : {}),
      ...(modality ? { modality } : {}),
    };
    if (await this.prisma.appointment.count({ where }) > 0) throw new ConflictException("Availability exception overlaps an active appointment. Resolve or reschedule the booking first.");
  }

  private async blockSlotsForException(exception: { providerId: string; serviceId: string | null; modality: AppointmentModality | null; startsAt: Date; endsAt: Date; active: boolean }) {
    if (!exception.active) return 0;
    const result = await this.prisma.availabilitySlot.updateMany({
      where: { providerId: exception.providerId, status: "OPEN", bookedCount: 0, startsAt: { lt: exception.endsAt }, endsAt: { gt: exception.startsAt }, ...(exception.serviceId ? { serviceId: exception.serviceId } : {}), ...(exception.modality ? { modality: exception.modality } : {}) },
      data: { status: "BLOCKED", version: { increment: 1 } },
    });
    return result.count;
  }

  private validateHomeCoverage(coverage: HomeVisitCoverageInput | undefined) {
    if (!coverage) return;
    this.latitude(coverage.centerLatitude);
    this.longitude(coverage.centerLongitude);
    if (!Number.isFinite(coverage.radiusKm) || coverage.radiusKm <= 0 || coverage.radiusKm > 1_000) throw new BadRequestException("homeVisitCoverage.radiusKm must be greater than 0 and no more than 1000 km.");
  }

  private presentLocation(location: { id: string; providerId: string; label: string; addressLine1: string; addressLine2: string | null; city: string; region: string | null; postalCode: string | null; countryCode: string; latitude: Prisma.Decimal; longitude: Prisma.Decimal; arrivalInstructions: string | null; addressValidatedAt: Date | null; active: boolean; createdAt: Date; updatedAt: Date }) {
    return { ...location, latitude: Number(location.latitude), longitude: Number(location.longitude), validated: Boolean(location.addressValidatedAt), navigation: { latitude: Number(location.latitude), longitude: Number(location.longitude) } };
  }

  private presentVisitContext(context: { id: string; appointmentId: string; modality: AppointmentModality; sourceProviderLocationId: string | null; addressLine1: string; addressLine2: string | null; city: string; region: string | null; postalCode: string | null; countryCode: string; latitude: Prisma.Decimal; longitude: Prisma.Decimal; instructions: string | null; contactPhone: string | null; contactConfirmedAt: Date | null; addressValidatedAt: Date | null; createdAt: Date; updatedAt: Date }) {
    return { ...context, latitude: Number(context.latitude), longitude: Number(context.longitude), addressValidated: Boolean(context.addressValidatedAt), contactConfirmed: Boolean(context.contactConfirmedAt), navigation: { latitude: Number(context.latitude), longitude: Number(context.longitude) } };
  }

  private async requireActiveProvider(principal: AuthPrincipal) {
    if (principal.role !== "DOCTOR" && principal.role !== "OTHER_PROVIDER") throw new ForbiddenException("A provider account is required.");
    const provider = await this.prisma.provider.findUnique({ where: { userId: principal.accountId } });
    if (!provider || provider.status !== "ACTIVE") throw new ForbiddenException("Provider must be active before managing Release 1 scheduling context.");
    return provider;
  }

  private async requireOwnedService(providerId: string, serviceId: string) {
    const service = await this.prisma.service.findUnique({ where: { id: this.identifier(serviceId, "serviceId") } });
    if (!service || service.providerId !== providerId) throw new NotFoundException("Service not found.");
    return service;
  }

  private modality(value: string): AppointmentModality {
    if (value !== "CLINIC" && value !== "TELEMEDICINE" && value !== "HOME_VISIT") throw new BadRequestException("Unsupported appointment modality.");
    return value;
  }

  private page(raw?: string): number {
    if (!raw) return 1;
    if (!/^\d+$/.test(raw)) throw new BadRequestException("page must be an integer.");
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < 1 || value > MAX_DISCOVERY_PAGE) throw new BadRequestException(`page must be between 1 and ${MAX_DISCOVERY_PAGE}.`);
    return value;
  }

  private limit(raw?: string): number {
    if (!raw) return 20;
    if (!/^\d+$/.test(raw)) throw new BadRequestException("limit must be an integer.");
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < 1 || value > MAX_DISCOVERY_LIMIT) throw new BadRequestException(`limit must be between 1 and ${MAX_DISCOVERY_LIMIT}.`);
    return value;
  }

  private identifier(value: unknown, field: string): string {
    return this.requiredText(value, 1, 128, field);
  }

  private requiredText(value: unknown, min: number, max: number, field: string): string {
    if (typeof value !== "string") throw new BadRequestException(`${field} must be text.`);
    const text = value.trim();
    if (text.length < min || text.length > max) throw new BadRequestException(`${field} must contain between ${min} and ${max} characters.`);
    return text;
  }

  private optionalText(value: unknown, max: number, field: string): string | null {
    if (value === undefined || value === null || value === "") return null;
    if (typeof value !== "string") throw new BadRequestException(`${field} must be text.`);
    const text = value.trim();
    if (text.length === 0) return null;
    if (text.length > max) throw new BadRequestException(`${field} cannot exceed ${max} characters.`);
    return text;
  }

  private countryCode(value: unknown): string {
    const code = this.requiredText(value, 2, 2, "countryCode").toUpperCase();
    if (!/^[A-Z]{2}$/.test(code)) throw new BadRequestException("countryCode must use a two-letter ISO-style code.");
    return code;
  }

  private latitude(value: unknown): number {
    if (typeof value !== "number" || !Number.isFinite(value) || value < -90 || value > 90) throw new BadRequestException("latitude must be between -90 and 90.");
    return value;
  }

  private longitude(value: unknown): number {
    if (typeof value !== "number" || !Number.isFinite(value) || value < -180 || value > 180) throw new BadRequestException("longitude must be between -180 and 180.");
    return value;
  }

  private nonNegativeInteger(value: unknown, max: number, field: string): number {
    if (!Number.isInteger(value) || Number(value) < 0 || Number(value) > max) throw new BadRequestException(`${field} must be an integer between 0 and ${max}.`);
    return Number(value);
  }

  private dateTime(value: unknown, field: string): Date {
    if (typeof value !== "string" || !value.trim()) throw new BadRequestException(`${field} is required.`);
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) throw new BadRequestException(`${field} must be a valid ISO date-time.`);
    return date;
  }

  private dateOnly(value: unknown, field: string): Date {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new BadRequestException(`${field} must use YYYY-MM-DD.`);
    const date = new Date(`${value}T00:00:00.000Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new BadRequestException(`${field} is invalid.`);
    return date;
  }

  private escapeLike(value: string): string {
    return value.replace(/[\\%_]/g, (match) => `\\${match}`);
  }

  private distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const radians = (degrees: number) => degrees * Math.PI / 180;
    const dLat = radians(lat2 - lat1);
    const dLon = radians(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(dLon / 2) ** 2;
    return 6_371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  private isPrismaError(error: unknown, code: string): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;
  }
}

export type {
  AvailabilityExceptionInput,
  DiscoveryInput,
  ProviderLocationInput,
  Release1AvailabilityRuleInput,
  Release1BookingInput,
  Release1DeliveryContextInput,
  Release1ServiceModalityInput,
};
