import { BadRequestException, Body, Controller, Get, Injectable, Module, Param, Patch, Post } from "@nestjs/common";
import { AppointmentModalities, OtherProviderFamilies, type AppointmentModality, type LocalizedText, type OtherProviderFamily } from "@carepoint/contracts";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import type { AuthPrincipal } from "@carepoint/identity";
import { CurrentPrincipal, Public, RequirePermissions } from "../../security/api-security.module";
import { ProviderCategoryCapabilityService } from "./provider-category-capability.service";
import { ClinicalSummarySections, OtherProviderWorkflowCapabilities, parseProviderCategoryCapabilities, providerCategoryCapabilitiesPayload } from "./provider-category-capabilities";

interface CreateSpecialtyInput { code: string; labels: LocalizedText; parentId?: string | null; }
interface CreateOtherProviderCategoryInput {
  slug: string;
  labels: LocalizedText;
  family: OtherProviderFamily;
  requiredCredentialTypes?: string[];
  enabledModalities?: AppointmentModality[];
  clinicalOrderCapabilities?: string[];
  clinicalSummarySections?: string[];
  observationCodes?: string[];
  questionnaireCodes?: string[];
  workflowCapabilities?: string[];
}

interface UpdateOtherProviderCapabilitiesInput {
  enabledModalities?: AppointmentModality[];
  clinicalOrderCapabilities?: string[];
  clinicalSummarySections?: string[];
  observationCodes?: string[];
  questionnaireCodes?: string[];
  workflowCapabilities?: string[];
}

const ClinicalOrderCapabilities = [
  "PRESCRIPTION",
  "LABORATORY",
  "IMAGING",
  "LAB_RESULT_ENTRY",
  "LAB_RESULT_VALIDATE",
  "SPECIMEN_COLLECTION",
  "PHYSIOTHERAPY",
  "NUTRITION",
] as const;

