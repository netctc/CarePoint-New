import { createHash } from "node:crypto";
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Header,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Post,
  Query,
} from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { Prisma } from "@prisma/client";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { jsonStringArray, missingCurrentCredentialTypes } from "../../security/provider-credential-validity";
import { CurrentPrincipal, RequirePermissions } from "../../security/api-security.module";
import {
  TransportSavedLocationsModule,
  TransportSavedLocationsService,
} from "./transport-saved-locations.module";

const ACTIVE_STATUSES = ["REQUESTED", "ASSIGNED", "EN_ROUTE", "ARRIVED", "TRANSPORTING"] as const;
const ETA_MUTABLE_STATUSES = new Set(["ASSIGNED", "EN_ROUTE", "ARRIVED", "TRANSPORTING"]);
const STATUS_FILTERS = new Set(ACTIVE_STATUSES);
const MODE_FILTERS = new Set(["GROUND", "AIR"]);
const IDEMPOTENCY = /^[A-Za-z0-9_.:-]{8,128}$/;

type EtaRefreshBody = {
  idempotencyKey?: unknown;
};

type RefreshSource = "DISPATCH_UPDATE" | "PROVIDER_ROUTE_PROVIDER";

@Injectable()
class TransportDispatchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
    private readonly routes: TransportSavedLocationsService,
  ) {}

  async board(
    principal: AuthPrincipal,
    rawStatus?: string,
    rawMode?: string,
  ) {
    const status = rawStatus?.trim().toUpperCase();
    const mode = rawMode?.trim().toUpperCase();
    if (status && !STATUS_FILTERS.has(status as (typeof ACTIVE_STATUSES)[number])) {
      throw new BadRequestException("Unsupported medical transport status.");
    }
    if (mode && !MODE_FILTERS.has(mode)) {
      throw new BadRequestException("Unsupported medical transport mode.");
    }

    const requests = await this.prisma.medicalTransportRequest.findMany({
      where: {
        status: status
          ? (status as any)
          : { in: [...ACTIVE_STATUSES] as any[] },
        ...(mode ? { mode: mode as any } : {}),
      },
      orderBy: [{ scheduledFor: "asc" }, { requestedAt: "asc" }],
      take: 250,
    });

    const requestIds = requests.map((row) => row.id);
    const patientIds = [...new Set(requests.map((row) => row.patientId))];
    const assignedProviderIds = [
      ...new Set(
        requests
          .map((row) => row.assignedProviderId)
          .filter((value): value is string => Boolean(value)),
      ),
    ];

    const providerCandidates = await this.prisma.provider.findMany({
      where: {
        class: "OTHER_PROVIDER",
        otherProviderProfile: {
          category: {
            family: { in: ["MEDICAL_TRANSPORT_GROUND", "MEDICAL_TRANSPORT_AIR"] },
          },
        },
      },
      include: {
        user: { select: { id: true, email: true, status: true } },
        credentials: true,
        otherProviderProfile: { include: { category: true } },
      },
      orderBy: [{ displayName: "asc" }, { id: "asc" }],
      take: 500,
    });
    const candidateIds = providerCandidates.map((row) => row.id);

    const [patients, crewAssignments, routeRevisions, units] = await Promise.all([
      patientIds.length
        ? this.prisma.patientProfile.findMany({
            where: { id: { in: patientIds } },
            select: { id: true, firstName: true, lastName: true, phone: true },
          })
        : [],
      requestIds.length
        ? this.prisma.crewAssignment.findMany({
            where: { transportRequestId: { in: requestIds } },
            orderBy: { assignedAt: "desc" },
            take: 2500,
          })
        : [],
      requestIds.length
        ? this.prisma.transportRouteRevision.findMany({
            where: { transportRequestId: { in: requestIds } },
            orderBy: { createdAt: "desc" },
            take: 2500,
          })
        : [],
      candidateIds.length || assignedProviderIds.length
        ? this.prisma.transportUnit.findMany({
            where: {
              providerId: {
                in: [...new Set([...candidateIds, ...assignedProviderIds])],
              },
            },
            orderBy: [{ providerId: "asc" }, { code: "asc" }],
          })
        : [],
    ]);

    const patientById = new Map(patients.map((row) => [row.id, row]));
    const providerById = new Map(providerCandidates.map((row) => [row.id, row]));
    const unitById = new Map(units.map((row) => [row.id, row]));
    const unitsByProvider = new Map<string, typeof units>();
    for (const unit of units) {
      const current = unitsByProvider.get(unit.providerId) ?? [];
      current.push(unit);
      unitsByProvider.set(unit.providerId, current);
    }

    const latestCrewByRequest = new Map<string, (typeof crewAssignments)[number]>();
    for (const row of crewAssignments) {
      if (!latestCrewByRequest.has(row.transportRequestId)) {
        latestCrewByRequest.set(row.transportRequestId, row);
      }
    }
    const latestRouteByRequest = new Map<string, (typeof routeRevisions)[number]>();
    for (const row of routeRevisions) {
      if (!latestRouteByRequest.has(row.transportRequestId)) {
        latestRouteByRequest.set(row.transportRequestId, row);
      }
    }

    const activeJobsByProvider = new Map<string, number>();
    for (const row of requests) {
      if (!row.assignedProviderId) continue;
      activeJobsByProvider.set(
        row.assignedProviderId,
        (activeJobsByProvider.get(row.assignedProviderId) ?? 0) + 1,
      );
    }

    const providers = providerCandidates.map((provider) => {
      const category = provider.otherProviderProfile?.category;
      const family = category?.family ?? null;
      const expectedMode = family === "MEDICAL_TRANSPORT_AIR" ? "AIR" : "GROUND";
      const requiredCredentials = jsonStringArray(category?.requiredCredentialTypes);
      const usableCredentials = (provider.credentials ?? []).filter(
        (credential: { status?: string }) =>
          credential.status === "VALID" || credential.status === "VERIFIED",
      );
      const missingCredentialTypes = missingCurrentCredentialTypes(
        requiredCredentials,
        usableCredentials,
      );
      const providerUnits = unitsByProvider.get(provider.id) ?? [];
      const activeUnits = providerUnits.filter(
        (unit) => unit.active && unit.mode === expectedMode,
      );
      const dispatchReady =
        provider.status === "ACTIVE" &&
        provider.user?.status === "ACTIVE" &&
        category?.active === true &&
        missingCredentialTypes.length === 0 &&
        activeUnits.length > 0;

      return {
        id: provider.id,
        displayName: provider.displayName,
        mode: expectedMode,
        family,
        dispatchReady,
        activeJobs: activeJobsByProvider.get(provider.id) ?? 0,
        activeUnitCount: activeUnits.length,
        missingCredentialTypes,
      };
    });

    const capabilities = this.routes.capabilities();
    const items = requests.map((request) => {
      const patient = patientById.get(request.patientId) ?? null;
      const provider = request.assignedProviderId
        ? providerById.get(request.assignedProviderId) ?? null
        : null;
      const crew = latestCrewByRequest.get(request.id) ?? null;
      const unit = crew?.transportUnitId
        ? unitById.get(crew.transportUnitId) ?? null
        : null;
      const latestRoute = latestRouteByRequest.get(request.id) ?? null;
      const assignmentState = !request.assignedProviderId
        ? "UNASSIGNED"
        : !crew
          ? "PROVIDER_ASSIGNED"
          : !crew.transportUnitId || crew.crewProviderIds.length === 0
            ? "RESOURCES_PARTIAL"
            : "RESOURCES_READY";
      const etaState = request.mode !== "GROUND"
        ? "NOT_APPLICABLE"
        : request.etaMinutes != null
          ? "CURRENT"
          : latestRoute?.source === "PROVIDER_DESTINATION_CHANGE"
            ? "STALE_AFTER_DESTINATION_CHANGE"
            : "MISSING";

      return {
        id: request.id,
        mode: request.mode,
        status: request.status,
        assistance: request.assistance,
        equipment: request.equipment ?? [],
        companionCount: request.companionCount,
        scheduledFor: request.scheduledFor,
        requestedAt: request.requestedAt,
        updatedAt: request.updatedAt,
        pickup: {
          address: request.pickupAddress,
          latitude: request.pickupLatitude == null ? null : Number(request.pickupLatitude),
          longitude: request.pickupLongitude == null ? null : Number(request.pickupLongitude),
        },
        destination: {
          address: request.destinationAddress,
          latitude: request.destinationLatitude == null ? null : Number(request.destinationLatitude),
          longitude: request.destinationLongitude == null ? null : Number(request.destinationLongitude),
        },
        callbackPhone: request.callbackPhone,
        patient,
        assignedProvider: provider
          ? {
              id: provider.id,
              displayName: provider.displayName,
              status: provider.status,
            }
          : null,
        resources: crew
          ? {
              revision: crew.revision,
              assignedAt: crew.assignedAt,
              crewProviderIds: crew.crewProviderIds,
              unit: unit
                ? {
                    id: unit.id,
                    code: unit.code,
                    registrationCode: unit.registrationCode,
                    mode: unit.mode,
                    active: unit.active,
                  }
                : null,
            }
          : null,
        assignmentState,
        etaMinutes: request.etaMinutes,
        etaState,
        canRecalculateEta:
          request.mode === "GROUND" &&
          Boolean(request.assignedProviderId) &&
          ETA_MUTABLE_STATUSES.has(request.status),
        latestRouteRevision: latestRoute
          ? {
              revision: latestRoute.revision,
              etaMinutes: latestRoute.etaMinutes,
              reasonCode: latestRoute.reasonCode,
              source: latestRoute.source,
              createdAt: latestRoute.createdAt,
            }
          : null,
      };
    });

    await this.audit.write({
      actorId: principal.accountId,
      action: "ADMIN_TRANSPORT_DISPATCH_BOARD_READ",
      objectType: "TRANSPORT_DISPATCH_BOARD",
      objectId: "ACTIVE",
      purpose: "TRANSPORT_OPERATIONS",
      result: "SUCCESS",
      metadata: { resultCount: items.length, status: status ?? null, mode: mode ?? null },
    });

    return {
      generatedAt: new Date().toISOString(),
      route: {
        provider: capabilities.routeProvider,
        available: capabilities.routePreviewAvailable,
      },
      summary: {
        total: items.length,
        unassigned: items.filter((row) => row.assignmentState === "UNASSIGNED").length,
        resourceReady: items.filter((row) => row.assignmentState === "RESOURCES_READY").length,
        etaAttention: items.filter(
          (row) =>
            row.etaState === "MISSING" ||
            row.etaState === "STALE_AFTER_DESTINATION_CHANGE",
        ).length,
      },
      providers,
      items,
    };
  }

  async refreshEtaForOperations(
    principal: AuthPrincipal,
    requestIdRaw: string,
    body: EtaRefreshBody,
  ) {
    const request = await this.requireRequest(requestIdRaw);
    if (!request.assignedProviderId) {
      throw new ConflictException("Assign a transport provider before persisting an ETA.");
    }
    return this.refreshEta(
      principal,
      request,
      request.assignedProviderId,
      this.idempotencyKey(body.idempotencyKey),
      "DISPATCH_UPDATE",
    );
  }

  async refreshEtaForProvider(
    principal: AuthPrincipal,
    requestIdRaw: string,
    body: EtaRefreshBody,
  ) {
    const provider = await this.prisma.provider.findUnique({
      where: { userId: principal.accountId },
      include: { otherProviderProfile: { include: { category: true } } },
    });
    const family = provider?.otherProviderProfile?.category.family;
    if (
      !provider ||
      provider.class !== "OTHER_PROVIDER" ||
      provider.status !== "ACTIVE" ||
      !provider.otherProviderProfile?.category.active ||
      (family !== "MEDICAL_TRANSPORT_GROUND" &&
        family !== "MEDICAL_TRANSPORT_AIR")
    ) {
      throw new NotFoundException("Assigned medical transport job not found.");
    }

    const request = await this.requireRequest(requestIdRaw);
    if (request.assignedProviderId !== provider.id) {
      throw new NotFoundException("Assigned medical transport job not found.");
    }
    return this.refreshEta(
      principal,
      request,
      provider.id,
      this.idempotencyKey(body.idempotencyKey),
      "PROVIDER_ROUTE_PROVIDER",
    );
  }

  private async refreshEta(
    principal: AuthPrincipal,
    request: Awaited<ReturnType<TransportDispatchService["requireRequest"]>>,
    providerId: string,
    idempotencyKey: string,
    source: RefreshSource,
  ) {
    if (request.mode !== "GROUND") {
      return {
        requestId: request.id,
        persisted: false,
        replayed: false,
        etaMinutes: request.etaMinutes,
        preview: {
          ...this.routes.capabilities(),
          available: false,
          reason: "AIR_NOT_SUPPORTED",
          mode: request.mode,
        },
      };
    }
    if (!ETA_MUTABLE_STATUSES.has(request.status)) {
      throw new ConflictException("ETA recalculation is available only for an active assigned transport job.");
    }

    const existing = await this.prisma.transportRouteRevision.findUnique({
      where: { idempotencyKey },
    });
    if (existing) {
      if (
        existing.transportRequestId !== request.id ||
        existing.providerId !== providerId ||
        existing.source !== source
      ) {
        throw new ConflictException(
          "idempotencyKey was already used with different ETA recalculation content.",
        );
      }
      return {
        requestId: request.id,
        persisted: true,
        replayed: true,
        etaMinutes: existing.etaMinutes,
        preview: {
          ...this.routes.capabilities(),
          available: existing.etaMinutes != null,
          mode: request.mode,
          etaMinutes: existing.etaMinutes,
        },
      };
    }

    const preview = await this.routes.routePreviewForRequest(principal, request.id);
    const etaMinutes =
      preview?.available === true && Number.isFinite(Number(preview?.etaMinutes))
        ? Math.max(1, Math.round(Number(preview.etaMinutes)))
        : null;
    if (etaMinutes == null) {
      return {
        requestId: request.id,
        persisted: false,
        replayed: false,
        etaMinutes: request.etaMinutes,
        preview,
      };
    }

    const requestDigest = createHash("sha256")
      .update(
        JSON.stringify({
          requestId: request.id,
          providerId,
          requestUpdatedAt: request.updatedAt.toISOString(),
          etaMinutes,
          source,
        }),
      )
      .digest("hex");

    try {
      await this.prisma.$transaction(
        async (tx) => {
          await this.audit.reserveIntegrityChainForSerializableTransaction(tx);
          await tx.$queryRaw(
            Prisma.sql`SELECT id FROM "MedicalTransportRequest" WHERE id = ${request.id} FOR UPDATE`,
          );
          const locked = await tx.medicalTransportRequest.findUnique({
            where: { id: request.id },
          });
          if (
            !locked ||
            locked.assignedProviderId !== providerId ||
            locked.mode !== "GROUND"
          ) {
            throw new NotFoundException("Assigned medical transport job not found.");
          }
          if (!ETA_MUTABLE_STATUSES.has(locked.status)) {
            throw new ConflictException(
              "ETA recalculation is available only for an active assigned transport job.",
            );
          }
          if (locked.updatedAt.getTime() !== request.updatedAt.getTime()) {
            throw new ConflictException(
              "Medical transport changed while ETA was being calculated. Recalculate again.",
            );
          }

          const prior = await tx.transportRouteRevision.findFirst({
            where: { transportRequestId: request.id },
            orderBy: { revision: "desc" },
            select: { revision: true },
          });
          const created = await tx.transportRouteRevision.create({
            data: {
              transportRequestId: request.id,
              providerId,
              revision: (prior?.revision ?? 0) + 1,
              idempotencyKey,
              requestDigest,
              lifecycleStatus: locked.status,
              etaMinutes,
              reasonCode: "OPERATIONAL_UPDATE",
              source,
              createdByAccountId: principal.accountId,
            },
          });
          await tx.medicalTransportRequest.update({
            where: { id: request.id },
            data: { etaMinutes },
          });
          await this.audit.writeInTransaction(tx, {
            actorId: principal.accountId,
            action: "MEDICAL_TRANSPORT_ETA_RECALCULATED",
            objectType: "MEDICAL_TRANSPORT_REQUEST",
            objectId: request.id,
            purpose: "MEDICAL_TRANSPORT",
            result: "SUCCESS",
            metadata: {
              providerId,
              revision: created.revision,
              etaMinutes,
              routeProvider: preview?.routeProvider ?? null,
              source,
            },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (!this.uniqueConflict(error)) throw error;
      const raced = await this.prisma.transportRouteRevision.findUnique({
        where: { idempotencyKey },
      });
      if (
        !raced ||
        raced.transportRequestId !== request.id ||
        raced.providerId !== providerId ||
        raced.source !== source
      ) {
        throw new ConflictException(
          "ETA recalculation changed concurrently. Refresh and retry.",
        );
      }
      return {
        requestId: request.id,
        persisted: true,
        replayed: true,
        etaMinutes: raced.etaMinutes,
        preview,
      };
    }

    return {
      requestId: request.id,
      persisted: true,
      replayed: false,
      etaMinutes,
      preview,
    };
  }

  private async requireRequest(requestIdRaw: string) {
    const requestId = this.safeId(requestIdRaw, "requestId");
    const request = await this.prisma.medicalTransportRequest.findUnique({
      where: { id: requestId },
    });
    if (!request) {
      throw new NotFoundException("Medical transport request not found.");
    }
    return request;
  }

  private safeId(value: unknown, field: string) {
    if (
      typeof value !== "string" ||
      !/^[A-Za-z0-9_.:-]{1,180}$/.test(value.trim())
    ) {
      throw new BadRequestException(`${field} is invalid.`);
    }
    return value.trim();
  }

  private idempotencyKey(value: unknown) {
    if (typeof value !== "string" || !IDEMPOTENCY.test(value.trim())) {
      throw new BadRequestException("idempotencyKey is invalid.");
    }
    return value.trim();
  }

  private uniqueConflict(error: unknown): boolean {
    return (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "P2002"
    );
  }
}

@Controller("admin/transport")
@RequirePermissions("TRANSPORT_OPERATE")
class AdminTransportDispatchController {
  constructor(private readonly dispatch: TransportDispatchService) {}

  @Get("dispatch-board")
  @Header("Cache-Control", "no-store")
  board(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Query("status") status?: string,
    @Query("mode") mode?: string,
  ) {
    return this.dispatch.board(principal, status, mode);
  }

  @Post("dispatch-board/:requestId/recalculate-eta")
  @Header("Cache-Control", "no-store")
  refreshEta(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("requestId") requestId: string,
    @Body() body: EtaRefreshBody,
  ) {
    return this.dispatch.refreshEtaForOperations(principal, requestId, body ?? {});
  }
}

@Controller("provider/medical-transport")
@RequirePermissions("TRANSPORT_RESPOND")
class ProviderTransportEtaController {
  constructor(private readonly dispatch: TransportDispatchService) {}

  @Post(":requestId/recalculate-eta")
  @Header("Cache-Control", "no-store")
  refreshEta(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("requestId") requestId: string,
    @Body() body: EtaRefreshBody,
  ) {
    return this.dispatch.refreshEtaForProvider(principal, requestId, body ?? {});
  }
}

@Module({
  imports: [TransportSavedLocationsModule],
  controllers: [AdminTransportDispatchController, ProviderTransportEtaController],
  providers: [TransportDispatchService],
})
export class TransportDispatchModule {}
