import { Body, Controller, Get, Header, Module, Param, Post, Query } from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { CurrentPrincipal, RequirePermissions } from "../../security/api-security.module";
import { CommunicationsModule } from "../communications/communications.module";
import { DependentsModule } from "../dependents/dependents.module";
import { OrdersModule } from "../orders/orders.module";
import { ReferralsService } from "./referrals.service";

@Controller("provider")
class ProviderReferralsController {
  constructor(private readonly referrals: ReferralsService) {}

  @RequirePermissions("CARE_COORDINATION_MANAGE")
  @Post("patients/:patientId/referrals")
  @Header("Cache-Control", "no-store")
  create(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("patientId") patientId: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.referrals.create(principal, patientId, body);
  }

  @RequirePermissions("CARE_COORDINATION_MANAGE")
  @Get("patients/:patientId/referrals")
  @Header("Cache-Control", "no-store")
  patientReferrals(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("patientId") patientId: string,
  ) {
    return this.referrals.providerPatientReferrals(principal, patientId);
  }

  @RequirePermissions("CARE_COORDINATION_MANAGE")
  @Get("referrals/destinations")
  @Header("Cache-Control", "no-store")
  destinations(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Query("specialtyCode") specialtyCode?: string,
  ) {
    return this.referrals.destinationCatalog(principal, specialtyCode);
  }

  @RequirePermissions("CARE_COORDINATION_MANAGE")
  @Get("referrals/inbox")
  @Header("Cache-Control", "no-store")
  inbox(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.referrals.inbox(principal);
  }

  @RequirePermissions("CARE_COORDINATION_MANAGE")
  @Post("referrals/:referralId/actions")
  @Header("Cache-Control", "no-store")
  act(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("referralId") referralId: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.referrals.act(principal, referralId, body);
  }
}

@Controller("patient/referrals")
class PatientReferralsController {
  constructor(private readonly referrals: ReferralsService) {}

  @RequirePermissions("PATIENT_READ_CLINICAL_RECORD")
  @Get()
  @Header("Cache-Control", "no-store")
  list(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.referrals.patientReferrals(principal);
  }

  @RequirePermissions("PATIENT_MANAGE_CONSENT")
  @Post(":referralId/revoke-share")
  @Header("Cache-Control", "no-store")
  revokeShare(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("referralId") referralId: string,
  ) {
    return this.referrals.revokePatientShare(principal, referralId);
  }
}

@Module({
  imports: [CommunicationsModule, DependentsModule, OrdersModule],
  controllers: [ProviderReferralsController, PatientReferralsController],
  providers: [ReferralsService],
  exports: [ReferralsService],
})
export class ReferralsModule {}
