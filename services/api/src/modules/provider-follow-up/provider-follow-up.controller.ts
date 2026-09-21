import { Body, Controller, Get, Header, Param, Post } from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { CurrentPrincipal, RequirePermissions } from "../../security/api-security.module";
import { ProviderFollowUpService } from "./provider-follow-up.service";

@Controller("provider/follow-up-recommendations")
export class ProviderFollowUpController {
  constructor(private readonly followUp: ProviderFollowUpService) {}

  @RequirePermissions("OTHER_PROVIDER_CLINICAL_WORKSPACE")
  @Post()
  @Header("Cache-Control", "no-store")
  create(@CurrentPrincipal() principal: AuthPrincipal, @Body() body: Record<string, unknown>) {
    return this.followUp.create(principal, body);
  }

  @RequirePermissions("OTHER_PROVIDER_CLINICAL_WORKSPACE")
  @Get("patients/:patientId")
  @Header("Cache-Control", "no-store")
  list(@CurrentPrincipal() principal: AuthPrincipal, @Param("patientId") patientId: string) {
    return this.followUp.providerList(principal, patientId);
  }
}

@Controller("patient/follow-up-recommendations")
export class PatientFollowUpController {
  constructor(private readonly followUp: ProviderFollowUpService) {}

  @RequirePermissions("PATIENT_READ_CLINICAL_RECORD")
  @Get()
  @Header("Cache-Control", "no-store")
  list(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.followUp.patientList(principal);
  }

  @RequirePermissions("PATIENT_READ_CLINICAL_RECORD")
  @Get(":recommendationId")
  @Header("Cache-Control", "no-store")
  get(@CurrentPrincipal() principal: AuthPrincipal, @Param("recommendationId") recommendationId: string) {
    return this.followUp.patientGet(principal, recommendationId);
  }
}
