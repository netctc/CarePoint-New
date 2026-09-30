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

const SAFE_ID = /^[A-Za-z0-9_.:-]{1,180}$/;
const IDEMPOTENCY = /^[A-Za-z0-9_.:-]{8,128}$/;
const ACTIVE_STATUSES = new Set(["ASSIGNED", "EN_ROUTE", "ARRIVED", "TRANSPORTING"]);
const CHECK_STATUSES = new Set(["ASSIGNED", "EN_ROUTE", "ARRIVED"]);
const EQUIPMENT = new Set(["OXYGEN", "MONITORING", "VENTILATION", "WHEELCHAIR", "STRETCHER"]);
const ROUTE_REASONS = new Set(["TRAFFIC", "DIVERSION", "ROAD_CLOSURE", "WEATHER", "FACILITY_DELAY", "OPERATIONAL_UPDATE"]);
const ROUTE_SOURCES = new Set(["PROVIDER_MANUAL", "DISPATCH_UPDATE"]);
const DESTINATION_REASONS = new Set(["FACILITY_UNAVAILABLE", "DISPATCH_REDIRECT", "PATIENT_REQUEST", "OPERATIONAL_CHANGE"]);

type EquipmentCheckBody = {
  confirmedEquipment?: string[];
  idempotencyKey?: string;
};

type RouteRevisionBody = {
  etaMinutes?: number | null;
  reasonCode?: string;
  source?: string;
  idempotencyKey?: string;
};

type DestinationChangeBody = {
  destinationLatitude?: number;
  destinationLongitude?: number;
  destinationAddress?: string | null;
  reasonCode?: string;
  idempotencyKey?: string;
};

type Responder = { id: string; mode: "GROUND" | "AIR" };

