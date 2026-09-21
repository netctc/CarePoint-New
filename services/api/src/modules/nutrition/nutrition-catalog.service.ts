import { ForbiddenException, Injectable } from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { ProviderCategoryCapabilityService } from "../providers/provider-category-capability.service";

@Injectable()
export class NutritionCatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly capabilities: ProviderCategoryCapabilityService,
  ) {}

  async catalog(principal: AuthPrincipal) {
    const context = await this.capabilities.workspaceContext(principal);
    if (!context.clinicalOrderCapabilities.has("NUTRITION")) {
      throw new ForbiddenException("Other Provider category is not authorized for NUTRITION.");
    }
    const codes = [...context.observationCodes].sort();
    if (codes.length === 0) {
      return { categoryId: context.categoryId, capability: "NUTRITION", items: [] };
    }
    const rows = await this.prisma.observationType.findMany({
      where: { code: { in: codes }, active: true },
      include: {
        versions: {
          where: { status: "ACTIVE" },
          orderBy: { version: "desc" },
          take: 1,
        },
      },
      orderBy: { code: "asc" },
    });
    return {
      categoryId: context.categoryId,
      capability: "NUTRITION",
      configurableMetrics: true,
      items: rows
        .filter((row) => row.versions.length > 0)
        .map((row) => {
          const version = row.versions[0]!;
          return {
            code: row.code,
            labels: row.labels,
            category: row.category,
            version: version.version,
            canonicalUnitCode: version.canonicalUnitCode,
            allowedUnitCodes: Array.isArray(version.allowedUnitCodes)
              ? version.allowedUnitCodes.filter((item): item is string => typeof item === "string")
              : [],
            minCanonical: version.minCanonical,
            maxCanonical: version.maxCanonical,
            precision: version.precision,
          };
        }),
    };
  }
}
