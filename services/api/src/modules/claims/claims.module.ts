import { Body, Controller, Get, Module, Param, Post, Query } from "@nestjs/common";
import type { ReworkInsuranceClaimInput, SubmitInsuranceClaimInput } from "@carepoint/contracts";
import type { AuthPrincipal } from "@carepoint/identity";
import { CurrentPrincipal, RequirePermissions } from "../../security/api-security.module";
import { ClaimsGatewayService } from "./claims-gateway.service";
import { ClaimsService } from "./claims.service";

@Controller("revenue-cycle")
class PatientRevenueCycleController {
  constructor(private readonly claims: ClaimsService) {}

  @RequirePermissions("PATIENT_READ_CLAIMS")
  @Get("me")
  mine(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.claims.patientRevenueCycle(principal);
  }
}

@Controller("provider/revenue-cycle")
class ProviderRevenueCycleController {
  constructor(private readonly claims: ClaimsService) {}

  @RequirePermissions("PROVIDER_MANAGE_CLAIMS")
  @Get("claims")
  list(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.claims.providerRevenueCycle(principal);
  }

  @RequirePermissions("PROVIDER_MANAGE_CLAIMS")
  @Post("appointments/:appointmentId/claims")
  submit(@CurrentPrincipal() principal: AuthPrincipal, @Param("appointmentId") appointmentId: string, @Body() body: SubmitInsuranceClaimInput) {
    return this.claims.submitClaim(principal, appointmentId, body);
  }

  @RequirePermissions("PROVIDER_MANAGE_CLAIMS")
  @Post("claims/:claimId/refresh")
  refresh(@CurrentPrincipal() principal: AuthPrincipal, @Param("claimId") claimId: string) {
    return this.claims.refreshClaim(principal, claimId);
  }

  @RequirePermissions("PROVIDER_MANAGE_CLAIMS")
  @Post("claims/:claimId/rework")
  rework(@CurrentPrincipal() principal: AuthPrincipal, @Param("claimId") claimId: string, @Body() body: ReworkInsuranceClaimInput) {
    return this.claims.reworkClaim(principal, claimId, body);
  }
}

@Controller("revenue-cycle")
class RevenueCycleOperationsController {
  constructor(private readonly claims: ClaimsService) {}

  @RequirePermissions("REVENUE_CYCLE_OPERATE")
  @Get("claims")
  list(@CurrentPrincipal() principal: AuthPrincipal, @Query("status") status?: string) {
    return this.claims.operatorRevenueCycle(principal, status);
  }

  @RequirePermissions("REVENUE_CYCLE_OPERATE")
  @Post("claims/:claimId/refresh")
  refresh(@CurrentPrincipal() principal: AuthPrincipal, @Param("claimId") claimId: string) {
    return this.claims.refreshClaim(principal, claimId);
  }

  @RequirePermissions("REVENUE_CYCLE_OPERATE")
  @Post("claims/:claimId/rework")
  rework(@CurrentPrincipal() principal: AuthPrincipal, @Param("claimId") claimId: string, @Body() body: ReworkInsuranceClaimInput) {
    return this.claims.reworkClaim(principal, claimId, body);
  }
}

@Module({
  controllers: [PatientRevenueCycleController, ProviderRevenueCycleController, RevenueCycleOperationsController],
  providers: [ClaimsService, ClaimsGatewayService],
  exports: [ClaimsService],
})
export class ClaimsModule {}
