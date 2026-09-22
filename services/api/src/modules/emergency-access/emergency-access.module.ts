import { Body, Controller, Get, Header, Module, Param, Post, Query } from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { CurrentPrincipal, RequirePermissions } from "../../security/api-security.module";
import { ClinicalModule } from "../clinical/clinical.module";
import {
  EmergencyAccessService,
  type CreateEmergencyAccessInput,
  type ReviewEmergencyAccessInput,
} from "./emergency-access.service";

@Controller("provider/emergency-access")
class ProviderEmergencyAccessController {
  constructor(private readonly emergencyAccess: EmergencyAccessService) {}

  @RequirePermissions("CLINICAL_RECORD_READ")
  @Post()
  @Header("Cache-Control", "no-store")
  create(@CurrentPrincipal() principal: AuthPrincipal, @Body() body: CreateEmergencyAccessInput) {
    return this.emergencyAccess.create(principal, body);
  }

  @RequirePermissions("CLINICAL_RECORD_READ")
  @Get()
  @Header("Cache-Control", "no-store")
  list(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.emergencyAccess.listMine(principal);
  }

  @RequirePermissions("CLINICAL_PROFILE_READ")
  @Get(":grantId/clinical-profile")
  @Header("Cache-Control", "no-store")
  clinicalProfile(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("grantId") grantId: string,
  ) {
    return this.emergencyAccess.readClinicalProfile(principal, grantId);
  }

  @RequirePermissions("CLINICAL_RECORD_READ")
  @Post(":grantId/revoke")
  @Header("Cache-Control", "no-store")
  revoke(@CurrentPrincipal() principal: AuthPrincipal, @Param("grantId") grantId: string) {
    return this.emergencyAccess.revokeMine(principal, grantId);
  }
}

@Controller("admin/emergency-access")
class AdminEmergencyAccessController {
  constructor(private readonly emergencyAccess: EmergencyAccessService) {}

  @RequirePermissions("DATA_GOVERNANCE_MANAGE")
  @Get("reviews")
  @Header("Cache-Control", "no-store")
  reviews(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Query("status") status?: string,
  ) {
    return this.emergencyAccess.reviewQueue(principal, status);
  }

  @RequirePermissions("DATA_GOVERNANCE_MANAGE")
  @Post(":grantId/review")
  @Header("Cache-Control", "no-store")
  review(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("grantId") grantId: string,
    @Body() body: ReviewEmergencyAccessInput,
  ) {
    return this.emergencyAccess.review(principal, grantId, body);
  }
}

@Module({
  imports: [ClinicalModule],
  controllers: [ProviderEmergencyAccessController, AdminEmergencyAccessController],
  providers: [EmergencyAccessService],
  exports: [EmergencyAccessService],
})
export class EmergencyAccessModule {}
