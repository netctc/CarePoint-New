import { Body, Controller, Get, Header, Module, Param, Post } from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { CurrentPrincipal, RequirePermissions } from "../../security/api-security.module";
import { ClinicalModule } from "../clinical/clinical.module";
import { CommunicationsModule } from "../communications/communications.module";
import { DependentsModule } from "../dependents/dependents.module";
import { OrdersModule } from "../orders/orders.module";
import { RefillService } from "./refill.service";

@Controller("patient")
class PatientRefillController {
  constructor(private readonly refills: RefillService) {}

  @RequirePermissions("PATIENT_REQUEST_REFILL")
  @Post("prescriptions/:prescriptionId/refill-requests")
  @Header("Cache-Control", "no-store")
  request(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("prescriptionId") prescriptionId: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.refills.request(principal, prescriptionId, body);
  }

  @RequirePermissions("PATIENT_REQUEST_REFILL")
  @Get("refill-requests")
  @Header("Cache-Control", "no-store")
  list(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.refills.patientList(principal);
  }
}

@Controller("provider/refill-requests")
class ProviderRefillController {
  constructor(private readonly refills: RefillService) {}

  @RequirePermissions("REFILL_MANAGE")
  @Get()
  @Header("Cache-Control", "no-store")
  list(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.refills.providerList(principal);
  }

  @RequirePermissions("REFILL_MANAGE")
  @Post(":requestId/actions")
  @Header("Cache-Control", "no-store")
  review(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("requestId") requestId: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.refills.review(principal, requestId, body);
  }
}

@Module({
  imports: [OrdersModule, DependentsModule, ClinicalModule, CommunicationsModule],
  controllers: [PatientRefillController, ProviderRefillController],
  providers: [RefillService],
  exports: [RefillService],
})
export class RefillModule {}
