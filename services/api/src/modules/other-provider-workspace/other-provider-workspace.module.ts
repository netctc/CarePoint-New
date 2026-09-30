import { Controller, Get, Header, Module, Param, Query } from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { CurrentPrincipal, RequirePermissions } from "../../security/api-security.module";
import { ClinicalModule } from "../clinical/clinical.module";
import { ProvidersModule } from "../providers/providers.module";
import { OtherProviderWorkspaceService } from "./other-provider-workspace.service";

@Controller("provider/capability-workspace")
class OtherProviderWorkspaceController {
  constructor(private readonly workspace: OtherProviderWorkspaceService) {}

  @RequirePermissions("OTHER_PROVIDER_CLINICAL_WORKSPACE")
  @Get(":patientId")
  @Header("Cache-Control", "no-store")
  get(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("patientId") patientId: string,
    @Query("contextType") contextType?: string,
    @Query("contextId") contextId?: string,
  ) {
    return this.workspace.workspace(principal, patientId, contextType, contextId);
  }

  @RequirePermissions("OTHER_PROVIDER_CLINICAL_WORKSPACE")
  @Get(":patientId/observation-trends")
  @Header("Cache-Control", "no-store")
  observationTrends(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("patientId") patientId: string,
    @Query("contextType") contextType?: string,
    @Query("contextId") contextId?: string,
  ) {
    return this.workspace.observationTrends(principal, patientId, contextType, contextId);
  }

  @RequirePermissions("OTHER_PROVIDER_CLINICAL_WORKSPACE")
  @Get(":patientId/questionnaire-summary")
  @Header("Cache-Control", "no-store")
  questionnaireSummary(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("patientId") patientId: string,
    @Query("contextType") contextType?: string,
    @Query("contextId") contextId?: string,
  ) {
    return this.workspace.questionnaireSummary(principal, patientId, contextType, contextId);
  }
}

@Module({
  imports: [ClinicalModule, ProvidersModule],
  controllers: [OtherProviderWorkspaceController],
  providers: [OtherProviderWorkspaceService],
})
export class OtherProviderWorkspaceModule {}
