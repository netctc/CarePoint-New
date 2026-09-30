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

const TRANSPORT_FAMILIES = [
  "MEDICAL_TRANSPORT_GROUND",
  "MEDICAL_TRANSPORT_AIR",
  "EMERGENCY_AMBULANCE",
] as const;

const CREW_ROLES = new Set([
  "DRIVER",
  "PARAMEDIC",
  "EMT",
  "NURSE",
  "PHYSICIAN",
  "PILOT",
  "FLIGHT_MEDIC",
  "DISPATCHER",
  "OTHER",
]);

const LICENSE_REQUIRED_ROLES = new Set([
  "DRIVER",
  "PARAMEDIC",
  "EMT",
  "NURSE",
  "PHYSICIAN",
  "PILOT",
  "FLIGHT_MEDIC",
]);

const CODE = /^[A-Z0-9][A-Z0-9_-]{1,39}$/;
const SAFE_ID = /^[A-Za-z0-9_.:-]{1,180}$/;
const SAFE_TEXT = /^[^\p{Cc}]{1,160}$/u;

type CompanyInput = {
  code?: string;
  displayName?: string;
  legalName?: string;
  registrationNumber?: string | null;
  contactPhone?: string | null;
  providerIds?: string[];
  unitIds?: string[];
  active?: boolean;
};

type CrewInput = {
  providerId?: string | null;
  displayName?: string;
  role?: string;
  licenseNumber?: string | null;
  licenseIssuer?: string | null;
  licenseValidUntil?: string | null;
  active?: boolean;
};

