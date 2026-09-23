import { Body, Controller, Get, Header, Module, Param, Post } from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { CurrentPrincipal, RequirePermissions } from "../../security/api-security.module";
import { ClinicalModule } from "../clinical/clinical.module";
import { ProvidersModule } from "../providers/providers.module";
import { ServiceSignatureService } from "./service-signature.service";

@Controller("provider/service-signatures")
class ServiceSignatureController {
  constructor(private readonly signatures: ServiceSignatureService) {}

  @RequirePermissions("OTHER_PROVIDER_WORKFLOW_EXECUTE")
  @Post("appointments/:appointmentId")
  @Header("Cache-Control", "no-store")
  create(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("appointmentId") appointmentId: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.signatures.create(principal, appointmentId, body);
  }

  @RequirePermissions("OTHER_PROVIDER_WORKFLOW_EXECUTE")
  @Get("appointments/:appointmentId")
  @Header("Cache-Control", "no-store")
  list(@CurrentPrincipal() principal: AuthPrincipal, @Param("appointmentId") appointmentId: string) {
    return this.signatures.list(principal, appointmentId);
  }
}

@Module({
  imports: [ProvidersModule, ClinicalModule],
  controllers: [ServiceSignatureController],
  providers: [ServiceSignatureService],
})
export class ServiceSignatureModule {}
