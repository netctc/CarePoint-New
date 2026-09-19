import { BadRequestException, Body, Controller, Get, Injectable, Module, Param, Patch, Post } from "@nestjs/common";
import {
  AppointmentModalities,
  OtherProviderFamilies,
  type AppointmentModality,
  type LocalizedText,
  type OtherProviderFamily,
} from "@carepoint/contracts";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { Public, RequirePermissions } from "../../security/api-security.module";
import { ProviderCategoryCapabilityService } from "./provider-category-capability.service";

interface CreateSpecialtyInput {
  code: string;
  labels: LocalizedText;
  parentId?: string | null;
}

interface CapabilityMatrixInput {
  enabledModalities?: AppointmentModality[];
  clinicalOrderCapabilities?: string[];
  clinicalReadCapabilities?: string[];
  workflowCapabilities?: string[];
}

interface CreateOtherProviderCategoryInput extends CapabilityMatrixInput {
  slug: string;
  labels: LocalizedText;
  family: OtherProviderFamily;
  requiredCredentialTypes?: string[];
}

const ClinicalOrderCapabilities = [
  "PRESCRIPTION",
  "LABORATORY",
  "LAB_RESULT_ENTRY",
  "LAB_RESULT_VALIDATE",
] as const;

const ClinicalReadCapabilities = ["OBSERVATIONS", "CLINICAL_FACTS"] as const;
const WorkflowCapabilities = ["HOME_VISIT", "TRANSPORT", "CATEGORY_FORMS"] as const;

@Injectable()
class ProviderCatalogService {
  constructor(private readonly prisma: PrismaService) {}

  async listSpecialties() {
    return this.prisma.medicalSpecialty.findMany({
      where: { active: true },
      orderBy: { code: "asc" },
    });
  }

