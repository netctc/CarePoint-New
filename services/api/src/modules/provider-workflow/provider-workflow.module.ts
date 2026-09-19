import { Body, Controller, Header, Module, Param, Post } from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { CurrentPrincipal, RequirePermissions } from "../../security/api-security.module";
import { ProvidersModule } from "../providers/providers.module";
import {
  ProviderWorkflowService,
  type CompleteHomeVisitInput,
  type ConfirmTransportEquipmentInput,
  type RejectTransportInput,
} from "./provider-workflow.service";

@Controller("provider/workflows")
class ProviderWorkflowController {
  constructor(private readonly workflows: ProviderWorkflowService) {}

  @RequirePermissions("OTHER_PROVIDER_WORKFLOW_EXECUTE")
  @Post("home-visits/:appointmentId/arrive")
  @Header("Cache-Control", "no-store")
  arrive(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("appointmentId") appointmentId: string,
  ) {
    return this.workflows.arriveHomeVisit(principal, appointmentId);
  }

  @RequirePermissions("OTHER_PROVIDER_WORKFLOW_EXECUTE")
  @Post("home-visits/:appointmentId/complete")
  @Header("Cache-Control", "no-store")
  complete(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("appointmentId") appointmentId: string,
    @Body() body: CompleteHomeVisitInput,
  ) {
    return this.workflows.completeHomeVisit(principal, appointmentId, body);
  }

  @RequirePermissions("OTHER_PROVIDER_WORKFLOW_EXECUTE")
  @Post("medical-transport/:requestId/accept-assignment")
  @Header("Cache-Control", "no-store")
  acceptAssignment(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("requestId") requestId: string,
  ) {
    return this.workflows.acceptAssignedTransport(principal, requestId);
  }

  @RequirePermissions("OTHER_PROVIDER_WORKFLOW_EXECUTE")
  @Post("medical-transport/:requestId/reject")
  @Header("Cache-Control", "no-store")
  reject(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("requestId") requestId: string,
    @Body() body: RejectTransportInput,
  ) {
    return this.workflows.rejectAssignedTransport(principal, requestId, body);
  }

  @RequirePermissions("OTHER_PROVIDER_WORKFLOW_EXECUTE")
  @Post("medical-transport/:requestId/equipment-confirm")
  @Header("Cache-Control", "no-store")
  equipment(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("requestId") requestId: string,
    @Body() body: ConfirmTransportEquipmentInput,
  ) {
    return this.workflows.confirmTransportEquipment(principal, requestId, body);
  }
}

@Module({
  imports: [ProvidersModule],
  controllers: [ProviderWorkflowController],
  providers: [ProviderWorkflowService],
})
export class ProviderWorkflowModule {}
