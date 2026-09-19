import { Body, Controller, Get, Header, Module, Param, Post } from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { CurrentPrincipal, RequirePermissions } from "../../security/api-security.module";
import { ClinicalModule } from "../clinical/clinical.module";
import { ProvidersModule } from "../providers/providers.module";
import { ProviderCapabilityWorkspaceService, type CompleteHomeVisitInput } from "./provider-capability-workspace.service";

@Controller("provider/v2")
class ProviderCapabilityWorkspaceController {
  constructor(private readonly workspace: ProviderCapabilityWorkspaceService) {}

  @RequirePermissions("PROVIDER_FIELD_WORKSPACE")
  @Get("workspace")
  @Header("Cache-Control", "no-store")
  get(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.workspace.workspace(principal);
  }


  @RequirePermissions("PROVIDER_FIELD_WORKSPACE")
  @Post("home-visits/:appointmentId/arrive")
  @Header("Cache-Control", "no-store")
  arrive(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("appointmentId") appointmentId: string,
  ) {
    return this.workspace.arriveHomeVisit(principal, appointmentId);
  }

  @RequirePermissions("PROVIDER_FIELD_WORKSPACE")
  @Post("home-visits/:appointmentId/complete")
  @Header("Cache-Control", "no-store")
  complete(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("appointmentId") appointmentId: string,
    @Body() body: CompleteHomeVisitInput,
  ) {
    return this.workspace.completeHomeVisit(principal, appointmentId, body);
  }

  @RequirePermissions("PROVIDER_FIELD_WORKSPACE")
  @Get("patients/:patientId/summary")
  @Header("Cache-Control", "no-store")
  summary(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("patientId") patientId: string,
  ) {
    return this.workspace.patientSummary(principal, patientId);
  }
}

@Module({
  imports: [ClinicalModule, ProvidersModule],
  controllers: [ProviderCapabilityWorkspaceController],
  providers: [ProviderCapabilityWorkspaceService],
})
export class ProviderCapabilityWorkspaceModule {}