  async addSpecialty(input: CreateSpecialtyInput) {
    this.assertLabels(input.labels);
    if (!input.code?.trim()) throw new BadRequestException("code is required");
    if (input.parentId) {
      const parent = await this.prisma.medicalSpecialty.findUnique({
        where: { id: input.parentId },
      });
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
    const items = await this.prisma.providerCategory.findMany({
      where: { active: true },
      orderBy: { slug: "asc" },
    });
    return items.map((item) => ({
      ...item,
      ...this.presentCapabilities(item.capabilities),
    }));
  }

  async addOtherCategory(input: CreateOtherProviderCategoryInput) {
    this.assertLabels(input.labels);
    if (!input.slug?.trim()) throw new BadRequestException("slug is required");
    if (!(OtherProviderFamilies as readonly string[]).includes(input.family)) {
      throw new BadRequestException("Doctors cannot be added to the Other Provider taxonomy.");
    }

    const defaultWorkflowCapabilities = input.workflowCapabilities
      ?? (input.family === "MEDICAL_TRANSPORT_GROUND" || input.family === "MEDICAL_TRANSPORT_AIR"
        ? ["TRANSPORT"]
        : input.enabledModalities?.includes("HOME_VISIT")
          ? ["HOME_VISIT"]
          : []);
    const capabilities = this.normalizeCapabilities({
      ...input,
      workflowCapabilities: defaultWorkflowCapabilities,
    });
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

  async updateCapabilities(categoryId: string, input: CapabilityMatrixInput) {
    const category = await this.prisma.providerCategory.findUnique({
      where: { id: categoryId },
    });
    if (!category) throw new BadRequestException("Other Provider category not found.");

    const current = this.presentCapabilities(category.capabilities);
    const capabilities = this.normalizeCapabilities({
      enabledModalities: (input.enabledModalities ?? current.enabledModalities) as AppointmentModality[],
      clinicalOrderCapabilities: input.clinicalOrderCapabilities ?? current.clinicalOrderCapabilities,
      clinicalReadCapabilities: input.clinicalReadCapabilities ?? current.clinicalReadCapabilities,
      workflowCapabilities: input.workflowCapabilities ?? current.workflowCapabilities,
    });

    const updated = await this.prisma.providerCategory.update({
      where: { id: category.id },
      data: {
        capabilities: capabilities as unknown as Prisma.InputJsonValue,
      },
    });
    return {
      ...updated,
      ...this.presentCapabilities(updated.capabilities),
    };
  }

  private normalizeCapabilities(input: CapabilityMatrixInput) {
    const enabledModalities = input.enabledModalities ?? [];
    for (const modality of enabledModalities) {
      if (!(AppointmentModalities as readonly string[]).includes(modality)) {
        throw new BadRequestException("Invalid appointment modality.");
      }
    }
    return {
      enabledModalities: [...new Set(enabledModalities)],
      clinicalOrderCapabilities: this.validatedTokens(
        input.clinicalOrderCapabilities ?? [],
        ClinicalOrderCapabilities,
        "clinical order capability",
      ),
      clinicalReadCapabilities: this.validatedTokens(
        input.clinicalReadCapabilities ?? [],
        ClinicalReadCapabilities,
        "clinical read capability",
      ),
      workflowCapabilities: this.validatedTokens(
        input.workflowCapabilities ?? [],
        WorkflowCapabilities,
        "workflow capability",
      ),
    };
  }

  private validatedTokens(values: string[], allowed: readonly string[], label: string): string[] {
    if (!Array.isArray(values)) throw new BadRequestException(`${label} list is invalid.`);
    const output = [...new Set(
      values.map((value) => value.trim().toUpperCase()).filter(Boolean),
    )];
    for (const value of output) {
      if (!allowed.includes(value)) {
        throw new BadRequestException(`Invalid ${label}.`);
      }
    }
    return output;
  }

  private presentCapabilities(capabilities: unknown) {
    return {
      enabledModalities: this.array(capabilities, "enabledModalities"),
      clinicalOrderCapabilities: this.array(capabilities, "clinicalOrderCapabilities"),
      clinicalReadCapabilities: this.array(capabilities, "clinicalReadCapabilities"),
      workflowCapabilities: this.array(capabilities, "workflowCapabilities"),
    };
  }

  private array(capabilities: unknown, key: string): string[] {
    if (!capabilities || typeof capabilities !== "object" || Array.isArray(capabilities)) return [];
    const value = (capabilities as Record<string, unknown>)[key];
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : [];
  }

  private assertLabels(labels: LocalizedText): void {
    if (!labels?.en?.trim() || !labels?.ar?.trim() || !labels?.fr?.trim() || !labels?.es?.trim()) {
      throw new BadRequestException("EN/AR/FR/ES labels are required.");
    }
  }
}

@Controller("doctors/specialties")
class DoctorSpecialtiesController {
  constructor(private readonly catalog: ProviderCatalogService) {}

  @Public()
  @Get()
  async list() {
    return {
      domain: "DOCTORS_ALL_SPECIALTIES",
      items: await this.catalog.listSpecialties(),
    };
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
    return {
      excludesDoctors: true,
      items: await this.catalog.listOtherCategories(),
    };
  }

  @RequirePermissions("CATALOG_MANAGE")
  @Post()
  create(@Body() input: CreateOtherProviderCategoryInput) {
    return this.catalog.addOtherCategory(input);
  }

  @RequirePermissions("CATALOG_MANAGE")
  @Patch(":categoryId/capabilities")
  capabilities(
    @Param("categoryId") categoryId: string,
    @Body() input: CapabilityMatrixInput,
  ) {
    return this.catalog.updateCapabilities(categoryId, input);
  }
}

@Module({
  controllers: [DoctorSpecialtiesController, OtherProviderCategoriesController],
  providers: [ProviderCatalogService, ProviderCategoryCapabilityService],
  exports: [ProviderCategoryCapabilityService],
})
export class ProvidersModule {}
