import { Body, Controller, Get, Header, Module, Param, Patch } from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { CurrentPrincipal, RequirePermissions } from "../../security/api-security.module";
import { ClinicalModule } from "../clinical/clinical.module";
import { HealthProfileService, type PatchHealthProfileInput } from "./health-profile.service";

@Controller("patient/health-profile")
class PatientHealthProfileController {
  constructor(private readonly healthProfile: HealthProfileService) {}

  @RequirePermissions("PATIENT_READ_HEALTH_PROFILE")
  @Get()
  @Header("Cache-Control", "no-store")
  mine(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.healthProfile.mine(principal);
  }

  @RequirePermissions("PATIENT_WRITE_HEALTH_PROFILE")
  @Patch()
  @Header("Cache-Control", "no-store")
  patch(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body() body: PatchHealthProfileInput,
  ) {
    return this.healthProfile.patchMine(principal, body);
  }
}

@Controller("provider/patients")
class ProviderHealthProfileController {
  constructor(private readonly healthProfile: HealthProfileService) {}

  @RequirePermissions("CLINICAL_HEALTH_PROFILE_READ")
  @Get(":patientId/health-profile")
  @Header("Cache-Control", "no-store")
  view(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("patientId") patientId: string,
  ) {
    return this.healthProfile.providerView(principal, patientId);
  }
}

@Module({
  imports: [ClinicalModule],
  controllers: [PatientHealthProfileController, ProviderHealthProfileController],
  providers: [HealthProfileService],
  exports: [HealthProfileService],
})
export class HealthProfileModule {}
