import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, type AppointmentModality } from "@prisma/client";
import type { AuthPrincipal } from "@carepoint/identity";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { SchedulingService } from "./scheduling.service";
import type {
  DiscoveryInput,
  HomeVisitCoverageInput,
  ProviderLocationInput,
  Release1DeliveryContextInput,
  Release1ServiceModalityInput,
} from "./release1-scheduling-context.types";

const MAX_DISCOVERY_PAGE = 1_000;
const MAX_DISCOVERY_LIMIT = 50;

type ClinicInput = { clinicLocationId?: string; clinicArrivalInstructions?: string };

@Injectable()
export class Release1LocationDiscoveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
    private readonly scheduling: SchedulingService,
  ) {}

  async listProviderLocations(principal: AuthPrincipal) {
    const provider = await this.requireProvider(principal);
    const rows = await this.prisma.providerLocation.findMany({ where: { providerId: provider.id }, orderBy: [{ active: "desc" }, { label: "asc" }, { id: "asc" }] });
    return rows.map((row) => this.presentLocation(row));
  }

  async createProviderLocation(principal: AuthPrincipal, input: ProviderLocationInput) {
    const provider = await this.requireProvider(principal);
    if (input.addressValidated !== true) throw new BadRequestException("Provider location addressValidated must be true after address validation.");
    const row = await this.prisma.providerLocation.create({
      data: {
        providerId: provider.id,
        label: this.text(input.label, 2, 120, "label"),
        addressLine1: this.text(input.addressLine1, 3, 300, "addressLine1"),
        addressLine2: this.optional(input.addressLine2, 300, "addressLine2"),
        city: this.text(input.city, 1, 120, "city"),
        region: this.optional(input.region, 120, "region"),
        postalCode: this.optional(input.postalCode, 40, "postalCode"),
        countryCode: this.country(input.countryCode),
        latitude: this.latitude(input.latitude),
        longitude: this.longitude(input.longitude),
        arrivalInstructions: this.optional(input.arrivalInstructions, 1_000, "arrivalInstructions"),
        addressValidatedAt: new Date(),
      },
    });
    await this.audit.write({ actorId: principal.accountId, action: "PROVIDER_LOCATION_CREATED", objectType: "PROVIDER_LOCATION", objectId: row.id, purpose: "SCHEDULING_CONFIGURATION", result: "SUCCESS", metadata: { providerId: provider.id, countryCode: row.countryCode } });
    return this.presentLocation(row);
  }

  async setProviderLocationActive(principal: AuthPrincipal, locationId: string, active: boolean) {
    const provider = await this.requireProvider(principal);
    const location = await this.prisma.providerLocation.findUnique({ where: { id: this.text(locationId, 1, 128, "locationId") } });
    if (!location || location.providerId !== provider.id) throw new NotFoundException("Provider location not found.");
    if (!active && await this.prisma.serviceDeliveryContext.count({ where: { clinicLocationId: location.id, modality: "CLINIC" } }) > 0) {
      throw new ConflictException("Provider location is still assigned to a clinic service. Reconfigure the service before deactivating the location.");
    }
    const updated = await this.prisma.providerLocation.update({ where: { id: location.id }, data: { active } });
    await this.audit.write({ actorId: principal.accountId, action: active ? "PROVIDER_LOCATION_ACTIVATED" : "PROVIDER_LOCATION_DEACTIVATED", objectType: "PROVIDER_LOCATION", objectId: location.id, purpose: "SCHEDULING_CONFIGURATION", result: "SUCCESS" });
    return this.presentLocation(updated);
  }

  async validateServiceContexts(principal: AuthPrincipal, modalities: readonly Release1ServiceModalityInput[]) {
    const provider = await this.requireProvider(principal);
    for (const item of modalities) {
      if (item.modality === "CLINIC" && item.clinicLocationId) {
        const context: ClinicInput = { clinicLocationId: item.clinicLocationId };
        if (item.clinicArrivalInstructions !== undefined) context.clinicArrivalInstructions = item.clinicArrivalInstructions;
        await this.validateClinic(provider.id, context);
      } else if (item.modality === "CLINIC" && item.clinicArrivalInstructions) {
        throw new BadRequestException("clinicLocationId is required when clinicArrivalInstructions is provided.");
      }
      if (item.modality === "HOME_VISIT") this.validateCoverage(item.homeVisitCoverage);
      else if (item.homeVisitCoverage) throw new BadRequestException("homeVisitCoverage is only valid for HOME_VISIT services.");
    }
  }

  async configureServiceContexts(principal: AuthPrincipal, serviceId: string, modalities: readonly Release1ServiceModalityInput[]) {
    const provider = await this.requireProvider(principal);
    const service = await this.ownedService(provider.id, serviceId);
    await this.validateServiceContexts(principal, modalities);
    for (const item of modalities) {
      if (item.modality === "CLINIC" && item.clinicLocationId) await this.upsertContext(service.id, "CLINIC", item);
      if (item.modality === "HOME_VISIT" && item.homeVisitCoverage) await this.upsertContext(service.id, "HOME_VISIT", item);
    }
    return this.serviceWithContexts(service.id);
  }

  async configureSingleServiceContext(principal: AuthPrincipal, serviceId: string, modalityText: string, input: Release1DeliveryContextInput) {
    const provider = await this.requireProvider(principal);
    const service = await this.ownedService(provider.id, serviceId);
    const modality = this.modality(modalityText);
    if (modality === "TELEMEDICINE") throw new BadRequestException("TELEMEDICINE does not use physical delivery context.");
    const configured = await this.prisma.serviceModality.findUnique({ where: { serviceId_modality: { serviceId: service.id, modality } } });
    if (!configured?.active) throw new BadRequestException("The selected modality is not active for this service.");
    if (modality === "CLINIC") await this.validateClinic(provider.id, input);
    if (modality === "HOME_VISIT") this.validateCoverage(input.homeVisitCoverage);
    await this.upsertContext(service.id, modality, input);
    await this.audit.write({ actorId: principal.accountId, action: "SERVICE_DELIVERY_CONTEXT_CONFIGURED", objectType: "SERVICE", objectId: service.id, purpose: "SCHEDULING_CONFIGURATION", result: "SUCCESS", metadata: { modality } });
    return this.serviceWithContexts(service.id);
  }

  async listProviderServices(principal: AuthPrincipal) {
    return this.enrich(await this.scheduling.listProviderServices(principal));
  }

  async legacySearch(input: { q?: string; modality?: string }) {
    return this.enrich(await this.scheduling.searchServices(input));
  }

  async discovery(input: DiscoveryInput) {
    const page = this.page(input.page);
    const limit = this.limit(input.limit);
    const modality = input.modality ? this.modality(input.modality) : null;
    const providerClass = input.providerClass?.trim().toUpperCase();
    if (providerClass && providerClass !== "DOCTOR" && providerClass !== "OTHER_PROVIDER") throw new BadRequestException("providerClass must be DOCTOR or OTHER_PROVIDER.");
    if (input.specialty?.trim() && providerClass === "OTHER_PROVIDER") return { page, limit, nextPage: null, items: [] };
    if (input.providerCategory?.trim() && providerClass === "DOCTOR") return { page, limit, nextPage: null, items: [] };

    const modalitySql = modality ? Prisma.sql`AND sm.modality = CAST(${modality} AS "AppointmentModality")` : Prisma.sql``;
    const clauses: Prisma.Sql[] = [
      Prisma.sql`s.active = true`,
      Prisma.sql`p.status = 'ACTIVE'`,
      Prisma.sql`EXISTS (
        SELECT 1 FROM "ServiceModality" sm
        WHERE sm."serviceId" = s.id AND sm.active = true ${modalitySql}
          AND (sm.modality <> 'CLINIC' OR EXISTS (
            SELECT 1 FROM "ServiceDeliveryContext" sdc
            JOIN "ProviderLocation" pl ON pl.id = sdc."clinicLocationId"
            WHERE sdc."serviceId" = s.id AND sdc.modality = 'CLINIC' AND pl.active = true
              AND pl."addressValidatedAt" IS NOT NULL
              AND COALESCE(NULLIF(BTRIM(sdc."clinicArrivalInstructions"), ''), NULLIF(BTRIM(pl."arrivalInstructions"), '')) IS NOT NULL
          ))
      )`,
    ];
    if (input.q?.trim()) {
      const like = `%${this.escapeLike(input.q.trim())}%`;
      clauses.push(Prisma.sql`(s.name ILIKE ${like} ESCAPE '\\' OR p."displayName" ILIKE ${like} ESCAPE '\\')`);
    }
    if (input.service?.trim()) {
      const service = input.service.trim();
      const like = `%${this.escapeLike(service)}%`;
      clauses.push(Prisma.sql`(s.id = ${service} OR s.name ILIKE ${like} ESCAPE '\\')`);
    }
    if (providerClass) clauses.push(Prisma.sql`p.class = CAST(${providerClass} AS "ProviderClass")`);
    if (input.specialty?.trim()) {
      const specialty = input.specialty.trim();
      clauses.push(Prisma.sql`EXISTS (SELECT 1 FROM "DoctorProfile" dp JOIN "DoctorSpecialty" ds ON ds."doctorId" = dp.id JOIN "MedicalSpecialty" ms ON ms.id = ds."specialtyId" WHERE dp."providerId" = p.id AND ms.active = true AND (ms.id = ${specialty} OR UPPER(ms.code) = UPPER(${specialty})))`);
    }
    if (input.providerCategory?.trim()) {
      const category = input.providerCategory.trim();
      clauses.push(Prisma.sql`EXISTS (SELECT 1 FROM "OtherProviderProfile" opp JOIN "ProviderCategory" pc ON pc.id = opp."categoryId" WHERE opp."providerId" = p.id AND pc.active = true AND (pc.id = ${category} OR LOWER(pc.slug) = LOWER(${category})))`);
    }
    if (input.location?.trim()) {
      const like = `%${this.escapeLike(input.location.trim())}%`;
      if (modality === "CLINIC") clauses.push(Prisma.sql`EXISTS (SELECT 1 FROM "ServiceDeliveryContext" sdc JOIN "ProviderLocation" pl ON pl.id = sdc."clinicLocationId" WHERE sdc."serviceId" = s.id AND sdc.modality = 'CLINIC' AND pl.active = true AND (pl.city ILIKE ${like} ESCAPE '\\' OR COALESCE(pl.region, '') ILIKE ${like} ESCAPE '\\' OR pl."countryCode" ILIKE ${like} ESCAPE '\\' OR pl."addressLine1" ILIKE ${like} ESCAPE '\\'))`);
      else clauses.push(Prisma.sql`EXISTS (SELECT 1 FROM "ProviderLocation" pl WHERE pl."providerId" = p.id AND pl.active = true AND (pl.city ILIKE ${like} ESCAPE '\\' OR COALESCE(pl.region, '') ILIKE ${like} ESCAPE '\\' OR pl."countryCode" ILIKE ${like} ESCAPE '\\' OR pl."addressLine1" ILIKE ${like} ESCAPE '\\'))`);
    }

    const ids = await this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT s.id FROM "Service" s JOIN "Provider" p ON p.id = s."providerId"
      WHERE ${Prisma.join(clauses, " AND ")}
      ORDER BY LOWER(p."displayName") ASC, LOWER(s.name) ASC, s.id ASC
      OFFSET ${(page - 1) * limit} LIMIT ${limit + 1}
    `);
    const hasNext = ids.length > limit;
    const pageIds = ids.slice(0, limit).map((row) => row.id);
    if (pageIds.length === 0) return { page, limit, nextPage: null, items: [] };
    const services = await this.prisma.service.findMany({
      where: { id: { in: pageIds } },
      include: { modalities: { where: { active: true }, orderBy: { modality: "asc" } }, provider: { include: { doctorProfile: { include: { specialties: { include: { specialty: true } } } }, otherProviderProfile: { include: { category: true } } } } },
    });
    const enriched = await this.enrich(services);
    const byId = new Map(enriched.map((row) => [row.id, row]));
    const items = pageIds.map((id) => byId.get(id)).filter((row): row is NonNullable<typeof row> => Boolean(row)).map((service) => ({ ...service, modalities: this.readyModalities(service.modalities, service.deliveryContexts, modality ?? undefined) })).filter((service) => service.modalities.length > 0);
    return { page, limit, nextPage: hasNext ? page + 1 : null, items };
  }

  private async validateClinic(providerId: string, input: ClinicInput) {
    const locationId = this.text(input.clinicLocationId, 1, 128, "clinicLocationId");
    const location = await this.prisma.providerLocation.findUnique({ where: { id: locationId } });
    if (!location || location.providerId !== providerId || !location.active || !location.addressValidatedAt) throw new BadRequestException("clinicLocationId must reference an active validated location owned by the provider.");
    const instructions = this.optional(input.clinicArrivalInstructions, 1_000, "clinicArrivalInstructions") ?? location.arrivalInstructions;
    if (!instructions?.trim()) throw new BadRequestException("Clinic services require arrival instructions before they can be Release 1 discovery-ready.");
  }

  private async upsertContext(serviceId: string, modality: AppointmentModality, input: Release1DeliveryContextInput) {
    if (modality === "CLINIC") {
      const locationId = this.text(input.clinicLocationId, 1, 128, "clinicLocationId");
      const instructions = this.optional(input.clinicArrivalInstructions, 1_000, "clinicArrivalInstructions");
      await this.prisma.serviceDeliveryContext.upsert({ where: { serviceId_modality: { serviceId, modality } }, create: { serviceId, modality, clinicLocationId: locationId, clinicArrivalInstructions: instructions }, update: { clinicLocationId: locationId, clinicArrivalInstructions: instructions, homeCoverageCenterLatitude: null, homeCoverageCenterLongitude: null, homeCoverageRadiusKm: null } });
      return;
    }
    if (modality === "HOME_VISIT") {
      const coverage = input.homeVisitCoverage;
      await this.prisma.serviceDeliveryContext.upsert({ where: { serviceId_modality: { serviceId, modality } }, create: { serviceId, modality, homeCoverageCenterLatitude: coverage?.centerLatitude ?? null, homeCoverageCenterLongitude: coverage?.centerLongitude ?? null, homeCoverageRadiusKm: coverage?.radiusKm ?? null }, update: { clinicLocationId: null, clinicArrivalInstructions: null, homeCoverageCenterLatitude: coverage?.centerLatitude ?? null, homeCoverageCenterLongitude: coverage?.centerLongitude ?? null, homeCoverageRadiusKm: coverage?.radiusKm ?? null } });
    }
  }

  private async serviceWithContexts(serviceId: string) {
    const service = await this.prisma.service.findUnique({ where: { id: serviceId }, include: { modalities: { orderBy: { modality: "asc" } }, provider: true } });
    if (!service) throw new NotFoundException("Service not found.");
    return (await this.enrich([service]))[0];
  }

  private async enrich<T extends { id: string; providerId: string; modalities: Array<{ modality: AppointmentModality; active: boolean }> }>(services: T[]) {
    if (services.length === 0) return [] as Array<T & { deliveryContexts: Array<Record<string, unknown>> }>;
    const contexts = await this.prisma.serviceDeliveryContext.findMany({ where: { serviceId: { in: services.map((row) => row.id) } }, orderBy: { modality: "asc" } });
    const locationIds = [...new Set(contexts.map((row) => row.clinicLocationId).filter((value): value is string => Boolean(value)))];
    const locations = locationIds.length ? await this.prisma.providerLocation.findMany({ where: { id: { in: locationIds } } }) : [];
    const byLocation = new Map(locations.map((row) => [row.id, row]));
    return services.map((service) => ({ ...service, deliveryContexts: contexts.filter((context) => context.serviceId === service.id).map((context): Record<string, unknown> => {
      const location = context.clinicLocationId ? byLocation.get(context.clinicLocationId) : undefined;
      return { modality: context.modality, ...(location ? { clinic: { location: this.presentLocation(location), arrivalInstructions: context.clinicArrivalInstructions ?? location.arrivalInstructions, navigation: { latitude: Number(location.latitude), longitude: Number(location.longitude) } } } : {}), ...(context.homeCoverageRadiusKm !== null ? { homeVisitCoverage: { centerLatitude: Number(context.homeCoverageCenterLatitude), centerLongitude: Number(context.homeCoverageCenterLongitude), radiusKm: Number(context.homeCoverageRadiusKm) } } : {}) };
    }) }));
  }

  private readyModalities(modalities: Array<{ modality: AppointmentModality; active: boolean }>, contexts: Array<Record<string, unknown>>, requested?: string) {
    const byModality = new Map(contexts.map((context) => [String(context.modality), context]));
    return modalities.filter((item) => {
      if (!item.active || (requested && item.modality !== requested)) return false;
      if (item.modality !== "CLINIC") return true;
      const clinic = byModality.get("CLINIC")?.clinic;
      if (!clinic || typeof clinic !== "object") return false;
      const value = clinic as { location?: unknown; arrivalInstructions?: unknown };
      return Boolean(value.location) && typeof value.arrivalInstructions === "string" && value.arrivalInstructions.trim().length > 0;
    });
  }

  private validateCoverage(coverage: HomeVisitCoverageInput | undefined) {
    if (!coverage) return;
    this.latitude(coverage.centerLatitude); this.longitude(coverage.centerLongitude);
    if (!Number.isFinite(coverage.radiusKm) || coverage.radiusKm <= 0 || coverage.radiusKm > 1_000) throw new BadRequestException("homeVisitCoverage.radiusKm must be greater than 0 and no more than 1000 km.");
  }

  private presentLocation(location: { id: string; providerId: string; label: string; addressLine1: string; addressLine2: string | null; city: string; region: string | null; postalCode: string | null; countryCode: string; latitude: Prisma.Decimal; longitude: Prisma.Decimal; arrivalInstructions: string | null; addressValidatedAt: Date | null; active: boolean; createdAt: Date; updatedAt: Date }) {
    return { ...location, latitude: Number(location.latitude), longitude: Number(location.longitude), validated: Boolean(location.addressValidatedAt), navigation: { latitude: Number(location.latitude), longitude: Number(location.longitude) } };
  }

  private async requireProvider(principal: AuthPrincipal) {
    if (principal.role !== "DOCTOR" && principal.role !== "OTHER_PROVIDER") throw new ForbiddenException("A provider account is required.");
    const provider = await this.prisma.provider.findUnique({ where: { userId: principal.accountId } });
    if (!provider || provider.status !== "ACTIVE") throw new ForbiddenException("Provider must be active before managing Release 1 scheduling context.");
    return provider;
  }

  private async ownedService(providerId: string, serviceId: string) {
    const service = await this.prisma.service.findUnique({ where: { id: this.text(serviceId, 1, 128, "serviceId") } });
    if (!service || service.providerId !== providerId) throw new NotFoundException("Service not found.");
    return service;
  }

  private modality(value: string): AppointmentModality {
    if (value !== "CLINIC" && value !== "TELEMEDICINE" && value !== "HOME_VISIT") throw new BadRequestException("Unsupported appointment modality.");
    return value;
  }

  private page(raw?: string) { const value = raw ? Number(raw) : 1; if (!Number.isSafeInteger(value) || value < 1 || value > MAX_DISCOVERY_PAGE) throw new BadRequestException(`page must be between 1 and ${MAX_DISCOVERY_PAGE}.`); return value; }
  private limit(raw?: string) { const value = raw ? Number(raw) : 20; if (!Number.isSafeInteger(value) || value < 1 || value > MAX_DISCOVERY_LIMIT) throw new BadRequestException(`limit must be between 1 and ${MAX_DISCOVERY_LIMIT}.`); return value; }
  private text(value: unknown, min: number, max: number, field: string) { if (typeof value !== "string") throw new BadRequestException(`${field} must be text.`); const text = value.trim(); if (text.length < min || text.length > max) throw new BadRequestException(`${field} must contain between ${min} and ${max} characters.`); return text; }
  private optional(value: unknown, max: number, field: string) { if (value === undefined || value === null || value === "") return null; return this.text(value, 1, max, field); }
  private country(value: unknown) { const code = this.text(value, 2, 2, "countryCode").toUpperCase(); if (!/^[A-Z]{2}$/.test(code)) throw new BadRequestException("countryCode must use a two-letter ISO-style code."); return code; }
  private latitude(value: unknown) { if (typeof value !== "number" || !Number.isFinite(value) || value < -90 || value > 90) throw new BadRequestException("latitude must be between -90 and 90."); return value; }
  private longitude(value: unknown) { if (typeof value !== "number" || !Number.isFinite(value) || value < -180 || value > 180) throw new BadRequestException("longitude must be between -180 and 180."); return value; }
  private escapeLike(value: string) { return value.replace(/[\\%_]/g, (match) => `\\${match}`); }
}
