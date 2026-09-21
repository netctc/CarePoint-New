import { Body, Controller, Get, Header, Param, Patch, Post } from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { CurrentPrincipal, RequirePermissions } from "../../security/api-security.module";
import { NutritionPlanService } from "./nutrition-plan.service";

@Controller("provider/nutrition-plans")
export class NutritionPlanController {
  constructor(private readonly plans: NutritionPlanService) {}

  @RequirePermissions("OTHER_PROVIDER_CLINICAL_WORKSPACE")
  @Post()
  @Header("Cache-Control", "no-store")
  create(@CurrentPrincipal() principal: AuthPrincipal, @Body() body: Record<string, unknown>) {
    return this.plans.create(principal, body);
  }

  @RequirePermissions("OTHER_PROVIDER_CLINICAL_WORKSPACE")
  @Patch(":planId")
  @Header("Cache-Control", "no-store")
  update(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("planId") planId: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.plans.update(principal, planId, body);
  }

  @RequirePermissions("OTHER_PROVIDER_CLINICAL_WORKSPACE")
  @Get("patients/:patientId")
  @Header("Cache-Control", "no-store")
  list(@CurrentPrincipal() principal: AuthPrincipal, @Param("patientId") patientId: string) {
    return this.plans.list(principal, patientId);
  }

  @RequirePermissions("OTHER_PROVIDER_CLINICAL_WORKSPACE")
  @Get(":planId")
  @Header("Cache-Control", "no-store")
  get(@CurrentPrincipal() principal: AuthPrincipal, @Param("planId") planId: string) {
    return this.plans.get(principal, planId);
  }
}
