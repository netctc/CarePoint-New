import { Body, Controller, Get, Module, Param, Post } from "@nestjs/common";
import { IdentityCoreService } from "../../core/identity-core.module";

interface GrantConsentBody { patientId: string; providerId?: string; scope: string; version: string; expiresAt?: string; }
interface RevokeConsentBody { actorId: string; }

@Controller("consents")
class ConsentController {
  constructor(private readonly identity: IdentityCoreService) {}

  @Post()
  grant(@Body() body: GrantConsentBody) { return this.identity.governance.grantConsent(body); }

  @Get("patient/:patientId")
  list(@Param("patientId") patientId: string) { return { items: this.identity.governance.listConsents(patientId) }; }

  @Post(":consentId/revoke")
  revoke(@Param("consentId") consentId: string, @Body() body: RevokeConsentBody) { return this.identity.governance.revokeConsent(consentId, body.actorId); }
}

@Module({ controllers: [ConsentController] })
export class ConsentModule {}
