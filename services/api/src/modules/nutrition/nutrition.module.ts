import { Body, Controller, Get, Header, Module, Param, Post, Query } from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { CurrentPrincipal, RequirePermissions } from "../../security/api-security.module";
import { ClinicalModule } from "../clinical/clinical.module";
import { ProvidersModule } from "../providers/providers.module";
import { NutritionAnthropometricsService } from "./nutrition-anthropometrics.service";
import { NutritionCatalogService } from "./nutrition-catalog.service";

@Controller("provider/nutrition/anthropometrics")
class NutritionAnthropometricsController {
  constructor(
    private readonly anthropometrics: NutritionAnthropometricsService,
    private readonly catalogService: NutritionCatalogService,
  ) {}

  @RequirePermissions("OTHER_PROVIDER_CLINICAL_WORKSPACE")
  @Get("catalog")
  @Header("Cache-Control", "no-store")
  catalog(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.catalogService.catalog(principal);
  }

  @RequirePermissions("OTHER_PROVIDER_CLINICAL_WORKSPACE")
  @Post()
  @Header("Cache-Control", "no-store")
  record(@CurrentPrincipal() principal: AuthPrincipal, @Body() body: Record<string, unknown>) {
    return this.anthropometrics.record(principal, body);
  }

  @RequirePermissions("OTHER_PROVIDER_CLINICAL_WORKSPACE")
  @Get("patients/:patientId")
  @Header("Cache-Control", "no-store")
  history(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("patientId") patientId: string,
    @Query("code") code?: string,
  ) {
    return this.anthropometrics.history(principal, patientId, code);
  }
}

@Module({
  imports: [ProvidersModule, ClinicalModule],
  controllers: [NutritionAnthropometricsController],
  providers: [NutritionAnthropometricsService, NutritionCatalogService],
})
export class NutritionModule {}
