import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
} from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { CurrentPrincipal, RequirePermissions } from "../../security/api-security.module";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { jsonStringArray, missingCurrentCredentialTypes } from "../../security/provider-credential-validity";

const TRANSPORT_FAMILIES = [
  "MEDICAL_TRANSPORT_GROUND",
  "MEDICAL_TRANSPORT_AIR",
  "EMERGENCY_AMBULANCE",
] as const;
const UNIT_MODES = new Set(["GROUND", "AIR"]);
const UNIT_CAPABILITY = /^[A-Z0-9][A-Z0-9_:-]{0,79}$/;
const SAFE_TEXT = /^[^\p{Cc}]{1,120}$/u;

type TransportFamily = (typeof TRANSPORT_FAMILIES)[number];
type UnitInput = {
  code?: string;
  registrationCode?: string;
  mode?: string;
  capabilities?: string[];
  active?: boolean;
};

@Injectable()
class AdminTransportOperationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
  ) {}

  async providers(principal: AuthPrincipal) {
    const providers = await this.prisma.provider.findMany({
      where: {
        class: "OTHER_PROVIDER",
        otherProviderProfile: { category: { family: { in: [...TRANSPORT_FAMILIES] } } },
      },
      include: {
        user: { select: { id: true, email: true, status: true } },
        credentials: true,
        otherProviderProfile: { include: { category: true } },
      },
      orderBy: [{ displayName: "asc" }, { id: "asc" }],
      take: 500,
    });
    const providerIds = providers.map((row) => row.id);
    const [units, scheduledJobs, emergencyJobs] = await Promise.all([
      providerIds.length
        ? this.prisma.transportUnit.findMany({
            where: { providerId: { in: providerIds } },
            orderBy: [{ providerId: "asc" }, { code: "asc" }],
          })
        : [],
      providerIds.length
        ? this.prisma.medicalTransportRequest.groupBy({
            by: ["assignedProviderId"],
            where: {
              assignedProviderId: { in: providerIds },
              status: { in: ["ASSIGNED", "EN_ROUTE", "ARRIVED", "TRANSPORTING"] },
            },
            _count: { _all: true },
          })
        : [],
      providerIds.length
        ? this.prisma.emergencyAmbulanceRequest.groupBy({
            by: ["assignedProviderId"],
            where: {
              assignedProviderId: { in: providerIds },
              status: { in: ["ASSIGNED", "EN_ROUTE", "ARRIVED", "TRANSPORTING"] },
            },
            _count: { _all: true },
          })
        : [],
    ]);

    const unitsByProvider = new Map<string, typeof units>();
    for (const unit of units) {
      const current = unitsByProvider.get(unit.providerId) ?? [];
      current.push(unit);
      unitsByProvider.set(unit.providerId, current);
    }
    const scheduledByProvider = new Map(
      scheduledJobs
        .filter((row) => row.assignedProviderId)
        .map((row) => [row.assignedProviderId as string, row._count._all]),
    );
    const emergencyByProvider = new Map(
      emergencyJobs
        .filter((row) => row.assignedProviderId)
        .map((row) => [row.assignedProviderId as string, row._count._all]),
    );

    const items = providers.map((provider) =>
      this.presentProvider(
        provider,
        unitsByProvider.get(provider.id) ?? [],
        (scheduledByProvider.get(provider.id) ?? 0) + (emergencyByProvider.get(provider.id) ?? 0),
      ),
    );
    await this.audit.write({
      actorId: principal.accountId,
      action: "ADMIN_TRANSPORT_PROVIDER_DIRECTORY_READ",
      objectType: "TRANSPORT_PROVIDER_DIRECTORY",
      objectId: "ALL",
      purpose: "TRANSPORT_OPERATIONS",
      result: "SUCCESS",
      metadata: { resultCount: items.length },
    });
    return { generatedAt: new Date().toISOString(), items };
  }

  async provider(principal: AuthPrincipal, providerIdRaw: string) {
    const provider = await this.requireTransportProvider(providerIdRaw);
    const [units, assignments] = await Promise.all([
      this.prisma.transportUnit.findMany({
        where: { providerId: provider.id },
        orderBy: [{ active: "desc" }, { code: "asc" }],
      }),
      this.prisma.crewAssignment.findMany({
        where: { providerId: provider.id },
        orderBy: { assignedAt: "desc" },
        take: 25,
      }),
    ]);
    const payload = {
      ...this.presentProvider(provider, units, 0),
      units: units.map((unit) => this.presentUnit(unit)),
      recentAssignments: assignments.map((row) => ({
        id: row.id,
        transportRequestId: row.transportRequestId,
        transportUnitId: row.transportUnitId,
        crewProviderIds: row.crewProviderIds,
        revision: row.revision,
        assignedAt: row.assignedAt,
      })),
    };
    await this.audit.write({
      actorId: principal.accountId,
      action: "ADMIN_TRANSPORT_PROVIDER_OPERATIONS_READ",
      objectType: "PROVIDER",
      objectId: provider.id,
      purpose: "TRANSPORT_OPERATIONS",
      result: "SUCCESS",
    });
    return payload;
  }

  async createUnit(principal: AuthPrincipal, providerIdRaw: string, input: UnitInput) {
    const provider = await this.requireTransportProvider(providerIdRaw);
    const family = provider.otherProviderProfile!.category.family as TransportFamily;
    const mode = this.mode(input.mode, family);
    const row = await this.prisma.transportUnit.create({
      data: {
        providerId: provider.id,
        code: this.text(input.code, "code"),
        registrationCode: this.text(input.registrationCode, "registrationCode"),
        mode,
        capabilities: this.capabilities(input.capabilities ?? []),
        active: input.active ?? true,
      },
    });
    await this.audit.write({
      actorId: principal.accountId,
      action: "ADMIN_TRANSPORT_UNIT_CREATED",
      objectType: "TRANSPORT_UNIT",
      objectId: row.id,
      purpose: "TRANSPORT_OPERATIONS",
      result: "SUCCESS",
      metadata: { providerId: provider.id, mode: row.mode, code: row.code },
    });
    return this.presentUnit(row);
  }

  async updateUnit(
    principal: AuthPrincipal,
    providerIdRaw: string,
    unitIdRaw: string,
    input: UnitInput,
  ) {
    const provider = await this.requireTransportProvider(providerIdRaw);
    const unitId = this.id(unitIdRaw, "unitId");
    const current = await this.prisma.transportUnit.findFirst({
      where: { id: unitId, providerId: provider.id },
    });
    if (!current) throw new NotFoundException("Transport unit not found.");
    const family = provider.otherProviderProfile!.category.family as TransportFamily;
    const row = await this.prisma.transportUnit.update({
      where: { id: current.id },
      data: {
        ...(input.code !== undefined ? { code: this.text(input.code, "code") } : {}),
        ...(input.registrationCode !== undefined
          ? { registrationCode: this.text(input.registrationCode, "registrationCode") }
          : {}),
        ...(input.mode !== undefined ? { mode: this.mode(input.mode, family) } : {}),
        ...(input.capabilities !== undefined
          ? { capabilities: this.capabilities(input.capabilities) }
          : {}),
        ...(input.active !== undefined ? { active: Boolean(input.active) } : {}),
      },
    });
    await this.audit.write({
      actorId: principal.accountId,
      action: "ADMIN_TRANSPORT_UNIT_UPDATED",
      objectType: "TRANSPORT_UNIT",
      objectId: row.id,
      purpose: "TRANSPORT_OPERATIONS",
      result: "SUCCESS",
      metadata: {
        providerId: provider.id,
        active: row.active,
        mode: row.mode,
        code: row.code,
      },
    });
    return this.presentUnit(row);
  }

  private async requireTransportProvider(providerIdRaw: string) {
    const providerId = this.id(providerIdRaw, "providerId");
    const provider = await this.prisma.provider.findFirst({
      where: {
        id: providerId,
        class: "OTHER_PROVIDER",
        otherProviderProfile: { category: { family: { in: [...TRANSPORT_FAMILIES] } } },
      },
      include: {
        user: { select: { id: true, email: true, status: true } },
        credentials: true,
        otherProviderProfile: { include: { category: true } },
      },
    });
    if (!provider) throw new NotFoundException("Transport provider not found.");
    return provider;
  }

  private presentProvider(provider: any, units: any[], activeJobs: number) {
    const category = provider.otherProviderProfile?.category;
    const family = category?.family as TransportFamily | undefined;
    const requiredCredentials = jsonStringArray(category?.requiredCredentialTypes);
    const usableCredentials = (provider.credentials ?? []).filter(
      (credential: { status?: string }) =>
        credential.status === "VALID" || credential.status === "VERIFIED",
    );
    const missingCredentials = missingCurrentCredentialTypes(
      requiredCredentials,
      usableCredentials,
    );
    const expectedMode = family === "MEDICAL_TRANSPORT_AIR" ? "AIR" : "GROUND";
    const activeUnits = units.filter(
      (unit) => unit.active === true && unit.mode === expectedMode,
    );
    const dispatchReady =
      provider.status === "ACTIVE" &&
      provider.user?.status === "ACTIVE" &&
      category?.active === true &&
      missingCredentials.length === 0 &&
      activeUnits.length > 0;

    return {
      id: provider.id,
      displayName: provider.displayName,
      legalName: provider.legalName ?? null,
      status: provider.status,
      account: provider.user
        ? { email: provider.user.email, status: provider.user.status }
        : null,
      family: family ?? null,
      category: category
        ? { id: category.id, slug: category.slug, labels: category.labels, active: category.active }
        : null,
      requiredCredentialTypes: requiredCredentials,
      missingCredentialTypes: missingCredentials,
      fleet: {
        total: units.length,
        active: activeUnits.length,
        expectedMode,
      },
      activeJobs,
      dispatchReady,
    };
  }

  private presentUnit(unit: any) {
    return {
      id: unit.id,
      code: unit.code,
      registrationCode: unit.registrationCode,
      mode: unit.mode,
      capabilities: unit.capabilities ?? [],
      active: unit.active,
      createdAt: unit.createdAt,
      updatedAt: unit.updatedAt,
    };
  }

  private mode(value: unknown, family: TransportFamily): "GROUND" | "AIR" {
    if (typeof value !== "string" || !UNIT_MODES.has(value)) {
      throw new BadRequestException("mode must be GROUND or AIR.");
    }
    const expected = family === "MEDICAL_TRANSPORT_AIR" ? "AIR" : "GROUND";
    if (value !== expected) {
      throw new BadRequestException(
        `Transport unit mode must be ${expected} for provider family ${family}.`,
      );
    }
    return value as "GROUND" | "AIR";
  }

  private capabilities(value: unknown): string[] {
    if (!Array.isArray(value) || value.length > 20) {
      throw new BadRequestException("capabilities must be an array with at most 20 values.");
    }
    const normalized = [
      ...new Set(
        value.map((item) =>
          typeof item === "string" ? item.trim().toUpperCase() : "",
        ),
      ),
    ].filter(Boolean);
    if (normalized.some((item) => !UNIT_CAPABILITY.test(item))) {
      throw new BadRequestException("Transport unit capability is invalid.");
    }
    return normalized.sort();
  }

  private text(value: unknown, field: string): string {
    if (typeof value !== "string") throw new BadRequestException(`${field} must be text.`);
    const normalized = value.trim();
    if (!SAFE_TEXT.test(normalized)) {
      throw new BadRequestException(`${field} must contain between 1 and 120 printable characters.`);
    }
    return normalized;
  }

  private id(value: unknown, field: string): string {
    if (typeof value !== "string" || !/^[A-Za-z0-9_.:-]{1,180}$/.test(value.trim())) {
      throw new BadRequestException(`${field} is invalid.`);
    }
    return value.trim();
  }
}

@Controller("admin/transport")
@RequirePermissions("TRANSPORT_OPERATE")
class AdminTransportOperationsController {
  constructor(private readonly operations: AdminTransportOperationsService) {}

  @Get("providers")
  @Header("Cache-Control", "no-store")
  providers(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.operations.providers(principal);
  }

  @Get("providers/:providerId")
  @Header("Cache-Control", "no-store")
  provider(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("providerId") providerId: string,
  ) {
    return this.operations.provider(principal, providerId);
  }

  @Post("providers/:providerId/units")
  createUnit(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("providerId") providerId: string,
    @Body() body: UnitInput,
  ) {
    return this.operations.createUnit(principal, providerId, body ?? {});
  }

  @Patch("providers/:providerId/units/:unitId")
  updateUnit(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("providerId") providerId: string,
    @Param("unitId") unitId: string,
    @Body() body: UnitInput,
  ) {
    return this.operations.updateUnit(principal, providerId, unitId, body ?? {});
  }
}

@Module({
  controllers: [AdminTransportOperationsController],
  providers: [AdminTransportOperationsService],
})
export class AdminTransportOperationsModule {}