@Injectable()
class TransportAdvancedLifecycleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
  ) {}

  async get(principal: AuthPrincipal, requestIdRaw: string) {
    const responder = await this.requireResponder(principal);
    const request = await this.requireAssignedRequest(responder, requestIdRaw);
    const [checks, revisions, crew] = await Promise.all([
      this.prisma.transportEquipmentCheck.findMany({
        where: { transportRequestId: request.id, providerId: responder.id },
        orderBy: { revision: "desc" },
        take: 50,
      }),
      this.prisma.transportRouteRevision.findMany({
        where: { transportRequestId: request.id, providerId: responder.id },
        orderBy: { revision: "desc" },
        take: 50,
      }),
      this.prisma.crewAssignment.findFirst({
        where: { transportRequestId: request.id, providerId: responder.id },
        orderBy: { revision: "desc" },
      }),
    ]);

    const requiredEquipment = this.requiredEquipment(request.assistance, request.equipment);
    return {
      requestId: request.id,
      lifecycleStatus: request.status,
      etaMinutes: request.etaMinutes,
      requiredEquipment,
      equipmentCheckRequired: requiredEquipment.length > 0,
      currentCrewAssignmentRevision: crew?.revision ?? null,
      equipmentChecks: checks.map((check) => ({
        id: check.id,
        revision: check.revision,
        status: check.status,
        requiredEquipment: check.requiredEquipment,
        confirmedEquipment: check.confirmedEquipment,
        missingEquipment: check.missingEquipment,
        transportUnitId: check.transportUnitId,
        crewAssignmentId: check.crewAssignmentId,
        checkedAt: check.checkedAt,
      })),
      routeRevisions: revisions.map((revision) => ({
        id: revision.id,
        revision: revision.revision,
        lifecycleStatus: revision.lifecycleStatus,
        etaMinutes: revision.etaMinutes,
        reasonCode: revision.reasonCode,
        source: revision.source,
        destinationChanged: revision.destinationLatitude !== null && revision.destinationLongitude !== null,
        createdAt: revision.createdAt,
      })),
      privacyBoundary: {
        patientIdentityReturned: false,
        pickupCoordinatesReturned: false,
        destinationCoordinatesReturned: false,
        addressesReturned: false,
        callbackPhoneReturned: false,
      },
    };
  }

  async equipmentCheck(principal: AuthPrincipal, requestIdRaw: string, input: EquipmentCheckBody) {
    const responder = await this.requireResponder(principal);
    const request = await this.requireAssignedRequest(responder, requestIdRaw);
    if (!CHECK_STATUSES.has(request.status)) {
      throw new ConflictException("Equipment readiness can only be checked before patient transport starts.");
    }
    const idempotencyKey = this.idempotencyKey(input.idempotencyKey);
    const confirmedEquipment = this.equipmentList(input.confirmedEquipment ?? []);
    const requiredEquipment = this.requiredEquipment(request.assistance, request.equipment);
    const missingEquipment = requiredEquipment.filter((item) => !confirmedEquipment.includes(item));
    const status = missingEquipment.length === 0 ? "PASS" : "FAIL";
    const currentCrew = await this.prisma.crewAssignment.findFirst({
      where: { transportRequestId: request.id, providerId: responder.id },
      orderBy: { revision: "desc" },
    });
    const unit = currentCrew?.transportUnitId
      ? await this.prisma.transportUnit.findFirst({
          where: { id: currentCrew.transportUnitId, providerId: responder.id, mode: responder.mode, active: true },
        })
      : null;
    if (requiredEquipment.length > 0 && !unit) {
      throw new ConflictException("Assign a compatible transport unit before recording equipment readiness.");
    }
    if (unit) {
      const capabilities = new Set(unit.capabilities.map((value) => value.trim().toUpperCase()));
      const impossible = confirmedEquipment.filter((item) => !capabilities.has(item));
      if (impossible.length > 0) {
        throw new BadRequestException("Confirmed equipment contains capabilities not registered for the assigned transport unit.");
      }
    }

    const requestDigest = this.digest({
      requestId: request.id,
      providerId: responder.id,
      crewAssignmentId: currentCrew?.id ?? null,
      transportUnitId: unit?.id ?? null,
      requiredEquipment,
      confirmedEquipment,
    });
    const existing = await this.prisma.transportEquipmentCheck.findUnique({ where: { idempotencyKey } });
    if (existing) {
      if (existing.transportRequestId !== request.id || existing.providerId !== responder.id || existing.requestDigest !== requestDigest) {
        throw new ConflictException("idempotencyKey was already used with different equipment-check content.");
      }
      return this.get(principal, request.id);
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        await this.audit.reserveIntegrityChainForSerializableTransaction(tx);
        await tx.$queryRaw(Prisma.sql`SELECT id FROM "MedicalTransportRequest" WHERE id = ${request.id} FOR UPDATE`);
        const locked = await tx.medicalTransportRequest.findUnique({ where: { id: request.id } });
        if (!locked || locked.assignedProviderId !== responder.id || locked.mode !== responder.mode) {
          throw new NotFoundException("Assigned medical transport job not found.");
        }
        if (!CHECK_STATUSES.has(locked.status)) {
          throw new ConflictException("Equipment readiness can only be checked before patient transport starts.");
        }
        const prior = await tx.transportEquipmentCheck.findFirst({
          where: { transportRequestId: request.id },
          orderBy: { revision: "desc" },
          select: { revision: true },
        });
        const created = await tx.transportEquipmentCheck.create({
          data: {
            transportRequestId: request.id,
            providerId: responder.id,
            crewAssignmentId: currentCrew?.id ?? null,
            transportUnitId: unit?.id ?? null,
            revision: (prior?.revision ?? 0) + 1,
            idempotencyKey,
            requestDigest,
            requiredEquipment,
            confirmedEquipment,
            missingEquipment,
            status,
            checkedByAccountId: principal.accountId,
            checkedAt: new Date(),
          },
        });
        await this.audit.writeInTransaction(tx, {
          actorId: principal.accountId,
          action: "MEDICAL_TRANSPORT_EQUIPMENT_CHECK_RECORDED",
          objectType: "MEDICAL_TRANSPORT_REQUEST",
          objectId: request.id,
          purpose: "MEDICAL_TRANSPORT",
          result: "SUCCESS",
          metadata: {
            providerId: responder.id,
            revision: created.revision,
            status,
            requiredCount: requiredEquipment.length,
            confirmedCount: confirmedEquipment.length,
            missingCount: missingEquipment.length,
            transportUnitId: unit?.id ?? null,
          },
        });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (!this.uniqueConflict(error)) throw error;
      const raced = await this.prisma.transportEquipmentCheck.findUnique({ where: { idempotencyKey } });
      if (!raced || raced.requestDigest !== requestDigest || raced.transportRequestId !== request.id) {
        throw new ConflictException("Equipment readiness changed concurrently. Refresh and retry.");
      }
    }
    return this.get(principal, request.id);
  }

  async routeRevision(principal: AuthPrincipal, requestIdRaw: string, input: RouteRevisionBody) {
    const responder = await this.requireResponder(principal);
    const request = await this.requireAssignedRequest(responder, requestIdRaw);
    if (!ACTIVE_STATUSES.has(request.status)) {
      throw new ConflictException("Route revisions are available only for an active assigned transport job.");
    }
    const idempotencyKey = this.idempotencyKey(input.idempotencyKey);
    const reasonCode = this.vocabulary(input.reasonCode, ROUTE_REASONS, "reasonCode");
    const source = this.vocabulary(input.source ?? "PROVIDER_MANUAL", ROUTE_SOURCES, "source");
    const etaMinutes = this.eta(input.etaMinutes);
    const requestDigest = this.digest({
      requestId: request.id,
      providerId: responder.id,
      lifecycleStatus: request.status,
      etaMinutes,
      reasonCode,
      source,
    });

    const existing = await this.prisma.transportRouteRevision.findUnique({ where: { idempotencyKey } });
    if (existing) {
      if (existing.transportRequestId !== request.id || existing.providerId !== responder.id || existing.requestDigest !== requestDigest) {
        throw new ConflictException("idempotencyKey was already used with different route-revision content.");
      }
      return this.get(principal, request.id);
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        await this.audit.reserveIntegrityChainForSerializableTransaction(tx);
        await tx.$queryRaw(Prisma.sql`SELECT id FROM "MedicalTransportRequest" WHERE id = ${request.id} FOR UPDATE`);
        const locked = await tx.medicalTransportRequest.findUnique({ where: { id: request.id } });
        if (!locked || locked.assignedProviderId !== responder.id || locked.mode !== responder.mode) {
          throw new NotFoundException("Assigned medical transport job not found.");
        }
        if (!ACTIVE_STATUSES.has(locked.status)) {
          throw new ConflictException("Route revisions are available only for an active assigned transport job.");
        }
        const prior = await tx.transportRouteRevision.findFirst({
          where: { transportRequestId: request.id },
          orderBy: { revision: "desc" },
          select: { revision: true },
        });
        const created = await tx.transportRouteRevision.create({
          data: {
            transportRequestId: request.id,
            providerId: responder.id,
            revision: (prior?.revision ?? 0) + 1,
            idempotencyKey,
            requestDigest,
            lifecycleStatus: locked.status,
            etaMinutes,
            reasonCode,
            source,
            createdByAccountId: principal.accountId,
          },
        });
        if (etaMinutes !== null && etaMinutes !== locked.etaMinutes) {
          await tx.medicalTransportRequest.update({ where: { id: request.id }, data: { etaMinutes } });
        }
        await this.audit.writeInTransaction(tx, {
          actorId: principal.accountId,
          action: "MEDICAL_TRANSPORT_ROUTE_REVISION_RECORDED",
          objectType: "MEDICAL_TRANSPORT_REQUEST",
          objectId: request.id,
          purpose: "MEDICAL_TRANSPORT",
          result: "SUCCESS",
          metadata: {
            providerId: responder.id,
            revision: created.revision,
            lifecycleStatus: locked.status,
            etaMinutes,
            reasonCode,
            source,
          },
        });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (!this.uniqueConflict(error)) throw error;
      const raced = await this.prisma.transportRouteRevision.findUnique({ where: { idempotencyKey } });
      if (!raced || raced.requestDigest !== requestDigest || raced.transportRequestId !== request.id) {
        throw new ConflictException("Route revision changed concurrently. Refresh and retry.");
      }
    }
    return this.get(principal, request.id);
  }


  async destinationChange(principal: AuthPrincipal, requestIdRaw: string, input: DestinationChangeBody) {
    const responder = await this.requireResponder(principal);
    const request = await this.requireAssignedRequest(responder, requestIdRaw);
    if (!ACTIVE_STATUSES.has(request.status)) {
      throw new ConflictException("Destination changes are available only for an active assigned transport job.");
    }
    const idempotencyKey = this.idempotencyKey(input.idempotencyKey);
    const destinationLatitude = this.coordinate(input.destinationLatitude, -90, 90, "destinationLatitude");
    const destinationLongitude = this.coordinate(input.destinationLongitude, -180, 180, "destinationLongitude");
    const destinationAddress = this.optionalAddress(input.destinationAddress);
    const reasonCode = this.vocabulary(input.reasonCode, DESTINATION_REASONS, "reasonCode");
    const requestDigest = this.digest({
      requestId: request.id,
      providerId: responder.id,
      destinationLatitude,
      destinationLongitude,
      destinationAddress,
      reasonCode,
    });

    const existing = await this.prisma.transportRouteRevision.findUnique({ where: { idempotencyKey } });
    if (existing) {
      if (
        existing.transportRequestId !== request.id ||
        existing.providerId !== responder.id ||
        existing.requestDigest !== requestDigest
      ) {
        throw new ConflictException("idempotencyKey was already used with different destination-change content.");
      }
      return this.currentDestination(principal, request.id);
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        await this.audit.reserveIntegrityChainForSerializableTransaction(tx);
        await tx.$queryRaw(Prisma.sql`SELECT id FROM "MedicalTransportRequest" WHERE id = ${request.id} FOR UPDATE`);
        const locked = await tx.medicalTransportRequest.findUnique({ where: { id: request.id } });
        if (!locked || locked.assignedProviderId !== responder.id || locked.mode !== responder.mode) {
          throw new NotFoundException("Assigned medical transport job not found.");
        }
        if (!ACTIVE_STATUSES.has(locked.status)) {
          throw new ConflictException("Destination changes are available only for an active assigned transport job.");
        }

        const sameCoordinates =
          Number(locked.destinationLatitude) === destinationLatitude &&
          Number(locked.destinationLongitude) === destinationLongitude;
        const sameAddress = (locked.destinationAddress ?? null) === destinationAddress;
        if (sameCoordinates && sameAddress) {
          throw new ConflictException("New destination must differ from the current destination.");
        }

        const prior = await tx.transportRouteRevision.findFirst({
          where: { transportRequestId: request.id },
          orderBy: { revision: "desc" },
          select: { revision: true },
        });
        const created = await tx.transportRouteRevision.create({
          data: {
            transportRequestId: request.id,
            providerId: responder.id,
            revision: (prior?.revision ?? 0) + 1,
            idempotencyKey,
            requestDigest,
            lifecycleStatus: locked.status,
            etaMinutes: null,
            reasonCode,
            source: "PROVIDER_DESTINATION_CHANGE",
            previousDestinationLatitude: locked.destinationLatitude,
            previousDestinationLongitude: locked.destinationLongitude,
            previousDestinationAddress: locked.destinationAddress,
            destinationLatitude,
            destinationLongitude,
            destinationAddress,
            createdByAccountId: principal.accountId,
          },
        });
        await tx.medicalTransportRequest.update({
          where: { id: request.id },
          data: {
            destinationLatitude,
            destinationLongitude,
            destinationAddress,
            etaMinutes: null,
          },
        });
        await this.audit.writeInTransaction(tx, {
          actorId: principal.accountId,
          action: "MEDICAL_TRANSPORT_DESTINATION_CHANGED",
          objectType: "MEDICAL_TRANSPORT_REQUEST",
          objectId: request.id,
          purpose: "MEDICAL_TRANSPORT",
          result: "SUCCESS",
          metadata: {
            providerId: responder.id,
            revision: created.revision,
            lifecycleStatus: locked.status,
            reasonCode,
            destinationAddressPresent: destinationAddress !== null,
          },
        });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (!this.uniqueConflict(error)) throw error;
      const raced = await this.prisma.transportRouteRevision.findUnique({ where: { idempotencyKey } });
      if (!raced || raced.requestDigest !== requestDigest || raced.transportRequestId !== request.id) {
        throw new ConflictException("Destination changed concurrently. Refresh and retry.");
      }
    }
    return this.currentDestination(principal, request.id);
  }

  private async currentDestination(principal: AuthPrincipal, requestIdRaw: string) {
    const responder = await this.requireResponder(principal);
    const request = await this.requireAssignedRequest(responder, requestIdRaw);
    return {
      requestId: request.id,
      destinationLatitude: Number(request.destinationLatitude),
      destinationLongitude: Number(request.destinationLongitude),
      destinationAddress: request.destinationAddress,
      etaMinutes: request.etaMinutes,
      etaRequiresRefresh: request.etaMinutes === null,
    };
  }

  private async requireResponder(principal: AuthPrincipal): Promise<Responder> {
    const provider = await this.prisma.provider.findUnique({
      where: { userId: principal.accountId },
      include: { otherProviderProfile: { include: { category: true } } },
    });
    const family = provider?.otherProviderProfile?.category.family;
    if (!provider || provider.class !== "OTHER_PROVIDER" || provider.status !== "ACTIVE" || !provider.otherProviderProfile?.category.active || (family !== "MEDICAL_TRANSPORT_GROUND" && family !== "MEDICAL_TRANSPORT_AIR")) {
      throw new ForbiddenException("This Other Provider account is not authorized for advanced transport lifecycle operations.");
    }
    return { id: provider.id, mode: family === "MEDICAL_TRANSPORT_AIR" ? "AIR" : "GROUND" };
  }

  private async requireAssignedRequest(responder: Responder, requestIdRaw: string) {
    const requestId = this.requiredId(requestIdRaw, "requestId");
    const request = await this.prisma.medicalTransportRequest.findFirst({
      where: { id: requestId, assignedProviderId: responder.id, mode: responder.mode },
    });
    if (!request) throw new NotFoundException("Assigned medical transport job not found.");
    return request;
  }

  private requiredEquipment(assistance: string, requestEquipment: readonly string[]): string[] {
    const required = new Set(requestEquipment.map((value) => value.toString().trim().toUpperCase()));
    if (assistance === "WHEELCHAIR") required.add("WHEELCHAIR");
    if (assistance === "STRETCHER") required.add("STRETCHER");
    return [...required].filter((value) => EQUIPMENT.has(value)).sort();
  }

  private equipmentList(value: unknown): string[] {
    if (!Array.isArray(value) || value.length > 8) throw new BadRequestException("confirmedEquipment must be an array with at most 8 items.");
    const normalized = value.map((item) => this.vocabulary(item, EQUIPMENT, "confirmedEquipment")).sort();
    if (new Set(normalized).size !== normalized.length) throw new BadRequestException("confirmedEquipment cannot contain duplicates.");
    return normalized;
  }


  private coordinate(value: unknown, min: number, max: number, field: string): number {
    if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
      throw new BadRequestException(`${field} must be a finite number between ${min} and ${max}.`);
    }
    return Math.round(value * 1_000_000) / 1_000_000;
  }

  private optionalAddress(value: unknown): string | null {
    if (value === undefined || value === null || value === "") return null;
    if (typeof value !== "string") throw new BadRequestException("destinationAddress must be text.");
    const normalized = value.trim();
    if (!normalized || normalized.length > 500 || /\p{Cc}/u.test(normalized)) {
      throw new BadRequestException("destinationAddress is invalid.");
    }
    return normalized;
  }

  private eta(value: unknown): number | null {
    if (value === undefined || value === null || value === "") return null;
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 1440) {
      throw new BadRequestException("etaMinutes must be an integer between 0 and 1440.");
    }
    return value;
  }

  private vocabulary(value: unknown, allowed: Set<string>, field: string): string {
    if (typeof value !== "string") throw new BadRequestException(`${field} is required.`);
    const normalized = value.trim().toUpperCase();
    if (!allowed.has(normalized)) throw new BadRequestException(`${field} is invalid.`);
    return normalized;
  }

  private requiredId(value: unknown, field: string): string {
    if (typeof value !== "string" || !SAFE_ID.test(value.trim())) throw new BadRequestException(`${field} is invalid.`);
    return value.trim();
  }

  private idempotencyKey(value: unknown): string {
    if (typeof value !== "string" || !IDEMPOTENCY.test(value.trim())) throw new BadRequestException("idempotencyKey is invalid.");
    return value.trim();
  }

  private digest(value: unknown): string {
    return createHash("sha256").update(JSON.stringify(value)).digest("hex");
  }

  private uniqueConflict(error: unknown): boolean {
    return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "P2002";
  }
}