@Injectable()
class AdminTransportCompanyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
  ) {}

  async companies(principal: AuthPrincipal) {
    const [companies, providers, units] = await Promise.all([
      this.prisma.transportCompany.findMany({
        include: { crewMembers: { orderBy: [{ active: "desc" }, { displayName: "asc" }] } },
        orderBy: [{ active: "desc" }, { displayName: "asc" }, { id: "asc" }],
        take: 500,
      }),
      this.transportProviders(),
      this.prisma.transportUnit.findMany({
        orderBy: [{ providerId: "asc" }, { active: "desc" }, { code: "asc" }],
        take: 2000,
      }),
    ]);

    const providerIds = new Set(providers.map((row) => row.id));
    const catalogUnits = units.filter((unit) => providerIds.has(unit.providerId));

    const payload = {
      generatedAt: new Date().toISOString(),
      items: companies.map((row) => this.presentCompany(row)),
      catalog: {
        providers: providers.map((row) => ({
          id: row.id,
          displayName: row.displayName,
          legalName: row.legalName ?? null,
          status: row.status,
          family: row.otherProviderProfile?.category.family ?? null,
        })),
        units: catalogUnits.map((unit) => ({
          id: unit.id,
          providerId: unit.providerId,
          code: unit.code,
          registrationCode: unit.registrationCode,
          mode: unit.mode,
          active: unit.active,
        })),
      },
    };

    await this.audit.write({
      actorId: principal.accountId,
      action: "ADMIN_TRANSPORT_COMPANY_DIRECTORY_READ",
      objectType: "TRANSPORT_COMPANY_DIRECTORY",
      objectId: "ALL",
      purpose: "TRANSPORT_OPERATIONS",
      result: "SUCCESS",
      metadata: { companyCount: companies.length, providerCount: providers.length },
    });

    return payload;
  }

  async createCompany(principal: AuthPrincipal, input: CompanyInput) {
    const code = this.companyCode(input.code);
    const displayName = this.text(input.displayName, "displayName");
    const legalName = this.text(input.legalName, "legalName");
    const providerIds = this.ids(input.providerIds ?? [], "providerIds", 100);
    const unitIds = this.ids(input.unitIds ?? [], "unitIds", 300);
    await this.validateCompanyResources(providerIds, unitIds);

    const row = await this.prisma.transportCompany.create({
      data: {
        code,
        displayName,
        legalName,
        registrationNumber: this.optionalText(input.registrationNumber, "registrationNumber"),
        contactPhone: this.optionalText(input.contactPhone, "contactPhone"),
        providerIds,
        unitIds,
        active: input.active ?? true,
      },
      include: { crewMembers: true },
    });

    await this.audit.write({
      actorId: principal.accountId,
      action: "ADMIN_TRANSPORT_COMPANY_CREATED",
      objectType: "TRANSPORT_COMPANY",
      objectId: row.id,
      purpose: "TRANSPORT_OPERATIONS",
      result: "SUCCESS",
      metadata: { code: row.code, providerCount: providerIds.length, unitCount: unitIds.length },
    });

    return this.presentCompany(row);
  }

  async updateCompany(principal: AuthPrincipal, companyIdRaw: string, input: CompanyInput) {
    const companyId = this.id(companyIdRaw, "companyId");
    const current = await this.prisma.transportCompany.findUnique({
      where: { id: companyId },
      include: { crewMembers: true },
    });
    if (!current) throw new NotFoundException("Transport company not found.");

    const providerIds = input.providerIds === undefined
      ? current.providerIds
      : this.ids(input.providerIds, "providerIds", 100);
    const unitIds = input.unitIds === undefined
      ? current.unitIds
      : this.ids(input.unitIds, "unitIds", 300);

    await this.validateCompanyResources(providerIds, unitIds);

    const removedProviderIds = new Set(current.providerIds.filter((id) => !providerIds.includes(id)));
    const blockedCrew = current.crewMembers.find(
      (crew) => crew.active && crew.providerId && removedProviderIds.has(crew.providerId),
    );
    if (blockedCrew) {
      throw new BadRequestException(
        "A provider linked to an active crew member cannot be removed from the company.",
      );
    }

    const row = await this.prisma.transportCompany.update({
      where: { id: current.id },
      data: {
        ...(input.displayName !== undefined
          ? { displayName: this.text(input.displayName, "displayName") }
          : {}),
        ...(input.legalName !== undefined
          ? { legalName: this.text(input.legalName, "legalName") }
          : {}),
        ...(input.registrationNumber !== undefined
          ? { registrationNumber: this.optionalText(input.registrationNumber, "registrationNumber") }
          : {}),
        ...(input.contactPhone !== undefined
          ? { contactPhone: this.optionalText(input.contactPhone, "contactPhone") }
          : {}),
        ...(input.providerIds !== undefined ? { providerIds } : {}),
        ...(input.unitIds !== undefined ? { unitIds } : {}),
        ...(input.active !== undefined ? { active: Boolean(input.active) } : {}),
      },
      include: { crewMembers: { orderBy: [{ active: "desc" }, { displayName: "asc" }] } },
    });

    await this.audit.write({
      actorId: principal.accountId,
      action: "ADMIN_TRANSPORT_COMPANY_UPDATED",
      objectType: "TRANSPORT_COMPANY",
      objectId: row.id,
      purpose: "TRANSPORT_OPERATIONS",
      result: "SUCCESS",
      metadata: {
        active: row.active,
        providerCount: row.providerIds.length,
        unitCount: row.unitIds.length,
      },
    });

    return this.presentCompany(row);
  }

  async createCrew(
    principal: AuthPrincipal,
    companyIdRaw: string,
    input: CrewInput,
  ) {
    const company = await this.requireCompany(companyIdRaw);
    const providerId = input.providerId == null ? null : this.id(input.providerId, "providerId");
    if (providerId && !company.providerIds.includes(providerId)) {
      throw new BadRequestException("Crew providerId must belong to the transport company.");
    }

    const role = this.crewRole(input.role);
    const row = await this.prisma.transportCrewMember.create({
      data: {
        companyId: company.id,
        providerId,
        displayName: this.text(input.displayName, "displayName"),
        role,
        licenseNumber: this.optionalText(input.licenseNumber, "licenseNumber"),
        licenseIssuer: this.optionalText(input.licenseIssuer, "licenseIssuer"),
        licenseValidUntil: this.optionalDate(input.licenseValidUntil, "licenseValidUntil"),
        active: input.active ?? true,
      },
    });

    await this.audit.write({
      actorId: principal.accountId,
      action: "ADMIN_TRANSPORT_CREW_CREATED",
      objectType: "TRANSPORT_CREW_MEMBER",
      objectId: row.id,
      purpose: "TRANSPORT_OPERATIONS",
      result: "SUCCESS",
      metadata: { companyId: company.id, role: row.role, providerId: row.providerId },
    });

    return this.presentCrew(row);
  }

  async updateCrew(
    principal: AuthPrincipal,
    companyIdRaw: string,
    crewIdRaw: string,
    input: CrewInput,
  ) {
    const company = await this.requireCompany(companyIdRaw);
    const crewId = this.id(crewIdRaw, "crewId");
    const current = await this.prisma.transportCrewMember.findFirst({
      where: { id: crewId, companyId: company.id },
    });
    if (!current) throw new NotFoundException("Transport crew member not found.");

    const providerId = input.providerId === undefined
      ? current.providerId
      : input.providerId == null
        ? null
        : this.id(input.providerId, "providerId");
    if (providerId && !company.providerIds.includes(providerId)) {
      throw new BadRequestException("Crew providerId must belong to the transport company.");
    }

    const row = await this.prisma.transportCrewMember.update({
      where: { id: current.id },
      data: {
        ...(input.providerId !== undefined ? { providerId } : {}),
        ...(input.displayName !== undefined
          ? { displayName: this.text(input.displayName, "displayName") }
          : {}),
        ...(input.role !== undefined ? { role: this.crewRole(input.role) } : {}),
        ...(input.licenseNumber !== undefined
          ? { licenseNumber: this.optionalText(input.licenseNumber, "licenseNumber") }
          : {}),
        ...(input.licenseIssuer !== undefined
          ? { licenseIssuer: this.optionalText(input.licenseIssuer, "licenseIssuer") }
          : {}),
        ...(input.licenseValidUntil !== undefined
          ? { licenseValidUntil: this.optionalDate(input.licenseValidUntil, "licenseValidUntil") }
          : {}),
        ...(input.active !== undefined ? { active: Boolean(input.active) } : {}),
      },
    });

    await this.audit.write({
      actorId: principal.accountId,
      action: "ADMIN_TRANSPORT_CREW_UPDATED",
      objectType: "TRANSPORT_CREW_MEMBER",
      objectId: row.id,
      purpose: "TRANSPORT_OPERATIONS",
      result: "SUCCESS",
      metadata: { companyId: company.id, role: row.role, active: row.active },
    });

    return this.presentCrew(row);
  }

  async dispatch(principal: AuthPrincipal) {
    const [
      medical,
      emergency,
      providers,
      companies,
    ] = await Promise.all([
      this.prisma.medicalTransportRequest.findMany({
        where: { status: { in: ["REQUESTED", "ASSIGNED", "EN_ROUTE", "ARRIVED", "TRANSPORTING"] } },
        orderBy: [{ scheduledFor: "asc" }, { requestedAt: "asc" }],
        take: 250,
      }),
      this.prisma.emergencyAmbulanceRequest.findMany({
        where: { status: { in: ["REQUESTED", "DISPATCHING", "ASSIGNED", "EN_ROUTE", "ARRIVED", "TRANSPORTING"] } },
        orderBy: [{ requestedAt: "asc" }],
        take: 250,
      }),
      this.transportProviders(),
      this.prisma.transportCompany.findMany({
        where: { active: true },
        select: { id: true, code: true, displayName: true, providerIds: true },
        take: 500,
      }),
    ]);

    const providerMap = new Map(
      providers.map((row) => [
        row.id,
        {
          id: row.id,
          displayName: row.displayName,
          family: row.otherProviderProfile?.category.family ?? null,
          status: row.status,
        },
      ]),
    );
    const companyByProvider = new Map<string, { id: string; code: string; displayName: string }>();
    for (const company of companies) {
      for (const providerId of company.providerIds) {
        if (!companyByProvider.has(providerId)) {
          companyByProvider.set(providerId, {
            id: company.id,
            code: company.code,
            displayName: company.displayName,
          });
        }
      }
    }

    const presentAssignment = (providerId: string | null) => ({
      provider: providerId ? providerMap.get(providerId) ?? null : null,
      company: providerId ? companyByProvider.get(providerId) ?? null : null,
    });

    const payload = {
      generatedAt: new Date().toISOString(),
      medical: medical.map((row) => ({
        id: row.id,
        mode: row.mode,
        status: row.status,
        scheduledFor: row.scheduledFor,
        pickupAddress: row.pickupAddress ?? null,
        destinationAddress: row.destinationAddress ?? null,
        etaMinutes: row.etaMinutes ?? null,
        assignedProviderId: row.assignedProviderId ?? null,
        ...presentAssignment(row.assignedProviderId ?? null),
      })),
      emergency: emergency.map((row) => ({
        id: row.id,
        status: row.status,
        requestedAt: row.requestedAt,
        pickupAddress: row.pickupAddress ?? null,
        etaMinutes: row.etaMinutes ?? null,
        assignedProviderId: row.assignedProviderId ?? null,
        ...presentAssignment(row.assignedProviderId ?? null),
      })),
    };

    await this.audit.write({
      actorId: principal.accountId,
      action: "ADMIN_TRANSPORT_DISPATCH_BOARD_READ",
      objectType: "TRANSPORT_DISPATCH_BOARD",
      objectId: "ACTIVE",
      purpose: "TRANSPORT_OPERATIONS",
      result: "SUCCESS",
      metadata: { medicalCount: medical.length, emergencyCount: emergency.length },
    });

    return payload;
  }

  private async validateCompanyResources(providerIds: string[], unitIds: string[]) {
    if (unitIds.length > 0 && providerIds.length === 0) {
      throw new BadRequestException("Transport units require at least one company provider.");
    }

    if (providerIds.length > 0) {
      const providers = await this.prisma.provider.findMany({
        where: {
          id: { in: providerIds },
          class: "OTHER_PROVIDER",
          otherProviderProfile: {
            category: { family: { in: [...TRANSPORT_FAMILIES] } },
          },
        },
        select: { id: true },
      });
      if (providers.length !== providerIds.length) {
        throw new BadRequestException(
          "Every providerIds value must reference a Transport Provider.",
        );
      }
    }

    if (unitIds.length > 0) {
      const units = await this.prisma.transportUnit.findMany({
        where: { id: { in: unitIds }, providerId: { in: providerIds } },
        select: { id: true },
      });
      if (units.length !== unitIds.length) {
        throw new BadRequestException(
          "Every unitIds value must belong to one of the company's Transport Providers.",
        );
      }
    }
  }

  private async transportProviders() {
    return this.prisma.provider.findMany({
      where: {
        class: "OTHER_PROVIDER",
        otherProviderProfile: {
          category: { family: { in: [...TRANSPORT_FAMILIES] } },
        },
      },
      include: { otherProviderProfile: { include: { category: true } } },
      orderBy: [{ displayName: "asc" }, { id: "asc" }],
      take: 1000,
    });
  }

  private async requireCompany(companyIdRaw: string) {
    const companyId = this.id(companyIdRaw, "companyId");
    const company = await this.prisma.transportCompany.findUnique({
      where: { id: companyId },
    });
    if (!company) throw new NotFoundException("Transport company not found.");
    return company;
  }

  private presentCompany(row: any) {
    return {
      id: row.id,
      code: row.code,
      displayName: row.displayName,
      legalName: row.legalName,
      registrationNumber: row.registrationNumber ?? null,
      contactPhone: row.contactPhone ?? null,
      providerIds: row.providerIds ?? [],
      unitIds: row.unitIds ?? [],
      active: row.active,
      crew: (row.crewMembers ?? []).map((crew: any) => this.presentCrew(crew)),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private presentCrew(row: any) {
    const now = Date.now();
    const expires = row.licenseValidUntil instanceof Date
      ? row.licenseValidUntil.getTime()
      : row.licenseValidUntil
        ? new Date(row.licenseValidUntil).getTime()
        : null;
    const licenseRequired = LICENSE_REQUIRED_ROLES.has(row.role);
    const licenseCurrent = !licenseRequired
      || (Boolean(row.licenseNumber) && (expires === null || expires >= now));
    return {
      id: row.id,
      companyId: row.companyId,
      providerId: row.providerId ?? null,
      displayName: row.displayName,
      role: row.role,
      licenseNumber: row.licenseNumber ?? null,
      licenseIssuer: row.licenseIssuer ?? null,
      licenseValidUntil: row.licenseValidUntil ?? null,
      active: row.active,
      licenseRequired,
      licenseCurrent,
      assignmentReady: row.active && Boolean(row.providerId) && licenseCurrent,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private ids(value: unknown, field: string, max: number): string[] {
    if (!Array.isArray(value) || value.length > max) {
      throw new BadRequestException(`${field} must be an array with at most ${max} values.`);
    }
    const values = [...new Set(value.map((item) => this.id(item, field)))];
    return values.sort();
  }

  private companyCode(value: unknown): string {
    if (typeof value !== "string") throw new BadRequestException("code must be text.");
    const normalized = value.trim().toUpperCase();
    if (!CODE.test(normalized)) {
      throw new BadRequestException("code must contain 2-40 uppercase letters, numbers, _ or -.");
    }
    return normalized;
  }

  private crewRole(value: unknown): string {
    if (typeof value !== "string") throw new BadRequestException("role must be text.");
    const normalized = value.trim().toUpperCase();
    if (!CREW_ROLES.has(normalized)) {
      throw new BadRequestException("Unsupported transport crew role.");
    }
    return normalized;
  }

  private text(value: unknown, field: string): string {
    if (typeof value !== "string") throw new BadRequestException(`${field} must be text.`);
    const normalized = value.trim();
    if (!SAFE_TEXT.test(normalized)) {
      throw new BadRequestException(
        `${field} must contain between 1 and 160 printable characters.`,
      );
    }
    return normalized;
  }

  private optionalText(value: unknown, field: string): string | null {
    if (value == null || value === "") return null;
    return this.text(value, field);
  }

  private optionalDate(value: unknown, field: string): Date | null {
    if (value == null || value === "") return null;
    if (typeof value !== "string") throw new BadRequestException(`${field} must be an ISO date.`);
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException(`${field} must be a valid ISO date.`);
    }
    return parsed;
  }

  private id(value: unknown, field: string): string {
    if (typeof value !== "string" || !SAFE_ID.test(value.trim())) {
      throw new BadRequestException(`${field} is invalid.`);
    }
    return value.trim();
  }
}

@Controller("admin/transport")
@RequirePermissions("TRANSPORT_OPERATE")
class AdminTransportCompanyController {
  constructor(private readonly service: AdminTransportCompanyService) {}

  @Get("companies")
  @Header("Cache-Control", "no-store")
  companies(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.service.companies(principal);
  }

  @Post("companies")
  createCompany(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body() body: CompanyInput,
  ) {
    return this.service.createCompany(principal, body ?? {});
  }

  @Patch("companies/:companyId")
  updateCompany(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("companyId") companyId: string,
    @Body() body: CompanyInput,
  ) {
    return this.service.updateCompany(principal, companyId, body ?? {});
  }

  @Post("companies/:companyId/crew")
  createCrew(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("companyId") companyId: string,
    @Body() body: CrewInput,
  ) {
    return this.service.createCrew(principal, companyId, body ?? {});
  }

  @Patch("companies/:companyId/crew/:crewId")
  updateCrew(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("companyId") companyId: string,
    @Param("crewId") crewId: string,
    @Body() body: CrewInput,
  ) {
    return this.service.updateCrew(principal, companyId, crewId, body ?? {});
  }

  @Get("dispatch")
  @Header("Cache-Control", "no-store")
  dispatch(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.service.dispatch(principal);
  }
}

@Module({
  controllers: [AdminTransportCompanyController],
  providers: [AdminTransportCompanyService],
})
export class AdminTransportCompanyModule {}