@Injectable()
class ProviderCatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
  ) {}

  async listSpecialties() {
    return this.prisma.medicalSpecialty.findMany({ where: { active: true }, orderBy: { code: "asc" } });
  }

  async addSpecialty(input: CreateSpecialtyInput) {
    this.assertLabels(input.labels);
    if (!input.code?.trim()) throw new BadRequestException("code is required");
    if (input.parentId) {
      const parent = await this.prisma.medicalSpecialty.findUnique({ where: { id: input.parentId } });
      if (!parent) throw new BadRequestException("Parent specialty not found.");
    }
    return this.prisma.medicalSpecialty.create({
      data: {
        code: input.code.trim().toUpperCase(),
        labels: input.labels as unknown as Prisma.InputJsonValue,
        parentId: input.parentId ?? null,
      },
    });
  }

  async listOtherCategories() {
    const items = await this.prisma.providerCategory.findMany({ where: { active: true }, orderBy: { slug: "asc" } });
    return items.map((item) => ({
      ...item,
      ...parseProviderCategoryCapabilities(item.capabilities),
    }));
  }

  async addOtherCategory(input: CreateOtherProviderCategoryInput) {
    this.assertLabels(input.labels);
    if (!input.slug?.trim()) throw new BadRequestException("slug is required");
    if (!(OtherProviderFamilies as readonly string[]).includes(input.family)) throw new BadRequestException("Doctors cannot be added to the Other Provider taxonomy.");
    const modalities = input.enabledModalities ?? [];
    for (const modality of modalities) if (!(AppointmentModalities as readonly string[]).includes(modality)) throw new BadRequestException(`Invalid modality: ${modality}`);
    const capabilities = this.capabilities(input);
    return this.prisma.providerCategory.create({
      data: {
        slug: input.slug.trim().toLowerCase(),
        labels: input.labels as unknown as Prisma.InputJsonValue,
        family: input.family,
        requiredCredentialTypes: (input.requiredCredentialTypes ?? []) as unknown as Prisma.InputJsonValue,
        capabilities: capabilities as unknown as Prisma.InputJsonValue,
      },
    });
  }

  private assertLabels(labels: LocalizedText): void {
    if (!labels?.en?.trim() || !labels?.ar?.trim() || !labels?.fr?.trim() || !labels?.es?.trim()) throw new BadRequestException("EN/AR/FR/ES labels are required.");
  }

  async updateOtherCapabilities(principal: AuthPrincipal, categoryId: string, input: UpdateOtherProviderCapabilitiesInput) {
    const current = await this.prisma.providerCategory.findUnique({ where: { id: categoryId } });
    if (!current) throw new BadRequestException("Other Provider category not found.");
    const existing = parseProviderCategoryCapabilities(current.capabilities);
    const capabilities = this.capabilities({
      enabledModalities: input.enabledModalities ?? existing.enabledModalities as AppointmentModality[],
      clinicalOrderCapabilities: input.clinicalOrderCapabilities ?? existing.clinicalOrderCapabilities,
      clinicalSummarySections: input.clinicalSummarySections ?? existing.clinicalSummarySections,
      observationCodes: input.observationCodes ?? existing.observationCodes,
      questionnaireCodes: input.questionnaireCodes ?? existing.questionnaireCodes,
      workflowCapabilities: input.workflowCapabilities ?? existing.workflowCapabilities,
    });
    const updated = await this.prisma.providerCategory.update({
      where: { id: categoryId },
      data: { capabilities: capabilities as unknown as Prisma.InputJsonValue },
    });
    const parsed = parseProviderCategoryCapabilities(updated.capabilities);
    await this.audit.writeClinical({
      actorId: principal.accountId,
      action: "PROVIDER_CATEGORY_CAPABILITIES_UPDATED",
      objectType: "PROVIDER_CATEGORY",
      objectId: updated.id,
      purpose: "CLINICAL_CONFIGURATION",
      result: "SUCCESS",
      metadata: {
        domain: "PROVIDER_CATEGORY_CAPABILITIES",
        categoryId: updated.id,
        categorySlug: updated.slug,
        enabledModalities: parsed.enabledModalities,
        clinicalOrderCapabilities: parsed.clinicalOrderCapabilities,
        clinicalSummarySections: parsed.clinicalSummarySections,
        observationCodes: parsed.observationCodes,
        questionnaireCodes: parsed.questionnaireCodes,
        workflowCapabilities: parsed.workflowCapabilities,
        decision: "ALLOW",
      },
    });
    return { ...updated, ...parsed };
  }

  private capabilities(input: UpdateOtherProviderCapabilitiesInput) {
    const modalities = input.enabledModalities ?? [];
    for (const modality of modalities) {
      if (!(AppointmentModalities as readonly string[]).includes(modality)) {
        throw new BadRequestException(`Invalid modality: ${modality}`);
      }
    }
    const clinicalOrderCapabilities = input.clinicalOrderCapabilities ?? [];
    for (const capability of clinicalOrderCapabilities) {
      if (!(ClinicalOrderCapabilities as readonly string[]).includes(capability)) {
        throw new BadRequestException(`Invalid clinical order capability: ${capability}`);
      }
    }
    const clinicalSummarySections = input.clinicalSummarySections ?? [];
    for (const section of clinicalSummarySections) {
      if (!(ClinicalSummarySections as readonly string[]).includes(section)) {
        throw new BadRequestException(`Invalid clinical summary section: ${section}`);
      }
    }
    const observationCodes = input.observationCodes ?? [];
    for (const code of observationCodes) {
      if (typeof code !== "string" || !/^[A-Za-z][A-Za-z0-9_]{2,79}$/.test(code.trim())) {
        throw new BadRequestException(`Invalid observation code: ${String(code)}`);
      }
    }
    const questionnaireCodes = input.questionnaireCodes ?? [];
    for (const code of questionnaireCodes) {
      if (typeof code !== "string" || !/^[A-Za-z][A-Za-z0-9_]{2,79}$/.test(code.trim())) {
        throw new BadRequestException("Invalid questionnaire code: " + String(code));
      }
    }
    const workflowCapabilities = input.workflowCapabilities ?? [];
    for (const capability of workflowCapabilities) {
      if (!(OtherProviderWorkflowCapabilities as readonly string[]).includes(capability)) {
        throw new BadRequestException(`Invalid workflow capability: ${capability}`);
      }
    }
    return providerCategoryCapabilitiesPayload({
      enabledModalities: modalities,
      clinicalOrderCapabilities,
      clinicalSummarySections,
      observationCodes,
      questionnaireCodes,
      workflowCapabilities,
    });
  }
}

@Controller("doctors/specialties")
class DoctorSpecialtiesController {
  constructor(private readonly catalog: ProviderCatalogService) {}

  @Public()
  @Get()
  async list() {
    return { domain: "DOCTORS_ALL_SPECIALTIES", items: await this.catalog.listSpecialties() };
  }

  @RequirePermissions("CATALOG_MANAGE")
  @Post()
  create(@Body() input: CreateSpecialtyInput) {
    return this.catalog.addSpecialty(input);
  }
}

@Controller("other-provider-categories")
class OtherProviderCategoriesController {
  constructor(private readonly catalog: ProviderCatalogService) {}

  @Public()
  @Get()
  async list() {
    return { excludesDoctors: true, items: await this.catalog.listOtherCategories() };
  }

  @RequirePermissions("CATALOG_MANAGE")
  @Post()
  create(@Body() input: CreateOtherProviderCategoryInput) {
    return this.catalog.addOtherCategory(input);
  }

  @RequirePermissions("CATALOG_MANAGE")
  @Patch(":categoryId/capabilities")
  updateCapabilities(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("categoryId") categoryId: string,
    @Body() input: UpdateOtherProviderCapabilitiesInput,
  ) {
    return this.catalog.updateOtherCapabilities(principal, categoryId, input);
  }
}

@Module({
  controllers: [DoctorSpecialtiesController, OtherProviderCategoriesController],
  providers: [ProviderCatalogService, ProviderCategoryCapabilityService],
  exports: [ProviderCategoryCapabilityService],
})
export class ProvidersModule {}
