import { Body, Controller, Get, Module, Param, Post } from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { CurrentPrincipal, RequirePermissions } from "../../security/api-security.module";
import { PersistentOnboardingService } from "./persistent-onboarding.service";
import { ProviderSelfOnboardingService } from "./provider-self-onboarding.service";

interface DoctorOnboardingBody { specialtyId: string; }
interface OtherProviderOnboardingBody { providerCategoryId: string; }
interface CredentialBody { type: string; number?: string; issuer?: string; validUntil?: string; documentId?: string; }
interface ReviewCredentialBody { state: "VERIFIED" | "REJECTED"; note?: string; }
interface GovernanceDecisionBody { note: string; }

@Controller("onboarding")
class OnboardingController {
  constructor(
    private readonly onboarding: PersistentOnboardingService,
    private readonly selfOnboarding: ProviderSelfOnboardingService,
  ) {}

  @RequirePermissions("PROVIDER_SELF_ONBOARD")
  @Get("me")
  mine(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.selfOnboarding.state(principal);
  }

  @RequirePermissions("PROVIDER_REVIEW")
  @Get()
  list(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.onboarding.list(principal);
  }

  @RequirePermissions("PROVIDER_SELF_ONBOARD")
  @Post("doctors")
  startDoctor(@CurrentPrincipal() principal: AuthPrincipal, @Body() body: DoctorOnboardingBody) {
    return this.onboarding.startDoctor(principal, body.specialtyId);
  }

  @RequirePermissions("PROVIDER_SELF_ONBOARD")
  @Post("other-providers")
  startOtherProvider(@CurrentPrincipal() principal: AuthPrincipal, @Body() body: OtherProviderOnboardingBody) {
    return this.onboarding.startOtherProvider(principal, body.providerCategoryId);
  }

  @RequirePermissions("PROVIDER_SELF_ONBOARD")
  @Post(":onboardingId/credentials")
  addCredential(@CurrentPrincipal() principal: AuthPrincipal, @Param("onboardingId") onboardingId: string, @Body() body: CredentialBody) {
    return this.onboarding.addCredential(principal, onboardingId, body);
  }

  @RequirePermissions("PROVIDER_SELF_ONBOARD")
  @Post(":onboardingId/submit")
  submit(@CurrentPrincipal() principal: AuthPrincipal, @Param("onboardingId") onboardingId: string) {
    return this.onboarding.submit(principal, onboardingId);
  }

  @RequirePermissions("PROVIDER_REVIEW")
  @Post(":onboardingId/credentials/:credentialId/review")
  reviewCredential(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("onboardingId") onboardingId: string,
    @Param("credentialId") credentialId: string,
    @Body() body: ReviewCredentialBody,
  ) {
    return this.onboarding.reviewCredential(principal, onboardingId, credentialId, body.state, body.note);
  }

  @RequirePermissions("PROVIDER_REVIEW")
  @Post(":onboardingId/request-changes")
  requestChanges(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("onboardingId") onboardingId: string,
    @Body() body: GovernanceDecisionBody,
  ) {
    return this.onboarding.requestChanges(principal, onboardingId, body.note);
  }

  @RequirePermissions("PROVIDER_REVIEW")
  @Post(":onboardingId/reject")
  reject(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("onboardingId") onboardingId: string,
    @Body() body: GovernanceDecisionBody,
  ) {
    return this.onboarding.reject(principal, onboardingId, body.note);
  }

  @RequirePermissions("PROVIDER_REVIEW")
  @Post(":onboardingId/approve")
  approve(@CurrentPrincipal() principal: AuthPrincipal, @Param("onboardingId") onboardingId: string) {
    return this.onboarding.approve(principal, onboardingId);
  }

  @RequirePermissions("PROVIDER_SELF_ONBOARD")
  @Get("provider-access/me")
  providerAccess(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.onboarding.providerState(principal);
  }

  @RequirePermissions("PROVIDER_REVIEW")
  @Post("provider-access/:accountId/suspend")
  suspendProvider(@CurrentPrincipal() principal: AuthPrincipal, @Param("accountId") accountId: string) {
    return this.onboarding.suspendProvider(principal, accountId);
  }
}

@Module({
  controllers: [OnboardingController],
  providers: [PersistentOnboardingService, ProviderSelfOnboardingService],
})
export class OnboardingModule {}
