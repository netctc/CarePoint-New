import { ForbiddenException, Injectable } from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";

export type OtherProviderClinicalCapability = "PRESCRIPTION" | "LABORATORY" | "LAB_RESULT_ENTRY" | "LAB_RESULT_VALIDATE";

type CapabilityContext = {
  providerId: string;
  enabledModalities: Set<string>;
  clinicalOrderCapabilities: Set<string>;
};

@Injectable()
export class ProviderCategoryCapabilityService {
  constructor(private readonly prisma: PrismaService) {}

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
    // Ownership/not-found semantics remain authoritative in SchedulingService.
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
      throw new ForbiddenException(`Other Provider category is not authorized for ${capability}.`);
    }
  }

  private async otherProviderContext(principal: AuthPrincipal): Promise<CapabilityContext | null> {
    if (principal.role === "DOCTOR") return null;
    if (principal.role !== "OTHER_PROVIDER") throw new ForbiddenException("An active healthcare provider account is required.");

    const provider = await this.prisma.provider.findUnique({
      where: { userId: principal.accountId },
      include: { otherProviderProfile: { include: { category: true } } },
    });
    if (!provider || provider.class !== "OTHER_PROVIDER" || provider.status !== "ACTIVE") {
      throw new ForbiddenException("An active Other Provider profile is required.");
    }
    const category = provider.otherProviderProfile?.category;
    if (!category || !category.active) throw new ForbiddenException("An active Other Provider category is required.");

    const raw = category.capabilities;
    const enabledModalities = new Set<string>();
    const clinicalOrderCapabilities = new Set<string>();
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      const modalities = (raw as { enabledModalities?: unknown }).enabledModalities;
      if (Array.isArray(modalities)) {
        for (const value of modalities) if (typeof value === "string") enabledModalities.add(value);
      }
      const clinical = (raw as { clinicalOrderCapabilities?: unknown }).clinicalOrderCapabilities;
      if (Array.isArray(clinical)) {
        for (const value of clinical) if (typeof value === "string") clinicalOrderCapabilities.add(value);
      }
    }

    return { providerId: provider.id, enabledModalities, clinicalOrderCapabilities };
  }

  private assertModalities(context: CapabilityContext, modalities: readonly string[]): void {
    const denied = [...new Set(modalities)].filter((modality) => !context.enabledModalities.has(modality));
    if (denied.length > 0) {
      throw new ForbiddenException(`Other Provider category is not authorized for service modalities: ${denied.join(", ")}.`);
    }
  }
}
