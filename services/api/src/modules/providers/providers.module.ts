import { BadRequestException, Body, Controller, Get, Injectable, Module, Post } from "@nestjs/common";
import { AppointmentModalities, OtherProviderFamilies, type AppointmentModality, type LocalizedText, type OtherProviderFamily } from "@carepoint/contracts";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { Public, RequirePermissions } from "../../security/api-security.module";
import { ProviderCategoryCapabilityService } from "./provider-category-capability.service";

interface CreateSpecialtyInput { code: string; labels: LocalizedText; parentId?: string | null; }
interface CreateOtherProviderCategoryInput {
  slug: string;
  labels: LocalizedText;
  family: OtherProviderFamily;
  requiredCredentialTypes?: string[];
  enabledModalities?: AppointmentModality[];
  clinicalOrderCapabilities?: string[];
}

const ClinicalOrderCapabilities = ["PRESCRIPTION", "LABORATORY", "LAB_RESULT_ENTRY", "LAB_RESULT_VALIDATE"] as const;

@Injectable()
class ProviderCatalogService {
  constructor(private readonly prisma: PrismaService) {}

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
      enabledModalities: this.enabledModalities(item.capabilities),
      clinicalOrderCapabilities: this.clinicalOrderCapabilities(item.capabilities),
    }));
  }

  async addOtherCategory(input: CreateOtherProviderCategoryInput) {
    this.assertLabels(input.labels);
    if (!input.slug?.trim()) throw new BadRequestException("slug is required");
    if (!(OtherProviderFamilies as readonly string[]).includes(input.family)) throw new BadRequestException("Doctors cannot be added to the Other Provider taxonomy.");
    const modalities = input.enabledModalities ?? [];
    for (const modality of modalities) if (!(AppointmentModalities as readonly string[]).includes(modality)) throw new BadRequestException(`Invalid modality: ${modality}`);
    const clinicalOrderCapabilities = input.clinicalOrderCapabilities ?? [];
    for (const capability of clinicalOrderCapabilities) if (!(ClinicalOrderCapabilities as readonly string[]).includes(capability)) throw new BadRequestException(`Invalid clinical order capability: ${capability}`);
    return this.prisma.providerCategory.create({
      data: {
        slug: input.slug.trim().toLowerCase(),
        labels: input.labels as unknown as Prisma.InputJsonValue,
        family: input.family,
        requiredCredentialTypes: (input.requiredCredentialTypes ?? []) as unknown as Prisma.InputJsonValue,
        capabilities: { enabledModalities: modalities, clinicalOrderCapabilities },
      },
    });
  }

  private assertLabels(labels: LocalizedText): void {
    if (!labels?.en?.trim() || !labels?.ar?.trim() || !labels?.fr?.trim() || !labels?.es?.trim()) throw new BadRequestException("EN/AR/FR/ES labels are required.");
  }

  private enabledModalities(capabilities: unknown): string[] {
    if (!capabilities || typeof capabilities !== "object" || Array.isArray(capabilities)) return [];
    const value = (capabilities as { enabledModalities?: unknown }).enabledModalities;
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  }

  private clinicalOrderCapabilities(capabilities: unknown): string[] {
    if (!capabilities || typeof capabilities !== "object" || Array.isArray(capabilities)) return [];
    const value = (capabilities as { clinicalOrderCapabilities?: unknown }).clinicalOrderCapabilities;
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
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
}

@Module({
  controllers: [DoctorSpecialtiesController, OtherProviderCategoriesController],
  providers: [ProviderCatalogService, ProviderCategoryCapabilityService],
  exports: [ProviderCategoryCapabilityService],
})
export class ProvidersModule {}
