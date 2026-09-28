import { BadRequestException, Body, Controller, Delete, Get, Injectable, Module, Param, Patch, Post } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { OtherProviderFamilies, type LocalizedText, type OtherProviderFamily } from "@carepoint/contracts";
import type { AuthPrincipal } from "@carepoint/identity";
import { CurrentPrincipal, RequirePermissions } from "../../security/api-security.module";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { parseProviderCategoryCapabilities } from "../providers/provider-category-capabilities";

type SpecialtyInput = { code?: string; labels?: LocalizedText; parentId?: string | null; active?: boolean };
type CategoryInput = {
  slug?: string;
  labels?: LocalizedText;
  family?: OtherProviderFamily;
  requiredCredentialTypes?: string[];
  active?: boolean;
};

@Injectable()
class AdminMasterDataService {
  constructor(private readonly prisma: PrismaService, private readonly audit: DatabaseAuditService) {}

  specialties() {
    return this.prisma.medicalSpecialty.findMany({
      include: { parent: { select: { id: true, code: true, labels: true } }, _count: { select: { doctors: true, onboardings: true, children: true } } },
      orderBy: [{ active: "desc" }, { code: "asc" }],
    });
  }

  async createSpecialty(principal: AuthPrincipal, input: SpecialtyInput) {
    const code = this.code(input.code, "code");
    const labels = this.labels(input.labels);
    if (input.parentId) await this.requireSpecialty(input.parentId);
    const row = await this.prisma.medicalSpecialty.create({
      data: { code, labels: labels as unknown as Prisma.InputJsonValue, parentId: input.parentId || null, active: input.active ?? true },
    });
    await this.log(principal, "MASTER_DATA_SPECIALTY_CREATED", "MEDICAL_SPECIALTY", row.id, { code });
    return row;
  }

  async updateSpecialty(principal: AuthPrincipal, id: string, input: SpecialtyInput) {
    const current = await this.requireSpecialty(id);
    if (input.parentId === id) throw new BadRequestException("A specialty cannot be its own parent.");
    if (input.parentId) await this.requireSpecialty(input.parentId);
    const row = await this.prisma.medicalSpecialty.update({
      where: { id },
      data: {
        ...(input.code !== undefined ? { code: this.code(input.code, "code") } : {}),
        ...(input.labels !== undefined ? { labels: this.labels(input.labels) as unknown as Prisma.InputJsonValue } : {}),
        ...(input.parentId !== undefined ? { parentId: input.parentId || null } : {}),
        ...(input.active !== undefined ? { active: Boolean(input.active) } : {}),
      },
    });
    await this.log(principal, "MASTER_DATA_SPECIALTY_UPDATED", "MEDICAL_SPECIALTY", id, { previousCode: current.code, code: row.code, active: row.active });
    return row;
  }

  async deactivateSpecialty(principal: AuthPrincipal, id: string) {
    const current = await this.requireSpecialty(id);
    const row = await this.prisma.medicalSpecialty.update({ where: { id }, data: { active: false } });
    await this.log(principal, "MASTER_DATA_SPECIALTY_DEACTIVATED", "MEDICAL_SPECIALTY", id, { code: current.code });
    return { id, active: row.active };
  }

  async categories() {
    const rows = await this.prisma.providerCategory.findMany({
      include: { _count: { select: { providers: true, onboardings: true, forms: true } } },
      orderBy: [{ active: "desc" }, { slug: "asc" }],
    });
    return rows.map((row) => ({ ...row, ...parseProviderCategoryCapabilities(row.capabilities) }));
  }

  async createCategory(principal: AuthPrincipal, input: CategoryInput) {
    const slug = this.slug(input.slug);
    const labels = this.labels(input.labels);
    const family = this.family(input.family);
    const credentials = this.credentialTypes(input.requiredCredentialTypes ?? []);
    const row = await this.prisma.providerCategory.create({
      data: {
        slug,
        labels: labels as unknown as Prisma.InputJsonValue,
        family,
        active: input.active ?? true,
        requiredCredentialTypes: credentials as unknown as Prisma.InputJsonValue,
        capabilities: {} as Prisma.InputJsonValue,
      },
    });
    await this.log(principal, "MASTER_DATA_PROVIDER_CATEGORY_CREATED", "PROVIDER_CATEGORY", row.id, { slug, family, requiredCredentialTypes: credentials });
    return row;
  }

  async updateCategory(principal: AuthPrincipal, id: string, input: CategoryInput) {
    const current = await this.requireCategory(id);
    const row = await this.prisma.providerCategory.update({
      where: { id },
      data: {
        ...(input.slug !== undefined ? { slug: this.slug(input.slug) } : {}),
        ...(input.labels !== undefined ? { labels: this.labels(input.labels) as unknown as Prisma.InputJsonValue } : {}),
        ...(input.family !== undefined ? { family: this.family(input.family) } : {}),
        ...(input.requiredCredentialTypes !== undefined ? { requiredCredentialTypes: this.credentialTypes(input.requiredCredentialTypes) as unknown as Prisma.InputJsonValue } : {}),
        ...(input.active !== undefined ? { active: Boolean(input.active) } : {}),
      },
    });
    await this.log(principal, "MASTER_DATA_PROVIDER_CATEGORY_UPDATED", "PROVIDER_CATEGORY", id, { previousSlug: current.slug, slug: row.slug, active: row.active });
    return { ...row, ...parseProviderCategoryCapabilities(row.capabilities) };
  }

