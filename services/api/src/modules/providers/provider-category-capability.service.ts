import { ForbiddenException, Injectable } from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import {
  parseProviderCategoryCapabilities,
  type ClinicalSummarySection,
  type OtherProviderWorkflowCapability,
} from "./provider-category-capabilities";

export type OtherProviderClinicalCapability =
  | "PRESCRIPTION"
  | "LABORATORY"
  | "IMAGING"
  | "LAB_RESULT_ENTRY"
  | "LAB_RESULT_VALIDATE";

export type OtherProviderCapabilityContext = {
  providerId: string;
  categoryId: string;
  categorySlug: string;
  family: string;
  enabledModalities: Set<string>;
  clinicalOrderCapabilities: Set<string>;
  clinicalSummarySections: Set<ClinicalSummarySection>;
  observationCodes: Set<string>;
  workflowCapabilities: Set<OtherProviderWorkflowCapability>;
};

@Injectable()
export class ProviderCategoryCapabilityService {
  constructor(private readonly prisma: PrismaService) {}

  async assertServiceModalities(
    principal: AuthPrincipal,
    modalities: readonly string[],
  ): Promise<void> {
    const context = await this.otherProviderContext(principal);
    if (!context) return;
    this.assertModalities(context, modalities);
  }

  async assertServiceActivation(
    principal: AuthPrincipal,
    serviceId: string,
  ): Promise<void> {
    const context = await this.otherProviderContext(principal);
    if (!context) return;
    const service = await this.prisma.service.findFirst({
      where: { id: serviceId, providerId: context.providerId },
      include: { modalities: { where: { active: true } } },
    });
    if (!service) return;
    this.assertModalities(
      context,
      service.modalities.map((item) => item.modality),
    );
  }

  async assertAvailabilityModality(
    principal: AuthPrincipal,
    modality: string,
  ): Promise<void> {
    const context = await this.otherProviderContext(principal);
    if (!context) return;
    this.assertModalities(context, [modality]);
  }

  async assertAvailabilityGeneration(
    principal: AuthPrincipal,
    ruleId?: string,
  ): Promise<void> {
    const context = await this.otherProviderContext(principal);
    if (!context) return;
    const rules = await this.prisma.availabilityRule.findMany({
      where: {
        providerId: context.providerId,
        active: true,
        ...(ruleId ? { id: ruleId } : {}),
      },
      select: { modality: true },
    });
    this.assertModalities(
      context,
      rules.map((item) => item.modality),
    );
  }

  async assertClinicalOrderCapability(
    principal: AuthPrincipal,
    capability: OtherProviderClinicalCapability,
  ): Promise<void> {
    const context = await this.otherProviderContext(principal);
    if (!context) return;
    if (!context.clinicalOrderCapabilities.has(capability)) {
      throw new ForbiddenException(
        `Other Provider category is not authorized for ${capability}.`,
      );
    }
  }

  async workspaceContext(
    principal: AuthPrincipal,
  ): Promise<OtherProviderCapabilityContext> {
    const context = await this.otherProviderContext(principal);
    if (!context) {
      throw new ForbiddenException(
        "Other Provider capability context is required.",
      );
    }
    return context;
  }

  async assertWorkflowCapability(
    principal: AuthPrincipal,
    capability: OtherProviderWorkflowCapability,
  ): Promise<OtherProviderCapabilityContext> {
    const context = await this.workspaceContext(principal);
    if (!context.workflowCapabilities.has(capability)) {
      throw new ForbiddenException(
        `Other Provider category is not authorized for workflow capability ${capability}.`,
      );
    }
    return context;
  }

  private async otherProviderContext(
    principal: AuthPrincipal,
  ): Promise<OtherProviderCapabilityContext | null> {
    if (principal.role === "DOCTOR") return null;
    if (principal.role !== "OTHER_PROVIDER") {
      throw new ForbiddenException(
        "An active healthcare provider account is required.",
      );
    }

    const provider = await this.prisma.provider.findUnique({
      where: { userId: principal.accountId },
      include: {
        otherProviderProfile: {
          include: { category: true },
        },
      },
    });

    if (
      !provider ||
      provider.class !== "OTHER_PROVIDER" ||
      provider.status !== "ACTIVE"
    ) {
      throw new ForbiddenException(
        "An active Other Provider profile is required.",
      );
    }

    const category = provider.otherProviderProfile?.category;
    if (!category || !category.active) {
      throw new ForbiddenException(
        "An active Other Provider category is required.",
      );
    }

    const parsed = parseProviderCategoryCapabilities(category.capabilities);
    return {
      providerId: provider.id,
      categoryId: category.id,
      categorySlug: category.slug,
      family: category.family,
      enabledModalities: new Set(parsed.enabledModalities),
      clinicalOrderCapabilities: new Set(parsed.clinicalOrderCapabilities),
      clinicalSummarySections: new Set(parsed.clinicalSummarySections),
      observationCodes: new Set(parsed.observationCodes),
      workflowCapabilities: new Set(parsed.workflowCapabilities),
    };
  }

  private assertModalities(
    context: OtherProviderCapabilityContext,
    modalities: readonly string[],
  ): void {
    const denied = [...new Set(modalities)].filter(
      (modality) => !context.enabledModalities.has(modality),
    );
    if (denied.length > 0) {
      throw new ForbiddenException(
        `Other Provider category is not authorized for service modalities: ${denied.join(", ")}.`,
      );
    }
  }
}
