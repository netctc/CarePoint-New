import { createHash } from "node:crypto";
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Header,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Post,
} from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { Prisma } from "@prisma/client";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { CurrentPrincipal, RequirePermissions } from "../../security/api-security.module";
import { FieldRouteMapsAdapter, type RoutePoint } from "./provider-field-route.maps";

const SAFE_ID = /^[A-Za-z0-9_.:-]{1,180}$/;
const IDEMPOTENCY = /^[A-Za-z0-9_.:-]{8,128}$/;

type EstimateBody = {
  idempotencyKey?: string;
  currentLatitude?: number;
  currentLongitude?: number;
};

type HomeVisitContext = {
  appointmentId: string;
  patientId: string;
  providerId: string;
  serviceId: string;
  status: string;
  scheduledAt: Date;
  destination: {
    addressLine1: string;
    addressLine2: string | null;
    city: string;
    region: string | null;
    postalCode: string | null;
    countryCode: string;
    latitude: number;
    longitude: number;
    addressValidatedAt: Date | null;
  };
};

@Injectable()
class ProviderFieldRouteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
    private readonly maps: FieldRouteMapsAdapter,
  ) {}

  async route(principal: AuthPrincipal, jobIdRaw: string) {
    const provider = await this.requireProvider(principal);
    const context = await this.homeVisit(provider.id, jobIdRaw);
    const latest = await this.prisma.fieldRouteEstimate.findFirst({
      where: { appointmentId: context.appointmentId, providerId: provider.id },
      orderBy: { revision: "desc" },
    });
    await this.audit.write({
      actorId: principal.accountId,
      action: "HOME_VISIT_ROUTE_READ",
      objectType: "APPOINTMENT",
      objectId: context.appointmentId,
      purpose: "FIELD_SERVICE_OPERATIONS",
      result: "SUCCESS",
      metadata: {
        providerId: provider.id,
        estimateAvailable: Boolean(latest),
        estimateSource: latest?.source ?? null,
        providerLocationPersisted: false,
        routeGeometryPersisted: false,
      },
    });
    return this.providerProjection(context, latest);
  }

  async estimate(principal: AuthPrincipal, jobIdRaw: string, input: EstimateBody) {
    const provider = await this.requireProvider(principal);
    const context = await this.homeVisit(provider.id, jobIdRaw);
    if (context.status !== "CONFIRMED") {
      throw new ConflictException("Route estimation is available only for an active confirmed home visit.");
    }
    const idempotencyKey = this.idempotencyKey(input.idempotencyKey);
    const ephemeral = this.ephemeralOrigin(input);
    const originMode = ephemeral ? "PROVIDER_CURRENT_EPHEMERAL" : "SERVICE_COVERAGE_CENTER";
    const requestDigest = this.digest({
      appointmentId: context.appointmentId,
      providerId: provider.id,
      originMode,
      // Deliberately excludes provider coordinates: no historical location derivative is persisted.
    });
    const existing = await this.prisma.fieldRouteEstimate.findUnique({ where: { idempotencyKey } });
    if (existing) {
      if (
        existing.appointmentId !== context.appointmentId ||
        existing.providerId !== provider.id ||
        existing.requestDigest !== requestDigest
      ) {
        throw new ConflictException("idempotencyKey was already used for another route-estimate context.");
      }
      return this.providerProjection(context, existing);
    }

    const origin = ephemeral ?? await this.coverageOrigin(context.serviceId);
    const destination: RoutePoint = {
      latitude: context.destination.latitude,
      longitude: context.destination.longitude,
    };
    const estimate = await this.maps.estimate(origin, destination);
    const now = new Date();

    let created;
    try {
      created = await this.prisma.$transaction(async (tx) => {
        await this.audit.reserveIntegrityChainForSerializableTransaction(tx);
        await tx.$queryRaw(Prisma.sql`SELECT id FROM "Appointment" WHERE id = ${context.appointmentId} FOR UPDATE`);
        const locked = await tx.appointment.findUnique({ where: { id: context.appointmentId } });
        if (
          !locked ||
          locked.providerId !== provider.id ||
          locked.patientId !== context.patientId ||
          locked.modality !== "HOME_VISIT" ||
          locked.status !== "CONFIRMED"
        ) {
          throw new ConflictException("Home-visit job changed before route estimation was recorded.");
        }
        const prior = await tx.fieldRouteEstimate.findFirst({
          where: { appointmentId: context.appointmentId },
          orderBy: { revision: "desc" },
          select: { revision: true },
        });
        const row = await tx.fieldRouteEstimate.create({
          data: {
            appointmentId: context.appointmentId,
            patientId: context.patientId,
            providerId: provider.id,
            revision: (prior?.revision ?? 0) + 1,
            etaMinutes: estimate.etaMinutes,
            distanceMeters: estimate.distanceMeters,
            source: estimate.source,
            idempotencyKey,
            requestDigest,
            generatedAt: now,
          },
        });
        await this.audit.writeInTransaction(tx, {
          actorId: principal.accountId,
          action: "HOME_VISIT_ROUTE_ESTIMATED",
          objectType: "APPOINTMENT",
          objectId: context.appointmentId,
          purpose: "FIELD_SERVICE_OPERATIONS",
          result: "SUCCESS",
          metadata: {
            providerId: provider.id,
            revision: row.revision,
            etaMinutes: row.etaMinutes,
            distanceMeters: row.distanceMeters,
            source: row.source,
            originMode,
            providerLocationPersisted: false,
            routeGeometryPersisted: false,
          },
        });
        return row;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (!this.uniqueConflict(error)) throw error;
      const raced = await this.prisma.fieldRouteEstimate.findUnique({ where: { idempotencyKey } });
      if (!raced || raced.requestDigest !== requestDigest || raced.appointmentId !== context.appointmentId) {
        throw new ConflictException("Route estimate changed concurrently. Refresh and retry.");
      }
      created = raced;
    }
    return {
      ...this.providerProjection(context, created),
      providerState: estimate.providerState,
      originMode,
      currentProviderLocationPersisted: false,
    };
  }

  async patientEta(principal: AuthPrincipal, appointmentIdRaw: string) {
    if (principal.role !== "PATIENT") throw new ForbiddenException("Patient ETA access requires a patient account.");
    const appointmentId = this.requiredId(appointmentIdRaw, "appointmentId");
    const patient = await this.prisma.patientProfile.findUnique({
      where: { userId: principal.accountId },
      select: { id: true },
    });
    if (!patient) throw new NotFoundException("Patient profile not found.");
    const appointment = await this.prisma.appointment.findFirst({
      where: { id: appointmentId, patientId: patient.id, modality: "HOME_VISIT" },
      select: { id: true, status: true, startsAt: true },
    });
    if (!appointment) throw new NotFoundException("Home-visit appointment not found.");
    const latest = await this.prisma.fieldRouteEstimate.findFirst({
      where: { appointmentId, patientId: patient.id },
      orderBy: { revision: "desc" },
      select: { etaMinutes: true, generatedAt: true, source: true },
    });
    await this.audit.write({
      actorId: principal.accountId,
      action: "PATIENT_HOME_VISIT_ETA_READ",
      objectType: "APPOINTMENT",
      objectId: appointment.id,
      purpose: "PATIENT_ACCESS",
      result: "SUCCESS",
      metadata: { estimateAvailable: Boolean(latest), providerLocationExposed: false },
    });
    return {
      appointmentId: appointment.id,
      status: appointment.status,
      scheduledAt: appointment.startsAt,
      etaMinutes: latest?.etaMinutes ?? null,
      estimatedAt: latest?.generatedAt ?? null,
      estimateSource: latest?.source ?? null,
      providerLocation: null,
      providerLocationHistory: [],
      routeGeometry: null,
      privacy: {
        providerLocationExposed: false,
        providerLocationHistoryExposed: false,
        destinationCoordinatesExposed: false,
      },
    };
  }

  private async homeVisit(providerId: string, raw: string): Promise<HomeVisitContext> {
    const appointmentId = this.jobAppointmentId(raw);
    const appointment = await this.prisma.appointment.findFirst({
      where: {
        id: appointmentId,
        providerId,
        modality: "HOME_VISIT",
        status: { in: ["CONFIRMED", "COMPLETED"] },
      },
      select: {
        id: true,
        patientId: true,
        providerId: true,
        serviceId: true,
        status: true,
        startsAt: true,
      },
    });
    if (!appointment) throw new NotFoundException("Assigned home-visit job not found.");
    const visit = await this.prisma.appointmentVisitContext.findUnique({
      where: { appointmentId: appointment.id },
    });
    if (!visit || visit.modality !== "HOME_VISIT" || !visit.addressValidatedAt) {
      throw new ConflictException("Home-visit destination must be validated before route assistance is available.");
    }
    return {
      appointmentId: appointment.id,
      patientId: appointment.patientId,
      providerId: appointment.providerId,
      serviceId: appointment.serviceId,
      status: appointment.status,
      scheduledAt: appointment.startsAt,
      destination: {
        addressLine1: visit.addressLine1,
        addressLine2: visit.addressLine2,
        city: visit.city,
        region: visit.region,
        postalCode: visit.postalCode,
        countryCode: visit.countryCode,
        latitude: Number(visit.latitude),
        longitude: Number(visit.longitude),
        addressValidatedAt: visit.addressValidatedAt,
      },
    };
  }

  private async coverageOrigin(serviceId: string): Promise<RoutePoint> {
    const context = await this.prisma.serviceDeliveryContext.findUnique({
      where: { serviceId_modality: { serviceId, modality: "HOME_VISIT" } },
      select: { homeCoverageCenterLatitude: true, homeCoverageCenterLongitude: true },
    });
    if (
      context?.homeCoverageCenterLatitude == null ||
      context.homeCoverageCenterLongitude == null
    ) {
      throw new ConflictException("Home-visit coverage origin is not configured.");
    }
    return {
      latitude: Number(context.homeCoverageCenterLatitude),
      longitude: Number(context.homeCoverageCenterLongitude),
    };
  }

  private providerProjection(context: HomeVisitContext, latest: {
    revision: number;
    etaMinutes: number;
    distanceMeters: number;
    source: string;
    generatedAt: Date;
  } | null) {
    return {
      jobId: `HOME_VISIT:${context.appointmentId}`,
      appointmentId: context.appointmentId,
      patientId: context.patientId,
      status: context.status,
      scheduledAt: context.scheduledAt,
      destination: context.destination,
      latestEstimate: latest ? {
        revision: latest.revision,
        etaMinutes: latest.etaMinutes,
        distanceMeters: latest.distanceMeters,
        source: latest.source,
        generatedAt: latest.generatedAt,
      } : null,
      maps: this.maps.configuration(),
      privacy: {
        providerLocationPersisted: false,
        providerLocationHistoryPersisted: false,
        routeGeometryPersisted: false,
        patientProjection: ["STATUS", "ETA_MINUTES", "ESTIMATED_AT"],
      },
    };
  }

  private async requireProvider(principal: AuthPrincipal) {
    if (principal.role !== "OTHER_PROVIDER") {
      throw new ForbiddenException("Home-visit route assistance requires an Other Provider account.");
    }
    const provider = await this.prisma.provider.findUnique({
      where: { userId: principal.accountId },
      include: { otherProviderProfile: { include: { category: true } } },
    });
    if (
      !provider ||
      provider.class !== "OTHER_PROVIDER" ||
      provider.status !== "ACTIVE" ||
      !provider.otherProviderProfile?.category.active
    ) {
      throw new ForbiddenException("An active Other Provider profile is required.");
    }
    const capabilities = provider.otherProviderProfile.category.capabilities;
    const raw = capabilities && typeof capabilities === "object" && !Array.isArray(capabilities)
      ? (capabilities as { enabledModalities?: unknown }).enabledModalities
      : null;
    if (!Array.isArray(raw) || !raw.includes("HOME_VISIT")) {
      throw new ForbiddenException("The provider category is not enabled for HOME_VISIT.");
    }
    return provider;
  }

  private jobAppointmentId(raw: unknown): string {
    const value = this.requiredId(raw, "jobId");
    if (value.startsWith("HOME_VISIT:")) return this.requiredId(value.slice("HOME_VISIT:".length), "appointmentId");
    if (value.includes(":")) throw new BadRequestException("Route assistance supports HOME_VISIT jobs only.");
    return value;
  }

  private ephemeralOrigin(input: EstimateBody): RoutePoint | null {
    const hasLatitude = input.currentLatitude !== undefined && input.currentLatitude !== null;
    const hasLongitude = input.currentLongitude !== undefined && input.currentLongitude !== null;
    if (hasLatitude !== hasLongitude) {
      throw new BadRequestException("currentLatitude and currentLongitude must be supplied together.");
    }
    if (!hasLatitude) return null;
    return {
      latitude: this.coordinate(input.currentLatitude, -90, 90, "currentLatitude"),
      longitude: this.coordinate(input.currentLongitude, -180, 180, "currentLongitude"),
    };
  }

  private coordinate(value: unknown, min: number, max: number, field: string): number {
    if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
      throw new BadRequestException(`${field} is invalid.`);
    }
    return value;
  }

  private requiredId(value: unknown, field: string): string {
    if (typeof value !== "string" || !SAFE_ID.test(value.trim())) {
      throw new BadRequestException(`${field} is invalid.`);
    }
    return value.trim();
  }

  private idempotencyKey(value: unknown): string {
    if (typeof value !== "string" || !IDEMPOTENCY.test(value.trim())) {
      throw new BadRequestException("idempotencyKey is invalid.");
    }
    return value.trim();
  }

  private digest(value: unknown): string {
    return createHash("sha256").update(JSON.stringify(value)).digest("hex");
  }

  private uniqueConflict(error: unknown) {
    return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "P2002";
  }
}

