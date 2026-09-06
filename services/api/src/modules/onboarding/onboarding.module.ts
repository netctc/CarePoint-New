import { Body, Controller, Get, Module, Param, Post } from "@nestjs/common";
import type { CredentialState } from "@carepoint/identity";
import { IdentityCoreService } from "../../core/identity-core.module";

interface DoctorOnboardingBody { accountId: string; specialtyId: string; }
interface OtherProviderOnboardingBody { accountId: string; providerCategoryId: string; }
interface CredentialBody { type: string; number?: string; issuer?: string; validUntil?: string; }
interface ReviewCredentialBody { actorId: string; state: CredentialState; note?: string; }
interface ApproveBody { actorId: string; }

@Controller("onboarding")
class OnboardingController {
  constructor(private readonly identity: IdentityCoreService) {}

  @Get()
  list() { return { items: this.identity.governance.listOnboardings() }; }

  @Post("doctors")
  startDoctor(@Body() body: DoctorOnboardingBody) { return this.identity.governance.startDoctor(body); }

  @Post("other-providers")
  startOtherProvider(@Body() body: OtherProviderOnboardingBody) { return this.identity.governance.startOtherProvider(body); }

  @Post(":onboardingId/credentials")
  addCredential(@Param("onboardingId") onboardingId: string, @Body() body: CredentialBody) { return this.identity.governance.addCredential(onboardingId, body); }

  @Post(":onboardingId/submit")
  submit(@Param("onboardingId") onboardingId: string) { return this.identity.governance.submit(onboardingId); }

  @Post(":onboardingId/credentials/:credentialId/review")
  reviewCredential(@Param("onboardingId") onboardingId: string, @Param("credentialId") credentialId: string, @Body() body: ReviewCredentialBody) { return this.identity.governance.reviewCredential(body.actorId, onboardingId, credentialId, body.state, body.note); }

  @Post(":onboardingId/approve")
  approve(@Param("onboardingId") onboardingId: string, @Body() body: ApproveBody) { return this.identity.governance.approve(body.actorId, onboardingId); }

  @Get("provider-access/:accountId")
  providerAccess(@Param("accountId") accountId: string) { return { state: this.identity.governance.providerState(accountId) }; }

  @Post("provider-access/:accountId/suspend")
  suspendProvider(@Param("accountId") accountId: string, @Body() body: ApproveBody) { return { state: this.identity.governance.suspendProvider(body.actorId, accountId) }; }
}

@Module({ controllers: [OnboardingController] })
export class OnboardingModule {}
