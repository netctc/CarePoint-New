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
  Query,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { AuthPrincipal } from "@carepoint/identity";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { CurrentPrincipal, RequirePermissions } from "../../security/api-security.module";

const TEMPLATE_FIELDS = new Set([
  "CHIEF_COMPLAINT",
  "SUBJECTIVE",
  "OBJECTIVE",
  "ASSESSMENT",
  "PLAN",
  "VITALS",
]);
const REQUIRED_LOCALES = ["en", "ar", "fr", "es"] as const;
const VERSION_STATUSES = ["DRAFT", "PUBLISHED", "RETIRED"] as const;

type TemplateStatus = (typeof VERSION_STATUSES)[number];

type TemplateSection = {
  key: string;
  required: boolean;
  guidanceLabels: Record<string, string> | null;
};

type TemplateLayout = {
  schemaVersion: 1;
  sections: TemplateSection[];
  clinicalContentPrefilled: false;
};

export interface CreateEncounterTemplateInput {
  code: string;
}

export interface CreateEncounterTemplateVersionInput {
  labels: unknown;
  serviceIds?: unknown;
  specialtyCodes?: unknown;
  layout: unknown;
}

@Injectable()
class EncounterTemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
  ) {}

  async adminList() {
    const items = await this.prisma.encounterTemplate.findMany({
      include: { versions: { orderBy: { version: "desc" } } },
      orderBy: { code: "asc" },
    });
    return {
      items: items.map((item) => ({
        id: item.id,
        code: item.code,
        active: item.active,
        versions: item.versions.map((version) => this.presentVersion(version)),
      })),
    };
  }

  async createDefinition(principal: AuthPrincipal, input: CreateEncounterTemplateInput) {
    const code = this.code(input?.code);
    const existing = await this.prisma.encounterTemplate.findUnique({ where: { code } });
    if (existing) throw new ConflictException("Encounter template code already exists.");
    const created = await this.prisma.encounterTemplate.create({ data: { code } });
    await this.audit.write({
      actorId: principal.accountId,
      action: "ENCOUNTER_TEMPLATE_CREATED",
      objectType: "ENCOUNTER_TEMPLATE",
      objectId: created.id,
      purpose: "CLINICAL_CONFIGURATION",
      result: "SUCCESS",
      metadata: { code, clinicalContentPrefilled: false },
    });
    return created;
  }

  async createVersion(
    principal: AuthPrincipal,
    templateIdRaw: string,
    input: CreateEncounterTemplateVersionInput,
  ) {
    const templateId = this.id(templateIdRaw, "templateId");
    const template = await this.prisma.encounterTemplate.findUnique({ where: { id: templateId } });
    if (!template) throw new NotFoundException("Encounter template not found.");

    const labels = this.localized(input?.labels, "labels", 120);
    const serviceIds = this.identifiers(input?.serviceIds, "serviceIds", 50);
    const specialtyCodes = this.codes(input?.specialtyCodes, "specialtyCodes", 50);
    const layout = this.layout(input?.layout);

    const aggregate = await this.prisma.encounterTemplateVersion.aggregate({
      where: { templateId },
      _max: { version: true },
    });
    const version = (aggregate._max.version ?? 0) + 1;
    const created = await this.prisma.encounterTemplateVersion.create({
      data: {
        templateId,
        version,
        status: "DRAFT",
        labels: labels as Prisma.InputJsonValue,
        serviceIds: serviceIds as Prisma.InputJsonValue,
        specialtyCodes: specialtyCodes as Prisma.InputJsonValue,
        layout: layout as unknown as Prisma.InputJsonValue,
        createdByActorId: principal.accountId,
      },
    });
    await this.audit.write({
      actorId: principal.accountId,
      action: "ENCOUNTER_TEMPLATE_VERSION_CREATED",
      objectType: "ENCOUNTER_TEMPLATE_VERSION",
      objectId: created.id,
      purpose: "CLINICAL_CONFIGURATION",
      result: "SUCCESS",
      metadata: {
        templateId,
        templateVersion: version,
        serviceScopeCount: serviceIds.length,
        specialtyScopeCount: specialtyCodes.length,
        fieldCount: layout.sections.length,
        clinicalContentPrefilled: false,
      },
    });
    return this.presentVersion(created);
  }

  async publish(
    principal: AuthPrincipal,
    templateIdRaw: string,
    versionRaw: string,
  ) {
    const templateId = this.id(templateIdRaw, "templateId");
    const version = this.positiveInteger(versionRaw, "version");
    const row = await this.prisma.encounterTemplateVersion.findUnique({
      where: { templateId_version: { templateId, version } },
      include: { template: true },
    });
    if (!row || !row.template.active) throw new NotFoundException("Encounter template version not found.");
    if (row.status === "PUBLISHED") return this.presentVersion(row);
    if (row.status !== "DRAFT") throw new ConflictException("Only DRAFT encounter template versions can be published.");

    const serviceIds = this.jsonStrings(row.serviceIds);
    const specialtyCodes = this.jsonStrings(row.specialtyCodes);
    await this.validateScopes(serviceIds, specialtyCodes);
    this.layout(row.layout);

    const now = new Date();
    const published = await this.prisma.$transaction(async (tx) => {
      await tx.encounterTemplateVersion.updateMany({
        where: { templateId, status: "PUBLISHED" },
        data: { status: "RETIRED", retiredAt: now },
      });
      return tx.encounterTemplateVersion.update({
        where: { id: row.id },
        data: { status: "PUBLISHED", publishedAt: now, retiredAt: null },
      });
    });

    await this.audit.write({
      actorId: principal.accountId,
      action: "ENCOUNTER_TEMPLATE_VERSION_PUBLISHED",
      objectType: "ENCOUNTER_TEMPLATE_VERSION",
      objectId: published.id,
      purpose: "CLINICAL_CONFIGURATION",
      result: "SUCCESS",
      metadata: {
        templateId,
        templateVersion: version,
        serviceScopeCount: serviceIds.length,
        specialtyScopeCount: specialtyCodes.length,
        clinicalContentPrefilled: false,
      },
    });
    return this.presentVersion(published);
  }

  async doctorTemplates(principal: AuthPrincipal, appointmentIdRaw: string) {
    if (principal.role !== "DOCTOR") throw new ForbiddenException("Encounter templates require DOCTOR role.");
    const provider = await this.prisma.provider.findUnique({
      where: { userId: principal.accountId },
      select: {
        id: true,
        class: true,
        status: true,
        doctorProfile: {
          select: {
            specialties: {
              select: {
                specialty: { select: { code: true, active: true } },
              },
            },
          },
        },
      },
    });
    if (!provider || provider.class !== "DOCTOR" || provider.status !== "ACTIVE") {
      throw new ForbiddenException("An active Doctor provider profile is required.");
    }

    const appointmentId = this.id(appointmentIdRaw, "appointmentId");
    const appointment = await this.prisma.appointment.findFirst({
      where: {
        id: appointmentId,
        providerId: provider.id,
        status: { in: ["CONFIRMED", "COMPLETED"] },
      },
      select: { id: true, serviceId: true },
    });
    if (!appointment) throw new ForbiddenException("Assigned clinical appointment is required.");

    const doctorSpecialties = new Set(
      (provider.doctorProfile?.specialties ?? [])
        .filter((item) => item.specialty.active)
        .map((item) => item.specialty.code),
    );
    const definitions = await this.prisma.encounterTemplate.findMany({
      where: { active: true },
      include: {
        versions: {
          where: { status: "PUBLISHED" },
          orderBy: { version: "desc" },
          take: 1,
        },
      },
      orderBy: { code: "asc" },
    });

    const items = definitions.flatMap((definition) => {
      const version = definition.versions[0];
      if (!version) return [];
      const serviceIds = this.jsonStrings(version.serviceIds);
      const specialtyCodes = this.jsonStrings(version.specialtyCodes);
      const serviceMatch = serviceIds.length === 0 || serviceIds.includes(appointment.serviceId);
      const specialtyMatch = specialtyCodes.length === 0 || specialtyCodes.some((code) => doctorSpecialties.has(code));
      if (!serviceMatch || !specialtyMatch) return [];
      return [{
        templateId: definition.id,
        templateVersionId: version.id,
        code: definition.code,
        version: version.version,
        labels: version.labels,
        layout: version.layout,
        match: {
          serviceId: appointment.serviceId,
          specialtyCodes: [...doctorSpecialties].filter((code) => specialtyCodes.length === 0 || specialtyCodes.includes(code)),
        },
        clinicalContentPrefilled: false,
      }];
    });

    await this.audit.write({
      actorId: principal.accountId,
      action: "ENCOUNTER_TEMPLATE_LIST_READ",
      objectType: "APPOINTMENT",
      objectId: appointment.id,
      purpose: "TREATMENT",
      result: "SUCCESS",
      metadata: {
        providerId: provider.id,
        appointmentId: appointment.id,
        itemCount: items.length,
        clinicalContentPrefilled: false,
      },
    });
    return { appointmentId: appointment.id, items, clinicalContentPrefilled: false };
  }

  private async validateScopes(serviceIds: string[], specialtyCodes: string[]) {
    if (serviceIds.length > 0) {
      const count = await this.prisma.service.count({
        where: { id: { in: serviceIds }, active: true },
      });
      if (count !== serviceIds.length) throw new BadRequestException("Every serviceId must reference an active service.");
    }
    if (specialtyCodes.length > 0) {
      const count = await this.prisma.medicalSpecialty.count({
        where: { code: { in: specialtyCodes }, active: true },
      });
      if (count !== specialtyCodes.length) throw new BadRequestException("Every specialtyCode must reference an active medical specialty.");
    }
  }

  private layout(raw: unknown): TemplateLayout {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new BadRequestException("layout must be an object.");
    const object = raw as Record<string, unknown>;
    const allowedRoot = new Set(["sections"]);
    for (const key of Object.keys(object)) {
      if (!allowedRoot.has(key)) throw new BadRequestException(`Unsupported layout key: ${key}.`);
    }
    if (!Array.isArray(object.sections) || object.sections.length < 1 || object.sections.length > 6) {
      throw new BadRequestException("layout.sections must contain between 1 and 6 sections.");
    }
    const seen = new Set<string>();
    const sections = object.sections.map((rawSection, index) => {
      if (!rawSection || typeof rawSection !== "object" || Array.isArray(rawSection)) {
        throw new BadRequestException(`layout.sections[${index}] must be an object.`);
      }
      const section = rawSection as Record<string, unknown>;
      const allowed = new Set(["key", "required", "guidanceLabels"]);
      for (const key of Object.keys(section)) {
        if (!allowed.has(key)) {
          throw new BadRequestException(`Unsupported section key ${key}; templates may define structure/guidance only.`);
        }
      }
      const key = String(section.key ?? "").trim().toUpperCase();
      if (!TEMPLATE_FIELDS.has(key)) throw new BadRequestException(`Unsupported encounter template field: ${key}.`);
      if (seen.has(key)) throw new BadRequestException(`Duplicate encounter template field: ${key}.`);
      seen.add(key);
      const required = section.required === true;
      const guidanceLabels = section.guidanceLabels == null
        ? null
        : this.localized(section.guidanceLabels, `layout.sections[${index}].guidanceLabels`, 500);
      return { key, required, guidanceLabels };
    });
    return { schemaVersion: 1, sections, clinicalContentPrefilled: false };
  }

  private localized(raw: unknown, field: string, maxLength: number) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new BadRequestException(`${field} must be localized.`);
    const value = raw as Record<string, unknown>;
    const result: Record<string, string> = {};
    for (const locale of REQUIRED_LOCALES) {
      const text = typeof value[locale] === "string" ? value[locale].trim() : "";
      if (!text || text.length > maxLength || /\p{Cc}/u.test(text)) {
        throw new BadRequestException(`${field}.${locale} is required and must be <= ${maxLength} characters.`);
      }
      result[locale] = text;
    }
    return result;
  }

  private code(raw: unknown) {
    if (typeof raw !== "string") throw new BadRequestException("code is required.");
    const value = raw.trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9_:-]{2,79}$/.test(value)) throw new BadRequestException("code is invalid.");
    return value;
  }

  private codes(raw: unknown, field: string, max: number) {
    if (raw == null) return [];
    if (!Array.isArray(raw) || raw.length > max) throw new BadRequestException(`${field} must be an array with at most ${max} items.`);
    const values = raw.map((item, index) => {
      if (typeof item !== "string") throw new BadRequestException(`${field}[${index}] is invalid.`);
      const value = item.trim().toUpperCase();
      if (!/^[A-Z][A-Z0-9_:-]{1,63}$/.test(value)) throw new BadRequestException(`${field}[${index}] is invalid.`);
      return value;
    });
    if (new Set(values).size !== values.length) throw new BadRequestException(`${field} must not contain duplicates.`);
    return values;
  }

  private identifiers(raw: unknown, field: string, max: number) {
    if (raw == null) return [];
    if (!Array.isArray(raw) || raw.length > max) throw new BadRequestException(`${field} must be an array with at most ${max} items.`);
    const values = raw.map((item, index) => this.id(item, `${field}[${index}]`));
    if (new Set(values).size !== values.length) throw new BadRequestException(`${field} must not contain duplicates.`);
    return values;
  }

  private jsonStrings(raw: Prisma.JsonValue) {
    if (!Array.isArray(raw)) return [];
    return raw.filter((item): item is string => typeof item === "string");
  }

  private id(raw: unknown, field: string) {
    if (typeof raw !== "string") throw new BadRequestException(`${field} is required.`);
    const value = raw.trim();
    if (!/^[A-Za-z0-9_.:-]{1,180}$/.test(value)) throw new BadRequestException(`${field} is invalid.`);
    return value;
  }

  private positiveInteger(raw: unknown, field: string) {
    const value = typeof raw === "string" ? Number(raw) : raw;
    if (!Number.isInteger(value) || Number(value) < 1) throw new BadRequestException(`${field} must be a positive integer.`);
    return Number(value);
  }

  private presentVersion(row: {
    id: string;
    templateId: string;
    version: number;
    status: string;
    labels: Prisma.JsonValue;
    serviceIds: Prisma.JsonValue;
    specialtyCodes: Prisma.JsonValue;
    layout: Prisma.JsonValue;
    publishedAt: Date | null;
    retiredAt: Date | null;
    createdAt: Date;
  }) {
    return {
      id: row.id,
      templateId: row.templateId,
      version: row.version,
      status: row.status as TemplateStatus,
      labels: row.labels,
      serviceIds: this.jsonStrings(row.serviceIds),
      specialtyCodes: this.jsonStrings(row.specialtyCodes),
      layout: row.layout,
      publishedAt: row.publishedAt,
      retiredAt: row.retiredAt,
      createdAt: row.createdAt,
      clinicalContentPrefilled: false,
    };
  }
}

