import { Body, Controller, Get, Header, Module, Param, Post } from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { CurrentPrincipal, RequirePermissions } from "../../security/api-security.module";
import { PersistentConsentService } from "./persistent-consent.service";

interface GrantConsentBody { providerId?: string; scope: string; version: string; expiresAt?: string; }

@RequirePermissions("PATIENT_MANAGE_CONSENT")
@Controller("consents")
class ConsentController {
  constructor(private readonly consents: PersistentConsentService) {}

  @Post() @Header("Cache-Control", "no-store")
  grant(@CurrentPrincipal() principal: AuthPrincipal, @Body() body: GrantConsentBody) { return this.consents.grant(principal, body); }

  @Get("me") @Header("Cache-Control", "no-store")
  listMine(@CurrentPrincipal() principal: AuthPrincipal) { return this.consents.listMine(principal); }

  @Post(":consentId/revoke") @Header("Cache-Control", "no-store")
  revoke(@CurrentPrincipal() principal: AuthPrincipal, @Param("consentId") consentId: string) { return this.consents.revoke(principal, consentId); }

  @Post(":consentId/regrant") @Header("Cache-Control", "no-store")
  regrant(@CurrentPrincipal() principal: AuthPrincipal, @Param("consentId") consentId: string) { return this.consents.regrant(principal, consentId); }
}

@Module({ controllers: [ConsentController], providers: [PersistentConsentService] })
export class ConsentModule {}
