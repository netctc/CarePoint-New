import { ForbiddenException, Injectable } from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";

export type OtherProviderClinicalCapability =
  | "PRESCRIPTION"
  | "LABORATORY"
  | "LAB_RESULT_ENTRY"
  | "LAB_RESULT_VALIDATE";

export type OtherProviderClinicalReadCapability = "OBSERVATIONS" | "CLINICAL_FACTS";
export type OtherProviderWorkflowCapability = "HOME_VISIT" | "TRANSPORT" | "CATEGORY_FORMS";

export interface OtherProviderWorkspaceContext {
  providerId: string;
  categoryId: string;
  categorySlug: string;
  categoryFamily: string;
  enabledModalities: string[];
  clinicalOrderCapabilities: string[];
  clinicalReadCapabilities: string[];
  workflowCapabilities: string[];
}

type CapabilityContext = {
  providerId: string;
  categoryId: string;
  categorySlug: string;
  categoryFamily: string;
  enabledModalities: Set<string>;
  clinicalOrderCapabilities: Set<string>;
  clinicalReadCapabilities: Set<string>;
  workflowCapabilities: Set<string>;
};

@Injectable()
export class ProviderCategoryCapabilityService {
  constructor(private readonly prisma: PrismaService) {}

  async workspaceContext(principal: AuthPrincipal): Promise<OtherProviderWorkspaceContext> {
    const context = await this.requireOtherProviderContext(principal);
    return this.present(context);
  }

  async assertClinicalReadCapability(
    principal: AuthPrincipal,
    capability: OtherProviderClinicalReadCapability,
  ): Promise<OtherProviderWorkspaceContext> {
    const context = await this.requireOtherProviderContext(principal);
    if (!context.clinicalReadCapabilities.has(capability)) {
      throw new ForbiddenException("Other Provider category is not authorized for this clinical read capability.");
    }
    return this.present(context);
  }

  async assertWorkflowCapability(
    principal: AuthPrincipal,
    capability: OtherProviderWorkflowCapability,
  ): Promise<OtherProviderWorkspaceContext> {
    const context = await this.requireOtherProviderContext(principal);
    if (!context.workflowCapabilities.has(capability)) {
      throw new ForbiddenException("Other Provider category is not authorized for this workflow capability.");
    }
    return this.present(context);
  }

  async assertServiceModalities(principal: AuthPrincipal, modalities: readonly string[]): Promise<void> {
    const context = await this.otherProviderContext(principal);
    if (!context) return;
    this.assertModalities(context, modalities);
  }

  async assertServiceActivation(principal: AuthPrincipal, serviceId: string): Promise<void> {
    const context = await this.otherProviderContext(principal);
    if (!context) return;
    const service = await this.prisma.service.findFirst({
      where: { id: serviceId, providerId: context.providerId },
      include: { modalities: { where: { active: true } } },
    });
    if (!service) return;
    this.assertModalities(context, service.modalities.map((item) => item.modality));
  }

  async assertAvailabilityModality(principal: AuthPrincipal, modality: string): Promise<void> {
    const context = await this.otherProviderContext(principal);
    if (!context) return;
    this.assertModalities(context, [modality]);
  }

  async assertAvailabilityGeneration(principal: AuthPrincipal, ruleId?: string): Promise<void> {
    const context = await this.otherProviderContext(principal);
    if (!context) return;
    const rules = await this.prisma.availabilityRule.findMany({
      where: { providerId: context.providerId, active: true, ...(ruleId ? { id: ruleId } : {}) },
      select: { modality: true },
    });
    this.assertModalities(context, rules.map((item) => item.modality));
  }

  async assertClinicalOrderCapability(principal: AuthPrincipal, capability: OtherProviderClinicalCapability): Promise<void> {
    const context = await this.otherProviderContext(principal);
    if (!context) return;
    if (!context.clinicalOrderCapabilities.has(capability)) {
      throw new ForbiddenException("Other Provider category is not authorized for this clinical order capability.");
    }
  }

  private async requireOtherProviderContext(principal: AuthPrincipal): Promise<CapabilityContext> {
    const context = await this.otherProviderContext(principal);
    if (!context) throw new ForbiddenException("Other Provider capability context is required.");
    return context;
  }

  private async otherProviderContext(principal: AuthPrincipal): Promise<CapabilityContext | null> {
    if (principal.role === "DOCTOR") return null;
    if (principal.role !== "OTHER_PROVIDER") {
      throw new ForbiddenException("An active healthcare provider account is required.");
    }

    const provider = await this.prisma.provider.findUnique({
      where: { userId: principal.accountId },
      include: { otherProviderProfile: { include: { category: true } } },
    });
    if (!provider || provider.class !== "OTHER_PROVIDER" || provider.status !== "ACTIVE") {
      throw new ForbiddenException("An active Other Provider profile is required.");
    }
    const category = provider.otherProviderProfile?.category;
    if (!category || !category.active) {
      throw new ForbiddenException("An active Other Provider category is required.");
    }

    return {
      providerId: provider.id,
      categoryId: category.id,
      categorySlug: category.slug,
      categoryFamily: category.family,
      enabledModalities: this.stringSet(category.capabilities, "enabledModalities"),
      clinicalOrderCapabilities: this.stringSet(category.capabilities, "clinicalOrderCapabilities"),
      clinicalReadCapabilities: this.stringSet(category.capabilities, "clinicalReadCapabilities"),
      workflowCapabilities: this.stringSet(category.capabilities, "workflowCapabilities"),
    };
  }

  private stringSet(raw: unknown, key: string): Set<string> {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return new Set();
    const value = (raw as Record<string, unknown>)[key];
    if (!Array.isArray(value)) return new Set();
    return new Set(value.filter((item): item is string => typeof item === "string" && item.trim().length > 0));
  }

  private assertModalities(context: CapabilityContext, modalities: readonly string[]): void {
    const denied = [...new Set(modalities)].filter((modality) => !context.enabledModalities.has(modality));
    if (denied.length > 0) {
      throw new ForbiddenException("Other Provider category is not authorized for one or more requested service modalities.");
    }
  }

  private present(context: CapabilityContext): OtherProviderWorkspaceContext {
    return {
      providerId: context.providerId,
      categoryId: context.categoryId,
      categorySlug: context.categorySlug,
      categoryFamily: context.categoryFamily,
      enabledModalities: [...context.enabledModalities].sort(),
      clinicalOrderCapabilities: [...context.clinicalOrderCapabilities].sort(),
      clinicalReadCapabilities: [...context.clinicalReadCapabilities].sort(),
      workflowCapabilities: [...context.workflowCapabilities].sort(),
    };
  }
}