@Controller("admin/encounter-templates")
class AdminEncounterTemplatesController {
  constructor(private readonly templates: EncounterTemplatesService) {}

  @RequirePermissions("CATALOG_MANAGE")
  @Get()
  list() {
    return this.templates.adminList();
  }

  @RequirePermissions("CATALOG_MANAGE")
  @Post()
  create(@CurrentPrincipal() principal: AuthPrincipal, @Body() body: CreateEncounterTemplateInput) {
    return this.templates.createDefinition(principal, body);
  }

  @RequirePermissions("CATALOG_MANAGE")
  @Post(":templateId/versions")
  version(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("templateId") templateId: string,
    @Body() body: CreateEncounterTemplateVersionInput,
  ) {
    return this.templates.createVersion(principal, templateId, body);
  }

  @RequirePermissions("CATALOG_MANAGE")
  @Post(":templateId/versions/:version/publish")
  publish(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("templateId") templateId: string,
    @Param("version") version: string,
  ) {
    return this.templates.publish(principal, templateId, version);
  }
}

@Controller("provider/encounter-templates")
class ProviderEncounterTemplatesController {
  constructor(private readonly templates: EncounterTemplatesService) {}

  @RequirePermissions("CLINICAL_RECORD_READ")
  @Get()
  @Header("Cache-Control", "no-store")
  list(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Query("appointmentId") appointmentId: string,
  ) {
    return this.templates.doctorTemplates(principal, appointmentId);
  }
}

@Module({
  controllers: [AdminEncounterTemplatesController, ProviderEncounterTemplatesController],
  providers: [EncounterTemplatesService],
})
export class EncounterTemplatesModule {}