  async deactivateCategory(principal: AuthPrincipal, id: string) {
    const current = await this.requireCategory(id);
    const row = await this.prisma.providerCategory.update({ where: { id }, data: { active: false } });
    await this.log(principal, "MASTER_DATA_PROVIDER_CATEGORY_DEACTIVATED", "PROVIDER_CATEGORY", id, { slug: current.slug });
    return { id, active: row.active };
  }

  private async requireSpecialty(id: string) {
    const row = await this.prisma.medicalSpecialty.findUnique({ where: { id } });
    if (!row) throw new BadRequestException("Medical specialty not found.");
    return row;
  }

  private async requireCategory(id: string) {
    const row = await this.prisma.providerCategory.findUnique({ where: { id } });
    if (!row) throw new BadRequestException("Provider category not found.");
    return row;
  }

  private code(value: unknown, name: string): string {
    if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{1,39}$/.test(value.trim())) {
      throw new BadRequestException(`${name} must contain 2-40 letters, numbers, _ or -.`);
    }
    return value.trim().toUpperCase();
  }

  private slug(value: unknown): string {
    if (typeof value !== "string" || !/^[a-z0-9][a-z0-9-]{1,59}$/.test(value.trim().toLowerCase())) {
      throw new BadRequestException("slug must contain 2-60 lowercase letters, numbers or hyphens.");
    }
    return value.trim().toLowerCase();
  }

  private labels(value: unknown): LocalizedText {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new BadRequestException("Localized labels are required.");
    const labels = value as Record<string, unknown>;
    const result = {
      en: typeof labels.en === "string" ? labels.en.trim() : "",
      ar: typeof labels.ar === "string" ? labels.ar.trim() : "",
      fr: typeof labels.fr === "string" ? labels.fr.trim() : "",
      es: typeof labels.es === "string" ? labels.es.trim() : "",
    };
    if (!result.en || !result.ar || !result.fr || !result.es) throw new BadRequestException("EN/AR/FR/ES labels are required.");
    return result;
  }

  private family(value: unknown): OtherProviderFamily {
    if (typeof value !== "string" || !(OtherProviderFamilies as readonly string[]).includes(value)) {
      throw new BadRequestException("Invalid Other Provider family.");
    }
    return value as OtherProviderFamily;
  }

  private credentialTypes(values: unknown): string[] {
    if (!Array.isArray(values)) throw new BadRequestException("requiredCredentialTypes must be an array.");
    const normalized = [...new Set(values.map((value) => typeof value === "string" ? value.trim().toLowerCase() : "").filter(Boolean))];
    if (normalized.some((value) => !/^[a-z0-9][a-z0-9_-]{1,79}$/.test(value))) throw new BadRequestException("Invalid credential type.");
    return normalized;
  }

  private async log(principal: AuthPrincipal, action: string, objectType: string, objectId: string, metadata: Record<string, unknown>) {
    await this.audit.write({
      actorId: principal.accountId,
      action,
      objectType,
      objectId,
      purpose: "MASTER_DATA_GOVERNANCE",
      result: "SUCCESS",
      metadata,
    });
  }
}

@Controller("admin/master-data")
@RequirePermissions("CATALOG_MANAGE")
class AdminMasterDataController {
  constructor(private readonly data: AdminMasterDataService) {}

  @Get("specialties")
  specialties() { return this.data.specialties(); }

  @Post("specialties")
  createSpecialty(@CurrentPrincipal() principal: AuthPrincipal, @Body() body: SpecialtyInput) {
    return this.data.createSpecialty(principal, body ?? {});
  }

  @Patch("specialties/:id")
  updateSpecialty(@CurrentPrincipal() principal: AuthPrincipal, @Param("id") id: string, @Body() body: SpecialtyInput) {
    return this.data.updateSpecialty(principal, id, body ?? {});
  }

  @Delete("specialties/:id")
  deactivateSpecialty(@CurrentPrincipal() principal: AuthPrincipal, @Param("id") id: string) {
    return this.data.deactivateSpecialty(principal, id);
  }

  @Get("provider-categories")
  categories() { return this.data.categories(); }

  @Post("provider-categories")
  createCategory(@CurrentPrincipal() principal: AuthPrincipal, @Body() body: CategoryInput) {
    return this.data.createCategory(principal, body ?? {});
  }

  @Patch("provider-categories/:id")
  updateCategory(@CurrentPrincipal() principal: AuthPrincipal, @Param("id") id: string, @Body() body: CategoryInput) {
    return this.data.updateCategory(principal, id, body ?? {});
  }

  @Delete("provider-categories/:id")
  deactivateCategory(@CurrentPrincipal() principal: AuthPrincipal, @Param("id") id: string) {
    return this.data.deactivateCategory(principal, id);
  }
}

@Module({ controllers: [AdminMasterDataController], providers: [AdminMasterDataService] })
export class AdminMasterDataModule {}
