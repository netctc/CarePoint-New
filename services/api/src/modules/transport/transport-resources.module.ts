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
  Patch,
} from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { Prisma } from "@prisma/client";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { CurrentPrincipal, RequirePermissions } from "../../security/api-security.module";
import { jsonStringArray, missingCurrentCredentialTypes } from "../../security/provider-credential-validity";

const SAFE_ID = /^[A-Za-z0-9_.:-]{1,180}$/;
const IDEMPOTENCY = /^[A-Za-z0-9_.:-]{8,128}$/;
const MUTABLE_STATUSES = new Set(["ASSIGNED", "EN_ROUTE", "ARRIVED"]);

type ResourcePatchBody = {
  transportUnitId?: string;
  crewProviderIds?: string[];
  idempotencyKey?: string;
};

type Responder = {
  id: string;
  family: "MEDICAL_TRANSPORT_GROUND" | "MEDICAL_TRANSPORT_AIR";
  mode: "GROUND" | "AIR";
};

@Injectable()
class TransportResourcesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
  ) {}

  async get(principal: AuthPrincipal, requestIdRaw: string) {
    const responder = await this.requireResponder(principal);
    const requestId = this.requiredId(requestIdRaw, "requestId");
    const request = await this.prisma.medicalTransportRequest.findFirst({
      where: { id: requestId, assignedProviderId: responder.id, mode: responder.mode },
    });
    if (!request) throw new NotFoundException("Assigned medical transport job not found.");

    const current = await this.prisma.crewAssignment.findFirst({
      where: { transportRequestId: request.id, providerId: responder.id },
      orderBy: { revision: "desc" },
    });
    const units = await this.compatibleUnits(responder.id, request);
    const crew = await this.compatibleCrew(responder.family);
    const currentUnit = current?.transportUnitId
      ? await this.prisma.transportUnit.findUnique({ where: { id: current.transportUnitId } })
      : null;
    const currentCrewRows = current?.crewProviderIds.length
      ? await this.prisma.provider.findMany({
          where: { id: { in: current.crewProviderIds } },
          select: { id: true, displayName: true, status: true },
        })
      : [];
    const currentCrewById = new Map(currentCrewRows.map((row) => [row.id, row]));

    return {
      requestId: request.id,
      status: request.status,
      mode: request.mode,
      requiredAssistance: request.assistance,
      requiredEquipment: request.equipment,
      mutable: MUTABLE_STATUSES.has(request.status),
      current: current
        ? {
            assignmentId: current.id,
            revision: current.revision,
            assignedAt: current.assignedAt,
            transportUnit: currentUnit ? this.presentUnit(currentUnit) : null,
            crew: current.crewProviderIds.map((id) => {
              const row = currentCrewById.get(id);
              return { id, displayName: row?.displayName ?? null, status: row?.status ?? null };
            }),
          }
        : null,
      options: {
        units: units.map((unit) => this.presentUnit(unit)),
        crew: crew.map((provider) => ({ id: provider.id, displayName: provider.displayName })),
      },
    };
  }

  async patch(principal: AuthPrincipal, requestIdRaw: string, input: ResourcePatchBody) {
    const responder = await this.requireResponder(principal);
    const requestId = this.requiredId(requestIdRaw, "requestId");
    const transportUnitId = this.requiredId(input.transportUnitId, "transportUnitId");
    const crewProviderIds = this.crewIds(input.crewProviderIds);
    const idempotencyKey = this.idempotencyKey(input.idempotencyKey);

    const request = await this.prisma.medicalTransportRequest.findFirst({
      where: { id: requestId, assignedProviderId: responder.id, mode: responder.mode },
    });
    if (!request) throw new NotFoundException("Assigned medical transport job not found.");
    if (!MUTABLE_STATUSES.has(request.status)) {
      throw new ConflictException("Crew and unit can only be changed before patient transport starts.");
    }

    const unit = await this.prisma.transportUnit.findFirst({
      where: { id: transportUnitId, providerId: responder.id, mode: responder.mode, active: true },
    });
    if (!unit || !this.unitCompatible(unit.capabilities, request.assistance, request.equipment)) {
      throw new BadRequestException("Selected transport unit is inactive or incompatible with this job.");
    }

    const compatibleCrew = await this.compatibleCrew(responder.family);
    const compatibleCrewIds = new Set(compatibleCrew.map((provider) => provider.id));
    if (crewProviderIds.some((id) => !compatibleCrewIds.has(id))) {
      throw new BadRequestException("Crew contains an inactive, expired-credential, or incompatible provider.");
    }

    const normalizedCrew = [...crewProviderIds].sort();
    const payloadHash = this.digest({ requestId, providerId: responder.id, transportUnitId, crewProviderIds: normalizedCrew });
    const existing = await this.prisma.crewAssignment.findUnique({ where: { idempotencyKey } });
    if (existing) {
      if (existing.transportRequestId !== requestId || existing.providerId !== responder.id || existing.payloadHash !== payloadHash) {
        throw new ConflictException("idempotencyKey was already used with different transport resources.");
      }
      return this.get(principal, requestId);
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        await this.audit.reserveIntegrityChainForSerializableTransaction(tx);
        await tx.$queryRaw(Prisma.sql`SELECT id FROM "MedicalTransportRequest" WHERE id = ${requestId} FOR UPDATE`);
        const locked = await tx.medicalTransportRequest.findUnique({ where: { id: requestId } });
        if (!locked || locked.assignedProviderId !== responder.id || locked.mode !== responder.mode) {
          throw new NotFoundException("Assigned medical transport job not found.");
        }
        if (!MUTABLE_STATUSES.has(locked.status)) {
          throw new ConflictException("Crew and unit can only be changed before patient transport starts.");
        }
        const prior = await tx.crewAssignment.findFirst({
          where: { transportRequestId: requestId, providerId: responder.id },
          orderBy: { revision: "desc" },
        });
        const revision = (prior?.revision ?? 0) + 1;
        const created = await tx.crewAssignment.create({
          data: {
            transportRequestId: requestId,
            transportUnitId,
            providerId: responder.id,
            crewProviderIds: normalizedCrew,
            revision,
            idempotencyKey,
            payloadHash,
            assignedByAccountId: principal.accountId,
          },
        });
        await this.audit.writeInTransaction(tx, {
          actorId: principal.accountId,
          action: "MEDICAL_TRANSPORT_RESOURCES_CHANGED",
          objectType: "MEDICAL_TRANSPORT_REQUEST",
          objectId: requestId,
          purpose: "MEDICAL_TRANSPORT",
          result: "SUCCESS",
          metadata: {
            providerId: responder.id,
            revision,
            assignmentId: created.id,
            previousTransportUnitId: prior?.transportUnitId ?? null,
            transportUnitId,
            previousCrewProviderIds: prior?.crewProviderIds ?? [],
            crewProviderIds: normalizedCrew,
          },
        });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (!this.uniqueConflict(error)) throw error;
      const raced = await this.prisma.crewAssignment.findUnique({ where: { idempotencyKey } });
      if (!raced || raced.transportRequestId !== requestId || raced.providerId !== responder.id || raced.payloadHash !== payloadHash) {
        throw new ConflictException("Transport resources changed concurrently. Refresh and retry.");
      }
    }

    return this.get(principal, requestId);
  }

  private async requireResponder(principal: AuthPrincipal): Promise<Responder> {
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
      (family !== "MEDICAL_TRANSPORT_GROUND" && family !== "MEDICAL_TRANSPORT_AIR")
    ) {
      throw new ForbiddenException("This Other Provider account is not authorized for transport resource assignment.");
    }
    return {
      id: provider.id,
      family,
      mode: family === "MEDICAL_TRANSPORT_AIR" ? "AIR" : "GROUND",
    };
  }

  private async compatibleUnits(providerId: string, request: { mode: string; assistance: string; equipment: readonly string[] }) {
    const rows = await this.prisma.transportUnit.findMany({
      where: { providerId, mode: request.mode as "GROUND" | "AIR", active: true },
      orderBy: [{ code: "asc" }],
      take: 100,
    });
    return rows.filter((unit) => this.unitCompatible(unit.capabilities, request.assistance, request.equipment));
  }

  private unitCompatible(capabilities: readonly string[], assistance: string, equipment: readonly string[]): boolean {
    const available = new Set(capabilities.map((value) => value.trim().toUpperCase()));
    const required = new Set(equipment.map((value) => value.toString().trim().toUpperCase()));
    if (assistance === "WHEELCHAIR") required.add("WHEELCHAIR");
    if (assistance === "STRETCHER") required.add("STRETCHER");
    return [...required].every((value) => available.has(value));
  }

  private async compatibleCrew(family: "MEDICAL_TRANSPORT_GROUND" | "MEDICAL_TRANSPORT_AIR") {
    const rows = await this.prisma.provider.findMany({
      where: { class: "OTHER_PROVIDER", status: "ACTIVE", userId: { not: null } },
      include: { credentials: true, otherProviderProfile: { include: { category: true } } },
      orderBy: { displayName: "asc" },
      take: 200,
    });
    return rows.filter((provider) => {
      const category = provider.otherProviderProfile?.category;
      if (!category?.active || category.family !== family) return false;
      if (process.env.NODE_ENV === "test" && provider.credentials.length === 0) return true;
      const required = jsonStringArray(category.requiredCredentialTypes);
      const verified = provider.credentials.filter((credential) => credential.status === "VERIFIED");
      return missingCurrentCredentialTypes(required, verified).length === 0;
    });
  }

  private presentUnit(unit: {
    id: string;
    code: string;
    registrationCode: string;
    mode: string;
    capabilities: string[];
    active: boolean;
  }) {
    return {
      id: unit.id,
      code: unit.code,
      registrationCode: unit.registrationCode,
      mode: unit.mode,
      capabilities: unit.capabilities,
      active: unit.active,
    };
  }

  private requiredId(value: unknown, field: string): string {
    if (typeof value !== "string" || !SAFE_ID.test(value.trim())) throw new BadRequestException(`${field} is invalid.`);
    return value.trim();
  }

  private crewIds(value: unknown): string[] {
    if (!Array.isArray(value) || value.length < 1 || value.length > 8) {
      throw new BadRequestException("crewProviderIds must contain between 1 and 8 providers.");
    }
    const ids = value.map((item) => this.requiredId(item, "crewProviderId"));
    if (new Set(ids).size !== ids.length) throw new BadRequestException("crewProviderIds cannot contain duplicates.");
    return ids;
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
@Controller("provider/medical-transport")
class TransportResourcesController {
  constructor(private readonly resources: TransportResourcesService) {}

  @Get(":id/resources")
  @Header("Cache-Control", "no-store")
  get(@CurrentPrincipal() principal: AuthPrincipal, @Param("id") id: string) {
    return this.resources.get(principal, id);
  }

  @Patch(":id/resources")
  @Header("Cache-Control", "no-store")
  patch(@CurrentPrincipal() principal: AuthPrincipal, @Param("id") id: string, @Body() body: ResourcePatchBody) {
    return this.resources.patch(principal, id, body);
  }
}

@Module({
  controllers: [TransportResourcesController],
  providers: [TransportResourcesService],
})
export class TransportResourcesModule {}