@RequirePermissions("TRANSPORT_RESPOND")
@Controller("provider/transport/jobs")
class TransportAdvancedLifecycleController {
  constructor(private readonly lifecycle: TransportAdvancedLifecycleService) {}

  @Get(":id/advanced-lifecycle")
  @Header("Cache-Control", "no-store")
  get(@CurrentPrincipal() principal: AuthPrincipal, @Param("id") id: string) {
    return this.lifecycle.get(principal, id);
  }

  @Post(":id/equipment-checks")
  @Header("Cache-Control", "no-store")
  equipmentCheck(@CurrentPrincipal() principal: AuthPrincipal, @Param("id") id: string, @Body() body: EquipmentCheckBody) {
    return this.lifecycle.equipmentCheck(principal, id, body ?? {});
  }

  @Post(":id/route-revisions")
  @Header("Cache-Control", "no-store")
  routeRevision(@CurrentPrincipal() principal: AuthPrincipal, @Param("id") id: string, @Body() body: RouteRevisionBody) {
    return this.lifecycle.routeRevision(principal, id, body ?? {});
  }

  @Post(":id/destination-change")
  @Header("Cache-Control", "no-store")
  destinationChange(@CurrentPrincipal() principal: AuthPrincipal, @Param("id") id: string, @Body() body: DestinationChangeBody) {
    return this.lifecycle.destinationChange(principal, id, body ?? {});
  }
}

@Module({
  controllers: [TransportAdvancedLifecycleController],
  providers: [TransportAdvancedLifecycleService],
})
export class TransportAdvancedLifecycleModule {}