@Controller("provider/jobs/:jobId/route")
class ProviderFieldRouteController {
  constructor(private readonly routes: ProviderFieldRouteService) {}

  @RequirePermissions("OTHER_PROVIDER_WORKFLOW_EXECUTE")
  @Get()
  @Header("Cache-Control", "no-store")
  route(@CurrentPrincipal() principal: AuthPrincipal, @Param("jobId") jobId: string) {
    return this.routes.route(principal, jobId);
  }

  @RequirePermissions("OTHER_PROVIDER_WORKFLOW_EXECUTE")
  @Post("estimate")
  @Header("Cache-Control", "no-store")
  estimate(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("jobId") jobId: string,
    @Body() body: EstimateBody,
  ) {
    return this.routes.estimate(principal, jobId, body ?? {});
  }
}

@Controller("patient/appointments")
class PatientHomeVisitEtaController {
  constructor(private readonly routes: ProviderFieldRouteService) {}

  @RequirePermissions("PATIENT_MANAGE_APPOINTMENT")
  @Get(":appointmentId/eta")
  @Header("Cache-Control", "no-store")
  eta(@CurrentPrincipal() principal: AuthPrincipal, @Param("appointmentId") appointmentId: string) {
    return this.routes.patientEta(principal, appointmentId);
  }
}

@Module({
  controllers: [ProviderFieldRouteController, PatientHomeVisitEtaController],
  providers: [ProviderFieldRouteService, FieldRouteMapsAdapter],
})
export class ProviderFieldRouteModule {}
