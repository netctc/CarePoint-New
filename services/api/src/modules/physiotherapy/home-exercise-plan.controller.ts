import { Body, Controller, Get, Header, Param, Post } from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { CurrentPrincipal, RequirePermissions } from "../../security/api-security.module";
import { HomeExercisePlanService } from "./home-exercise-plan.service";

@Controller("provider/home-exercise-plans")
export class HomeExercisePlanController {
  constructor(private readonly plans: HomeExercisePlanService) {}

  @RequirePermissions("OTHER_PROVIDER_CLINICAL_WORKSPACE")
  @Post()
  @Header("Cache-Control", "no-store")
  create(@CurrentPrincipal() principal: AuthPrincipal, @Body() body: Record<string, unknown>) {
    return this.plans.create(principal, body);
  }

  @RequirePermissions("OTHER_PROVIDER_CLINICAL_WORKSPACE")
  @Get("patients/:patientId")
  @Header("Cache-Control", "no-store")
  list(@CurrentPrincipal() principal: AuthPrincipal, @Param("patientId") patientId: string) {
    return this.plans.list(principal, patientId);
  }

  @RequirePermissions("OTHER_PROVIDER_CLINICAL_WORKSPACE")
  @Get(":planId/compliance")
  @Header("Cache-Control", "no-store")
  compliance(@CurrentPrincipal() principal: AuthPrincipal, @Param("planId") planId: string) {
    return this.plans.compliance(principal, planId);
  }
}
